// The contribution contract for a site adapter. One object per supported site;
// engine.ts `start()` picks the first whose `matches(hostname)` is true, then
// drives it. Only `matches` + `findCards` are required; the rest are called via
// `?.` when present.
//
//   import type { Adapter } from '../types'
//   export const myAdapter: Adapter = { … }
//
// Capture-capable adapters import shared helpers (injectDetailButtons,
// captureListingOnce, autoEmit, refreshStates, renderJob, …) from ../engine.js;
// DOM-only ones need no imports. See builtin/linkedin/web.ts (full capture) and
// gmail.ts (DOM-only).
/** The API's identity for a job: a platform name plus its bare, un-prefixed id. */
export interface NaturalKey {
  platform: string;
  platform_id: string;
}

export interface Adapter {
  /** True if this adapter owns the current host (compared against location.hostname). */
  matches(host: string): boolean;

  /** Map one of this adapter's prefixed render keys (dataset.jhId, e.g. "LI-123")
   *  to the API's (platform, bare platform_id), or null if the id isn't ours. The
   *  engine asks each adapter in turn, so each owns its own prefix and adding one
   *  needs no central edit. */
  naturalKey?(jhId: string): NaturalKey | null;

  /** SPA sites only: true on the surfaces worth scanning, so other paths stay idle.
   *  Omit to always scan. */
  activeOn?(path: string): boolean;

  /** Within a list card, the selector for where to append the card action bar. */
  cardBodySelector?: string;

  /** Tag each NEW list card — set dataset.jhId (the prefixed render key) plus
   *  jobUrl/jobTitle/jobCompany and optional JSON-object jobMeta — and return
   *  those cards. Idempotent per session (skip cards already carrying
   *  dataset.jhId). `jobMeta` is patched into, rather than replacing, metadata
   *  previously captured from the detail page. */
  findCards(doc: Document): HTMLElement[];

  /** On a job detail view: inject the detail action bar, run auto-detects
   *  (applied/closed), fire `seen`, draw the keyword banner. */
  scanDetail?(): void;

  /** Handle a page-level key while this adapter owns the current host. The handler
   *  must scope itself to the relevant surface before consuming the event. */
  onKeyDown?(event: KeyboardEvent): void;

  /** Repaint adapter-owned page actions after card state renders. `statesAvailable`
   *  is supplied only when a full card-state refresh settles. */
  renderPageActions?(statesAvailable?: boolean): void;

  /** Scrape the open detail into a listing record and upsert it via
   *  captureListingOnce(id, builder). Omit if this site isn't captured. */
  capture?(): void;

  /** Whether the site's own card state shows that the job was applied to. */
  isAppliedCard?(card: HTMLElement): boolean;

  /** A `() => void` that triggers the site's own dismiss (adds the 🗑️ button),
   *  or null when the site has no native dismiss. */
  nativeDismiss?(card: HTMLElement): (() => void) | null;

  /** A status when the WHOLE surface is a "wall" of one known status (LinkedIn's
   *  jobs-tracker Applied stage → `applied`); cards findCards tagged `jhWall` are
   *  auto-marked it. Else null. A per-card status instead goes on the card as
   *  `dataset.jhWallStatus`, which the sweep prefers over this. */
  wallStatus?(): string | null;

  /** A UTC ISO date to suggest as the event time when the popup records a status
   *  manually — e.g. the open Gmail email's received date, so a hand-recorded
   *  rejection is dated when the mail arrived. Null when the surface has no date. */
  openEventDate?(): string | null;
}
