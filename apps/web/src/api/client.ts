// Dashboard endpoint methods. Relative `/api` calls use Vite's development proxy and
// FastAPI's production origin unchanged.

import { ApiError, request as apiRequest, toQuery } from "@job-tracker/shared/api";
import type {
  BlockedCompany,
  components,
  DocumentCreate,
  DocumentUpdate,
  EventItem,
  Job,
  JobDetail,
  JobDocument,
  JobEvent,
  JobMatch,
  JobState,
  JobSummary,
  ListingCreate,
  ListingUpdate,
  MetaVocabulary,
} from "@job-tracker/shared/api";
import type { Status } from "@job-tracker/shared/funnel";

export interface JobFilters {
  status?: string;
  q?: string;
  hidden?: boolean;
  starred?: boolean;
  // Omit title-less stub rows — jobs born from a bare seen/closed/auto-hide event
  // that never got a listing capture. Undefined means don't filter.
  stubs?: boolean;
  apply_type?: string;
  limit?: number;
  offset?: number;
  // Index signature so the filter object is a valid query-param record.
  [key: string]: string | number | boolean | undefined;
}

const API_BASE = "/api";
const request = <T>(path: string, init?: RequestInit): Promise<T> =>
  apiRequest<T>(path, init, API_BASE);

type FormFillSchemas = components["schemas"];
export type AnswerCreate = FormFillSchemas["AnswerCreate"];
export type AnswerDetail = FormFillSchemas["AnswerDetail"];
export type AnswerListResponse = FormFillSchemas["AnswerListResponse"];
export type AnswerUpdate = FormFillSchemas["AnswerUpdate"];
export type CaptureApply =
  | FormFillSchemas["CreateAnswerAndMapApply"]
  | FormFillSchemas["UpdateAnswerApply"]
  | FormFillSchemas["RetargetMappingApply"]
  | FormFillSchemas["ReplaceOptionBindingsApply"];
export type CaptureApplyResponse = FormFillSchemas["CaptureApplyResponse"];
export type CaptureConflictResolve = FormFillSchemas["CaptureConflictResolve"];
export type CaptureConflictResponse = FormFillSchemas["CaptureConflictResponse"];
export type CaptureDetail = FormFillSchemas["CaptureDetail"];
export type CaptureListResponse = FormFillSchemas["CaptureListResponse"];
export type CaptureUpdate = FormFillSchemas["CaptureUpdate"];
export type MappingPut = FormFillSchemas["MappingPut"];
export type MappingUpdate = FormFillSchemas["MappingUpdate"];
export type QuestionDetail = FormFillSchemas["QuestionDetail"];
export type QuestionListResponse = FormFillSchemas["QuestionListResponse"];
export type QuestionReviewUpdate = FormFillSchemas["QuestionReviewUpdate"];

export interface AnswerFilters {
  cursor?: string;
  limit?: number;
  q?: string;
  status?: "active" | "disabled";
  value_kind?: AnswerCreate["value_kind"];
  [key: string]: string | number | boolean | undefined;
}

export interface CaptureFilters {
  cursor?: string;
  limit?: number;
  question_id?: string;
  source?: CaptureDetail["source"];
  status?: CaptureDetail["status"];
  [key: string]: string | number | boolean | undefined;
}

export interface QuestionFilters {
  answer_id?: string;
  cursor?: string;
  has_current_capture?: boolean;
  limit?: number;
  mapping_status?: "active" | "disabled" | "retired" | "none";
  review_state?: "open" | "ignored";
  site_scope?: string;
  sort?: "last_seen" | "seen_count";
  [key: string]: string | number | boolean | undefined;
}

export class FormFillApiError extends ApiError {
  current: unknown;

  constructor(status: number, message: string, current?: unknown) {
    super(status, message);
    this.name = "FormFillApiError";
    this.current = current;
  }
}

// Form-fill bodies may contain private values. Keep them out of the global mutation
// toast while retaining the server's value-free 409 summaries for the conflict UI.
async function formFillRequest<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    let current: unknown;
    if (error.status === 409) {
      try {
        const parsed = JSON.parse(error.message) as { detail?: unknown };
        current = parsed.detail ?? parsed;
      } catch {
        current = undefined;
      }
    }
    throw new FormFillApiError(
      error.status,
      error.status === 409
        ? "This changed while you were looking at it. Your change was not applied."
        : "The form-fill request could not be completed.",
      current,
    );
  }
}

