// The extension origin fetches the API directly; content scripts use the CSP-safe worker proxy.
import { API_BASE_URL } from "../config.js";
import type { BridgeRequest } from "../messages.js";

export const BASE_URL = API_BASE_URL;

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  if (opts?.method && opts.method !== "GET") notifyChange();
  return res.status === 204 ? null : res.json();
}

// Notify the worker after direct writes so other tabs invalidate their read models.
// A missed notification cannot turn a successful mutation into an error.
function notifyChange(): void {
  const msg: BridgeRequest = { type: "notify-change" };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

export const searchJobs = (q: string) => api(`/jobs?${new URLSearchParams({ q, limit: "8" })}`);

function markManualClosures(events: unknown[]): unknown[] {
  return events.map((item) => {
    if (typeof item !== "object" || item === null || !("event" in item) || item.event !== "closed")
      return item;
    const meta =
      "meta" in item && typeof item.meta === "object" && item.meta !== null ? item.meta : {};
    return { ...item, meta: { ...meta, source: "manual" } };
  });
}

// `ts` (UTC ISO) back-dates the events to when they really happened — e.g. the
// received date of the open Gmail rejection the user is recording by hand.
// Omitted → the server stamps now().
export const postEvents = (jobId: string, events: unknown[], ts?: string) =>
  api("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: jobId,
      events: markManualClosures(events),
      ...(ts ? { ts } : {}),
    }),
  });

export const noteTitles = () => api("/meta/note-titles").catch(() => []);

// Manual listings mint a platform ID because no external natural key exists.
// via=manual preserves provenance; the server creates the owning job.
export const createListing = (body: unknown) =>
  api("/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Full job record for attaching a comment to the latest status event.
export const getJob = (jobId: string) => api(`/jobs/${jobId}`);

// Enrich an already-logged event with meta after the fact. Replaces the whole meta
// bag, but the verb and timestamp are immutable, so this only adds or updates the
// note on a transition — never its status.
export const patchEventMeta = (eventId: number, meta: unknown) =>
  api(`/events/${eventId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meta }),
  });

// Delete every stored search-diagnostic row on the server (DELETE /search-log) —
// the settings panel's "Clear stored data" control.
export const clearSearchLog = () => api("/search-log", { method: "DELETE" });

// Only opted-in callers send diagnostics. keepalive lets pagehide requests finish
// after teardown; failure must not affect the popup.
export function logSearch(body: unknown, keepalive = false): void {
  try {
    fetch(`${BASE_URL}/search-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive,
    }).catch(() => {});
  } catch {
    /* offline or teardown; diagnostics are best-effort */
  }
}
