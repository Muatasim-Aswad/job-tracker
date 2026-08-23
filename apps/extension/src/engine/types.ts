// The Engine contract: the single object that owns mutable state. Each concern
// (bridge, readModel, bars, statusSelect, matches, blocklist, capture, menu, scan) is
// a `create<Concern>(engine)` factory keeping its own state closure-private and
// contributing its slice of methods here, which engine/create.ts Object.assigns onto
// one instance. Concerns reach each other through `engine.*`, late-bound at call
// time, so they can be mutually recursive without an import cycle — and an Engine per
// test gets fresh, isolated state.
//
// Members are function-typed properties rather than method signatures on purpose:
// every slice is a `this`-less closure, so the barrel can re-export the references
// directly.
import type { Adapter } from "../adapters/types";
import type { BridgeRequest, BridgeResponse, JobState, ListingRecord } from "../messages.js";

export interface Engine {
  // ── bridge ─────────────────────────────────────────────────────────────────
  bridge: (msg: BridgeRequest) => Promise<BridgeResponse>;

  // ── read-model ───────────────────────────────────────────────────────────────
  stateOf: (jobId: string) => JobState;
  emit: (
    jobId: string,
    event: string,
    meta?: unknown,
    opts?: { silent?: boolean; ts?: string },
  ) => Promise<JobState | null>;
  autoEmit: (jobId: string, event: string, ts?: string) => Promise<void>;
  refreshStates: (jobIds: string[], opts?: { force?: boolean }) => Promise<void>;
  // Drop the cached states so the next refreshStates re-reads the server — the
  // response to a write in another tab (see scan.ts, "statesChanged").
  invalidateStates: () => void;
  // The session emit-dedup set is owned by readModel but shared with capture
  // (markListingClosed dedups in the same keyspace), reached through these.
  hasEmitted: (key: string) => boolean;
  markEmitted: (key: string) => void;
  unmarkEmitted: (key: string) => void;

  // ── bars / rendering ─────────────────────────────────────────────────────────
  mkBtn: (cls: string, content: string, title: string) => HTMLButtonElement;
  openDashboardJob: (jobId: string) => void;
  renderJob: (jobId: string) => void;
  renderAll: () => void;
  flashError: (jobId: string) => void;
  toggleHidden: (jobId: string) => Promise<JobState | null>;
  flagCard: (card: HTMLElement) => void;
  loadHideMode: (cb?: () => void) => void;
  injectButtons: (card: HTMLElement, adapter: Adapter) => void;
  injectDetailButtons: (
    jobId: string,
    anchor: Element | null,
    placement?: InsertPosition,
    extraClass?: string,
  ) => void;

  // ── status select ────────────────────────────────────────────────────────────
  makeStatusSelect: (jobId: string, card?: HTMLElement) => HTMLSelectElement;
  syncStatusSelect: (select: HTMLSelectElement, status: string) => void;
  pinSelectTheme: (select: HTMLSelectElement, resolved: boolean) => void;

  // ── blocklist ────────────────────────────────────────────────────────────────
  isCompanyBlocked: (company: string | null | undefined, platform: string) => boolean;
  isCardBlocked: (card: HTMLElement) => boolean;
  syncBlocklist: () => Promise<void>;
  blockCardCompany: (card: HTMLElement) => Promise<void>;
  toggleDetailBlock: (jobId: string, btn: HTMLButtonElement) => Promise<void>;

  // ── capture ──────────────────────────────────────────────────────────────────
  captureListingOnce: (
    jobId: string | null,
    buildRecord: (id: string) => ListingRecord | null,
  ) => void;
  captureCardFromAction: (card: HTMLElement) => void;
  markListingClosed: (jobId: string) => Promise<void>;

  // ── matches ──────────────────────────────────────────────────────────────────
  checkMatches: (jobId: string, title: string | null, company: string | null) => Promise<void>;
  // Re-ask for a posting already checked, after its own listing changed server-side
  // (capture.ts on a landed JD, matches.ts after a merge). Inert before the first check.
  refreshMatches: (jobId: string) => Promise<void>;
  closeMatchPopover: (jobId?: string) => void;
  // The detail-bar company resolves in checkMatches and is read back by renderDetailBar.
  matchCompany: (jobId: string) => string | null | undefined;

  // ── menu ─────────────────────────────────────────────────────────────────────
  mkOverflowButton: (card: HTMLElement) => HTMLButtonElement;

  // ── offline ──────────────────────────────────────────────────────────────────
  isOffline: () => boolean;
  setOffline: (v: boolean) => void;
  decorateOffline: (bar: HTMLElement) => void;

  // ── scan ─────────────────────────────────────────────────────────────────────
  start: () => void;
}