function markManualClosures(events: EventItem[]): EventItem[] {
  return events.map((item) =>
    item.event === "closed" ? { ...item, meta: { ...item.meta, source: "manual" } } : item,
  );
}

export const api = {
  listJobs: (filters: JobFilters = {}): Promise<JobSummary[]> =>
    request(`/jobs${toQuery(filters)}`),

  getJob: (jobId: string): Promise<JobDetail> => request(`/jobs/${jobId}`),

  // Likely reposts of a listing: sibling jobs sharing its server-normalized
  // company+title, used to surface duplicates first when relinking. Needs both title
  // and company; anything less is too broad to suggest, so it returns [].
  jobMatches: (
    platform: string,
    platformId: string,
    title: string,
    company: string,
  ): Promise<JobMatch[]> =>
    request(`/jobs/matches${toQuery({ platform, platform_id: platformId, title, company })}`),

  // Resolve a listing's natural key to its job — how an extension deep-link
  // (?platform=&platform_id=) finds which job to open. 404s on an uncaptured posting.
  lookupListing: (
    platform: string,
    platformId: string,
  ): Promise<{ job_id: string; listing_id: string }> =>
    request(`/listings/lookup${toQuery({ platform, platform_id: platformId })}`),

  updateJob: (
    jobId: string,
    body: { title?: string; company?: string; meta?: Record<string, unknown> },
  ): Promise<Job> => request(`/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(body) }),

  // Create a listing, upserting by platform + platform_id. A manual add sends
  // platform="manual", a client-minted platform_id, and via="manual"; the server
  // auto-creates the owning job. Returns {job_id, listing_id}.
  createListing: (body: ListingCreate): Promise<{ job_id: string; listing_id: string }> =>
    request("/listings", { method: "POST", body: JSON.stringify(body) }),

  // Partial edit of a captured listing. `job_id` relinks it through the shared link
  // cascade, which may dissolve the source job if it loses its last listing. The
  // returned job_id is the new owner.
  updateListing: (
    listingId: string,
    body: ListingUpdate,
  ): Promise<{ job_id: string; listing_id: string }> =>
    request(`/listings/${listingId}`, { method: "PATCH", body: JSON.stringify(body) }),

  // The single state-write verb, addressed by job_id from the dashboard. The batch is
  // applied in order in one transaction, returning {status, hidden, starred}.
  postEvents: (jobId: string, events: EventItem[]): Promise<JobState> =>
    request("/events", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, events: markManualClosures(events) }),
    }),

  // Corrections bypass funnel guards; revert removes the latest status event.
  correctStatus: (jobId: string, status: Status, reason?: string): Promise<JobState> =>
    request(`/jobs/${jobId}/corrections`, {
      method: "POST",
      body: JSON.stringify({ status, reason }),
    }),

  revertStatus: (jobId: string): Promise<JobState> =>
    request(`/jobs/${jobId}/status/revert`, { method: "POST" }),

  // Only supplied fields are replaced; the event verb remains immutable.
  updateEvent: (
    eventId: number,
    body: { meta?: Record<string, unknown> | null; ts?: string },
  ): Promise<JobEvent> =>
    request(`/events/${eventId}`, { method: "PATCH", body: JSON.stringify(body) }),

  // Record a `note` event: dated activity that doesn't move the funnel. Carries the
  // body plus an optional `title`, shown in place of the "note" label. The returned
  // state is unchanged by the note.
  addNote: (jobId: string, meta: { title?: string; note?: string }): Promise<JobState> =>
    request("/events", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, events: [{ event: "note", meta }] }),
    }),

  // Titles already used on note events, most-used first — the suggestion pool for a
  // new note's title.
  noteTitles: (): Promise<string[]> => request("/meta/note-titles"),

  // Delete a manual note event (only `note` events are deletable server-side).
  deleteEvent: (eventId: number): Promise<void> =>
    request(`/events/${eventId}`, { method: "DELETE" }),

  addDocument: (jobId: string, body: DocumentCreate): Promise<JobDocument> =>
    request(`/jobs/${jobId}/documents`, { method: "POST", body: JSON.stringify(body) }),

  updateDocument: (documentId: number, body: DocumentUpdate): Promise<JobDocument> =>
    request(`/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(body) }),

  // The known vocabulary of an entity's `meta` bag, for fuzzy field suggestions.
  metaVocabulary: (entity = "jobs"): Promise<MetaVocabulary> =>
    request(`/meta/vocabulary${toQuery({ entity })}`),

  // Dashboard-only hard deletes, all 204. deleteListing dissolves the job server-side
  // if it was the last listing.
  deleteJob: (jobId: string): Promise<void> => request(`/jobs/${jobId}`, { method: "DELETE" }),

  deleteListing: (listingId: string): Promise<void> =>
    request(`/listings/${listingId}`, { method: "DELETE" }),

  deleteDocument: (documentId: number): Promise<void> =>
    request(`/documents/${documentId}`, { method: "DELETE" }),

  // The company blocklist: enforced in the extension, managed here. `block` sends a
  // raw company name, which the server normalizes to the matched company_key.
  listBlockedCompanies: (): Promise<BlockedCompany[]> => request("/blocked-companies"),

  blockCompany: (company: string, platform = "*"): Promise<BlockedCompany> =>
    request("/blocked-companies", {
      method: "POST",
      body: JSON.stringify({ company, platform }),
    }),

  unblockCompany: (companyKey: string, platform = "*"): Promise<void> =>
    request(`/blocked-companies/${encodeURIComponent(companyKey)}${toQuery({ platform })}`, {
      method: "DELETE",
    }),

  listFormFillAnswers: (filters: AnswerFilters = {}): Promise<AnswerListResponse> =>
    formFillRequest(`/form-fill/answers${toQuery(filters)}`),
  getFormFillAnswer: (answerId: string): Promise<AnswerDetail> =>
    formFillRequest(`/form-fill/answers/${encodeURIComponent(answerId)}`),
  createFormFillAnswer: (body: AnswerCreate): Promise<AnswerDetail> =>
    formFillRequest("/form-fill/answers", { method: "POST", body: JSON.stringify(body) }),
  updateFormFillAnswer: (answerId: string, body: AnswerUpdate): Promise<AnswerDetail> =>
    formFillRequest(`/form-fill/answers/${encodeURIComponent(answerId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listFormFillCaptures: (filters: CaptureFilters = {}): Promise<CaptureListResponse> =>
    formFillRequest(`/form-fill/captures${toQuery(filters)}`),
  getFormFillCapture: (captureId: string): Promise<CaptureDetail> =>
    formFillRequest(`/form-fill/captures/${encodeURIComponent(captureId)}`),
  updateFormFillCapture: (captureId: string, body: CaptureUpdate): Promise<CaptureDetail> =>
    formFillRequest(`/form-fill/captures/${encodeURIComponent(captureId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  applyFormFillCapture: (captureId: string, body: CaptureApply): Promise<CaptureApplyResponse> =>
    formFillRequest(`/form-fill/captures/${encodeURIComponent(captureId)}/apply`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listFormFillQuestions: (filters: QuestionFilters = {}): Promise<QuestionListResponse> =>
    formFillRequest(`/form-fill/questions${toQuery(filters)}`),
  getFormFillQuestion: (questionId: string): Promise<QuestionDetail> =>
    formFillRequest(`/form-fill/questions/${encodeURIComponent(questionId)}`),
  updateFormFillQuestion: (
    questionId: string,
    body: QuestionReviewUpdate,
  ): Promise<QuestionDetail> =>
    formFillRequest(`/form-fill/questions/${encodeURIComponent(questionId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  putFormFillMapping: (questionId: string, body: MappingPut): Promise<QuestionDetail> =>
    formFillRequest(`/form-fill/questions/${encodeURIComponent(questionId)}/mapping`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  updateFormFillMapping: (questionId: string, body: MappingUpdate): Promise<QuestionDetail> =>
    formFillRequest(`/form-fill/questions/${encodeURIComponent(questionId)}/mapping`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  resolveFormFillCaptureConflict: (
    questionId: string,
    body: CaptureConflictResolve,
  ): Promise<CaptureConflictResponse> =>
    formFillRequest(
      `/form-fill/questions/${encodeURIComponent(questionId)}/capture-conflicts/resolve`,
      { method: "POST", body: JSON.stringify(body) },
    ),
};

export { ApiError };
