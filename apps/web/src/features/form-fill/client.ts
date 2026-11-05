import { ApiError, request, toQuery } from "../../infra/http";
import type { components } from "@job-tracker/shared/api";

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

export const api = {
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
