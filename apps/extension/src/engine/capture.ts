// Shared full capture, action-triggered partial capture, and listing-close handling.
import type { Engine } from "./types.js";
import type { ListingRecord } from "../messages.js";
import { platformMeta } from "@job-tracker/shared/platforms";
import { toNaturalKey } from "../registry.js";

export function createCapture(engine: Engine) {
  async function markListingClosed(jobId: string) {
    const dedup = `${jobId}:closed`;
    if (engine.hasEmitted(dedup)) return;
    engine.markEmitted(dedup);

    const key = toNaturalKey(jobId);
    if (!key) return;
    try {
      const resp = await engine.bridge({
        type: "listing",
        payload: { ...key, closed_at: new Date().toISOString() },
      });
      if (!resp.ok) {
        console.warn(`[job-tracker] close failed for ${jobId}:`, resp.error);
        throw new Error(resp.error);
      }
      // The worker ignores this request for ordinary tabs. A tab created by the
      // Gmail bulk action closes only after the listing closure landed above.
      void engine.bridge({ type: "close-bulk-job-tab" });
    } catch (e) {
      engine.unmarkEmitted(dedup); // let a later scan retry
      throw e;
    }
  }

  // ── Listing capture (shared) ────────────────────────────────────────────────
  // Track whether a full capture had company identity, allowing one later upgrade.
  const capturedListings = new Map<string, boolean>();

  function captureListingOnce(
    jobId: string | null,
    buildRecord: (id: string) => ListingRecord | null,
  ) {
    if (!jobId) return;
    const rec = buildRecord(jobId);
    // Wait for stable detail content; later scans retry incomplete panes.
    if (!rec || !rec.title || !rec.meta?.description) return;
    // Blocks suppress new jobs without freezing enrichment of tracked jobs.
    if (
      engine.isCompanyBlocked(rec.company, rec.platform) &&
      engine.stateOf(jobId).status === "untracked"
    )
      return;
    const hadCompany = capturedListings.get(jobId);
    const hasCompany = !!rec.company;
    // Recapture only when it adds a previously missing company.
    if (hadCompany === true || (hadCompany === false && !hasCompany)) return;
    capturedListings.set(jobId, hasCompany);
    void engine.bridge({ type: "listing", payload: rec }).then((resp) => {
      if (!resp.ok) {
        console.warn(`[job-tracker] listing capture failed for ${jobId}:`, resp.error);
        capturedListings.delete(jobId); // let a later scan retry from scratch
        return;
      }
      // This is the moment the JD reaches the server, which is what the duplicate
      // popover scores its rows against — see refreshMatches.
      void engine.refreshMatches(jobId);
    });
  }

  // ── Listing capture (list card, partial) ────────────────────────────────────
  // Capture card identity before a list action so its event never creates a bare
  // stub. A later detail capture enriches the same natural key.
  // Remember the last payload rather than only the id: some boards render card
  // facts lazily, so a later scan may have real salary/location to add.
  const capturedFromCard = new Map<string, string>();

  function cardMetaPatch(card: HTMLElement): Record<string, unknown> | null {
    const raw = card.dataset.jobMeta;
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return null;
      return Object.keys(parsed).length ? (parsed as Record<string, unknown>) : null;
    } catch {
      console.warn(`[job-tracker] ignored invalid card metadata for ${card.dataset.jhId}`);
      return null;
    }
  }

  function cardListingRecord(card: HTMLElement): ListingRecord | null {
    const key = toNaturalKey(card.dataset.jhId!);
    if (!key) return null;
    const title = (card.dataset.jobTitle || "").trim() || null;
    // Prefer a canonical reconstructed URL; otherwise preserve the captured path.
    const meta = platformMeta(key.platform);
    const url =
      meta?.directLink && meta.buildUrl
        ? meta.buildUrl(key.platform_id)
        : (card.dataset.jobUrl || "").split("?")[0] || null;
    const company = (card.dataset.jobCompany || "").trim() || null;
    if (!title && !url) return null; // nothing worth persisting
    const metaPatch = cardMetaPatch(card);
    return {
      ...key,
      url,
      title,
      company,
      ...(metaPatch ? { meta_patch: metaPatch } : {}),
    };
  }

  async function captureCard(card: HTMLElement): Promise<string | null> {
    const id = card?.dataset.jhId;
    if (!id) return null;
    // Blocking prevents new captures but does not freeze tracked jobs.
    if (engine.isCardBlocked(card) && engine.stateOf(id).status === "untracked") return null;
    const rec = cardListingRecord(card);
    if (!rec) return null;
    const fingerprint = JSON.stringify(rec);
    if (capturedFromCard.get(id) === fingerprint) return null;
    capturedFromCard.set(id, fingerprint);
    const resp = await engine.bridge({ type: "listing", payload: rec });
    if (!resp.ok) {
      if (capturedFromCard.get(id) === fingerprint) capturedFromCard.delete(id);
      return null;
    }
    return id;
  }

  function captureCardFromAction(card: HTMLElement) {
    void captureCard(card);
  }

  // Discovery adapters can persist every visible card without turning it into a
  // `seen` event. Refresh after all upserts settle so the list repaints `new` in one
  // state batch rather than racing each listing write against the scan's first read.
  function captureCards(cards: HTMLElement[]) {
    void Promise.all(cards.map(captureCard)).then((ids) => {
      const landed = ids.filter((id): id is string => id !== null);
      if (!landed.length) return;
      void engine.refreshStates(landed, { force: true }).then(() => {
        landed.forEach((id) => engine.renderJob(id));
      });
    });
  }

  return { markListingClosed, captureListingOnce, captureCards, captureCardFromAction };
}
