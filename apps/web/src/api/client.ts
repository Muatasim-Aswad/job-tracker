// Relative /api calls share the development proxy and production origin.

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
  JobMutationState,
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
  // Exclude titleless event-created stubs; undefined leaves them visible.
  stubs?: boolean;
  apply_type?: string;
  limit?: number;
  offset?: number;
  // The index signature permits use as a query-parameter record.
  [key: string]: string | number | boolean | undefined;
}

const API_BASE = "/api";
const request = <T>(path: string, init?: RequestInit): Promise<T> =>
  apiRequest<T>(path, init, API_BASE);

type FormFillSchemas = components["schemas"];
export type AnswerCandidateResponse = FormFillSchemas["AnswerCandidateResponse"];
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
export type QuestionAnswerCreate = FormFillSchemas["QuestionAnswerCreate"];
export type QuestionDetail = FormFillSchemas["QuestionDetail"];
export type QuestionListResponse = FormFillSchemas["QuestionListResponse"];
export type QuestionReviewUpdate = FormFillSchemas["QuestionReviewUpdate"];

export interface AnswerFilters {
  sort?: "updated_at" | "label" | "mapping_count";
  cursor?: string;
  limit?: number;
  q?: string;
  status?: "active" | "disabled";
  value_kind?: AnswerCreate["value_kind"];
  [key: string]: string | number | boolean | undefined;
}

export interface AnswerCandidateFilters {
  cursor?: string;
  limit?: number;
  q?: string;
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
  needs_review?: boolean;
  review_inbox?: boolean;
  include_matched?: boolean;
  include_dismissed?: boolean;
  review_state?: "open" | "ignored";
  site_scope?: string;
  sort?: "last_seen" | "seen_count" | "prompt";
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

// Keep private form-fill bodies out of global toasts; preserve value-free 409 summaries.
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

  // Suggestions require company and title; absent evidence returns no candidates.
  jobMatches: (
    platform: string,
    platformId: string,
    title: string,
    company: string,
  ): Promise<JobMatch[]> =>
    request(`/jobs/matches${toQuery({ platform, platform_id: platformId, title, company })}`),

  // Resolve extension natural-key deep links; uncaptured listings return 404.
  lookupListing: (
    platform: string,
    platformId: string,
  ): Promise<{ job_id: string; listing_id: string }> =>
    request(`/listings/lookup${toQuery({ platform, platform_id: platformId })}`),

  updateJob: (
    jobId: string,
    body: { title?: string; company?: string; meta?: Record<string, unknown> },
  ): Promise<Job> => request(`/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(body) }),

  // Manual listings use a fresh client UUID; the upsert creates their owning job.
  createListing: (body: ListingCreate): Promise<{ job_id: string; listing_id: string }> =>
    request("/listings", { method: "POST", body: JSON.stringify(body) }),

  // Relinking may dissolve the source job; the returned job_id names the new owner.
  updateListing: (
    listingId: string,
    body: ListingUpdate,
  ): Promise<{ job_id: string; listing_id: string }> =>
    request(`/listings/${listingId}`, { method: "PATCH", body: JSON.stringify(body) }),

  // Events apply in order in one transaction and return canonical job state.
  postEvents: (jobId: string, events: EventItem[]): Promise<JobMutationState> =>
    request("/events", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, events: markManualClosures(events) }),
    }),

  // Corrections bypass funnel guards; revert removes the latest status event.
  correctStatus: (jobId: string, status: Status, reason?: string): Promise<JobMutationState> =>
    request(`/jobs/${jobId}/corrections`, {
      method: "POST",
      body: JSON.stringify({ status, reason }),
    }),

  revertStatus: (jobId: string): Promise<JobMutationState> =>
    request(`/jobs/${jobId}/status/revert`, { method: "POST" }),

  // Only supplied fields change; the event verb is immutable.
  updateEvent: (
    eventId: number,
    body: { meta?: Record<string, unknown> | null; ts?: string },
  ): Promise<JobEvent> =>
    request(`/events/${eventId}`, { method: "PATCH", body: JSON.stringify(body) }),

  // Notes carry dated activity without changing funnel state.
  addNote: (jobId: string, meta: { title?: string; note?: string }): Promise<JobMutationState> =>
    request("/events", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, events: [{ event: "note", meta }] }),
    }),

  noteTitles: (): Promise<string[]> => request("/meta/note-titles"),

  // Only manual note events are deletable.
  deleteEvent: (eventId: number): Promise<void> =>
    request(`/events/${eventId}`, { method: "DELETE" }),

  addDocument: (jobId: string, body: DocumentCreate): Promise<JobDocument> =>
    request(`/jobs/${jobId}/documents`, { method: "POST", body: JSON.stringify(body) }),

  updateDocument: (documentId: number, body: DocumentUpdate): Promise<JobDocument> =>
    request(`/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(body) }),

  metaVocabulary: (entity = "jobs"): Promise<MetaVocabulary> =>
    request(`/meta/vocabulary${toQuery({ entity })}`),

  // Deleting the last listing also dissolves its job.
  deleteJob: (jobId: string): Promise<void> => request(`/jobs/${jobId}`, { method: "DELETE" }),

  deleteListing: (listingId: string): Promise<void> =>
    request(`/listings/${listingId}`, { method: "DELETE" }),

  deleteDocument: (documentId: number): Promise<void> =>
    request(`/documents/${documentId}`, { method: "DELETE" }),

  // The extension enforces blocking; the server normalizes raw company names.
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
  listFormFillAnswerCandidates: (
    questionId: string,
    filters: AnswerCandidateFilters = {},
  ): Promise<AnswerCandidateResponse> =>
    formFillRequest(
      `/form-fill/questions/${encodeURIComponent(questionId)}/answer-candidates${toQuery(filters)}`,
    ),
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
  createFormFillAnswerForQuestion: (
    questionId: string,
    body: QuestionAnswerCreate,
  ): Promise<QuestionDetail> =>
    formFillRequest(`/form-fill/questions/${encodeURIComponent(questionId)}/answer`, {
      method: "POST",
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
