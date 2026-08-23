// In-memory server projection plus session deduplication for automatic events.
import type { Engine } from "./types.js";
import type { ListingState } from "@job-tracker/shared/api";
import type { JobEvent, JobState } from "../messages.js";
import { toNaturalKey } from "../registry.js";

const DEFAULT_STATE: JobState = { status: "untracked", hidden: false, starred: false };

export function createReadModel(engine: Engine) {
  const viewState = new Map<string, JobState>(); // jobId -> {status, hidden, starred}
  const emitted = new Set<string>(); // `${jobId}:${event}`

  function stateOf(jobId: string): JobState {
    return viewState.get(jobId) || DEFAULT_STATE;
  }

  // Wait for authoritative server state and allow one write per job at a time.
  const writing = new Set<string>();

  async function emitEvents(
    jobId: string,
    events: JobEvent[],
    { silent = false, ts }: { silent?: boolean; ts?: string } = {},
  ) {
    const key = toNaturalKey(jobId);
    if (!key) return null;
    if (writing.has(jobId)) return null; // a write is already in flight for this job
    writing.add(jobId);
    try {
      // Omit ts when the surface provides no authoritative event time.
      const resp = await engine.bridge({
        type: "event",
        payload: { ...key, events, ...(ts ? { ts } : {}) },
      });
      if (!resp.ok) {
        console.warn(`[job-tracker] emit failed for ${jobId}:`, resp.error);
        // Automatic retries stay silent; user actions receive visible feedback.
        if (!silent) engine.flashError(jobId);
        return null;
      }
      const state = resp.result as JobState;
      viewState.set(jobId, state);
      engine.renderJob(jobId);
      return state;
    } finally {
      writing.delete(jobId);
    }
  }

  function emit(
    jobId: string,
    event: string,
    meta?: unknown,
    opts?: { silent?: boolean; ts?: string },
  ) {
    return emitEvents(jobId, [{ event, meta }], opts);
  }

  // Deduplicate successful automatic events per session; retry failures on later scans.
  async function autoEmit(jobId: string, event: string, ts?: string) {
    const key = `${jobId}:${event}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    const result = await emit(jobId, event, undefined, { silent: true, ts });
    if (!result) emitted.delete(key);
  }

  const inFlight = new Set<string>();

  // Fetch unresolved states once per platform. Preserve cached state on failure;
  // `force` supports explicit cross-tab invalidation.
  async function refreshStates(jobIds: string[], { force = false } = {}) {
    const byPlatform = new Map<string, { jobId: string; platform_id: string }[]>();
    for (const jobId of jobIds) {
      const key = toNaturalKey(jobId);
      if (!key) continue;
      if (!force && viewState.has(jobId)) continue; // already known — no network
      if (inFlight.has(jobId)) continue; // a pending request already covers it
      if (!byPlatform.has(key.platform)) byPlatform.set(key.platform, []);
      byPlatform.get(key.platform)!.push({ jobId, platform_id: key.platform_id });
    }
    for (const [platform, entries] of byPlatform) {
      entries.forEach((e) => inFlight.add(e.jobId));
      try {
        const resp = await engine.bridge({
          type: "state-batch",
          platform,
          platform_ids: entries.map((e) => e.platform_id),
        });
        if (!resp.ok) {
          console.warn("[job-tracker] state-batch failed:", resp.error);
          continue; // keep last-known
        }
        const byPid = new Map((resp.result as ListingState[]).map((r) => [r.platform_id, r]));
        for (const { jobId, platform_id } of entries) {
          const r: any = byPid.get(platform_id);
          if (r) viewState.set(jobId, { status: r.status, hidden: r.hidden, starred: r.starred });
        }
      } finally {
        entries.forEach((e) => inFlight.delete(e.jobId));
      }
    }
    // A successful batch returns one self-describing result per requested id.
    // Distinguish a real `untracked` result in viewState from the identical-looking
    // fallback stateOf() returns before any server response has landed.
    return jobIds.every((jobId) => viewState.has(jobId));
  }

  // Keep automatic-event deduplication across cross-tab cache invalidation.
  function invalidateStates() {
    viewState.clear();
  }

  return {
    stateOf,
    emit,
    autoEmit,
    refreshStates,
    invalidateStates,
    hasEmitted: (key: string) => emitted.has(key),
    markEmitted: (key: string) => void emitted.add(key),
    unmarkEmitted: (key: string) => void emitted.delete(key),
  };
}
