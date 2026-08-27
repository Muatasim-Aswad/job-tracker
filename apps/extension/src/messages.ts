// Typed bridge between content surfaces and the service worker. API response shapes
// come from the shared package; this module adds transport and extension-only state.
import type {
  BlockedCompany,
  CompanyAppliedCount,
  components,
  JobMatch,
  ListingState,
  ListingUpsertResult,
} from "@job-tracker/shared/api";
import type { NaturalKey } from "./adapters/types";

/** Natural key plus fields available from either a partial or full capture. */
export interface ListingRecord extends NaturalKey {
  url?: string | null;
  title?: string | null;
  company?: string | null;
  apply_type?: string | null;
  closed_at?: string;
  via?: string;
  meta?: Record<string, unknown>;
  /** Merge these list-card facts into existing metadata without replacing a full capture. */
  meta_patch?: Record<string, unknown>;
}

/** One funnel/activity event: a verb plus an optional meta side-bag. */
export interface JobEvent {
  event: string;
  meta?: unknown;
}

/** Cached state, including the extension-only `"untracked"` status. */
export interface JobState {
  status: string;
  hidden: boolean;
  starred: boolean;
}

export type FormFillResolutionRequest = components["schemas"]["ResolutionRequest"];
export type FormFillResolutionResponse = components["schemas"]["ResolutionResponse"];
export type FormFillCaptureRequest = components["schemas"]["CaptureCreate"];
export type FormFillCaptureResponse = components["schemas"]["CaptureCreateResponse"];

/** Everything the content script can ask the service worker to do. */
export type BridgeRequest =
  | { type: "listing"; payload: ListingRecord }
  // `ts` (UTC ISO) is the real time the events happened, when the page exposes it
  // (e.g. a Gmail rejection's received time). Omitted → the server stamps now().
  | { type: "event"; payload: NaturalKey & { events: JobEvent[]; ts?: string } }
  | { type: "state-batch"; platform: string; platform_ids: string[] }
  // Duplicate-suggestion lookup for the posting on screen (title/company scraped
  // live, since a just-materialized stub's stored keys are still NULL).
  | { type: "matches"; platform: string; platform_id: string; title: string; company: string }
  // Duplicate decisions are mutual.
  | { type: "false-match"; platform: string; platform_id: string; other_job_id: string }
  | { type: "link-job"; platform: string; platform_id: string; other_job_id: string }
  | { type: "applied-count"; company: string }
  | { type: "blocklist" }
  // `platform: "*"` blocks the company across platforms.
  | { type: "block-company"; company: string; platform: string }
  | { type: "unblock-company"; company_key: string; platform: string }
  // Resolution observes Questions on the server but never writes a host form value.
  | { type: "form-fill-resolve"; payload: FormFillResolutionRequest }
  // Captures retain an eligible user-originated value for one exact Question.
  | { type: "form-fill-capture"; payload: FormFillCaptureRequest }
  // Is the server reachable? The popup and content scripts ask on open/start to
  // paint an offline state up front rather than waiting for the first failed
  // write. Answered from the worker's `serverReachable` flag, so no fetch.
  | { type: "reachability" }
  // Open canonical LinkedIn postings from one explicit Gmail-alert bulk action.
  // The worker creates background tabs so Chromium's page popup limit cannot drop
  // every URL after the first.
  | { type: "open-job-tabs"; urls: string[] }
  // A successfully closed LinkedIn listing asks the worker to close its tab. The
  // worker acts only when that sender tab came from `open-job-tabs`.
  | { type: "close-bulk-job-tab" }
  // "I wrote to the API without going through you" — the popup fetches directly
  // (extension origin, no CSP to dodge), so this puts its write back on the same
  // cross-tab broadcast path relayed writes take. No fetch, no result.
  | { type: "notify-change" };

/** Reachability as of the worker's latest health check or relayed request. */
export interface ReachabilityState {
  reachable: boolean;
}

/** Worker push emitted when reachability changes. */
export type ReachabilityPush = { type: "reachabilityChanged"; reachable: boolean };

/** Invalidate all cached states because merge decisions can re-key multiple jobs. */
export type StatesChangedPush = { type: "statesChanged" };

/** Results returned by service-worker bridge requests. */
export type BridgeResult =
  | JobState // "event" — the settled state (the API returns a real status here)
  | ListingState[] // "state-batch"
  | JobMatch[] // "matches"
  | CompanyAppliedCount // "applied-count"
  | BlockedCompany[] // "blocklist"
  | BlockedCompany // "block-company"
  | ListingUpsertResult // "listing", "link-job"
  | FormFillResolutionResponse // "form-fill-resolve"
  | FormFillCaptureResponse // "form-fill-capture"
  | ReachabilityState // "reachability"
  | null; // 204s — "false-match", "unblock-company"

/** The service worker's reply: the ok/error discriminant plus the typed result. */
export type BridgeResponse = { ok: true; result: BridgeResult } | { ok: false; error: string };
