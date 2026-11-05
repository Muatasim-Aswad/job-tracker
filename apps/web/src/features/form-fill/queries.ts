import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "./client";
import type {
  AnswerCreate,
  AnswerCandidateFilters,
  AnswerFilters,
  AnswerUpdate,
  CaptureApply,
  CaptureConflictResolve,
  CaptureFilters,
  CaptureUpdate,
  MappingPut,
  MappingUpdate,
  QuestionAnswerCreate,
  QuestionFilters,
  QuestionReviewUpdate,
} from "./client";

// Knowledge mutations remain server-authoritative, without optimistic query writes.
// Invalidate the bounded workspace graph after success to keep projections coherent.

const FORM_FILL_KEY = ["form-fill"] as const;
const FORM_FILL_REFRESH_MS = 2_000;
const answerDetailKey = (id: string) => [...FORM_FILL_KEY, "answer", id] as const;
const captureDetailKey = (id: string) => [...FORM_FILL_KEY, "capture", id] as const;
const questionDetailKey = (id: string) => [...FORM_FILL_KEY, "question", id] as const;

function useFormFillCollection<T extends { next_cursor?: string | null }>(
  queryKey: readonly unknown[],
  fetchPage: (cursor: string | undefined) => Promise<T>,
  live = false,
) {
  const qc = useQueryClient();
  const pageOptions = (cursor: string | undefined) => ({
    queryKey: [...queryKey, "page", cursor],
    queryFn: () => fetchPage(cursor),
    staleTime: cursor ? 10_000 : 0,
    gcTime: 30_000,
  });
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => qc.fetchQuery(pageOptions(pageParam)),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: live ? FORM_FILL_REFRESH_MS : false,
    refetchIntervalInBackground: false,
  });
  const nextCursor = query.data?.pages.at(-1)?.next_cursor;
  return {
    ...query,
    prefetchNextPage: () =>
      nextCursor ? qc.prefetchQuery(pageOptions(nextCursor)) : Promise.resolve(),
  };
}

export function useFormFillAnswers(filters: Omit<AnswerFilters, "cursor">) {
  return useFormFillCollection([...FORM_FILL_KEY, "answers", filters], (cursor) =>
    api.listFormFillAnswers({ ...filters, cursor }),
  );
}

export function useFormFillAnswerCandidates(
  questionId: string,
  questionRevision: number,
  filters: Omit<AnswerCandidateFilters, "cursor">,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: [...FORM_FILL_KEY, "answer-candidates", questionId, questionRevision, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.listFormFillAnswerCandidates(questionId, { ...filters, cursor: pageParam }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled,
    gcTime: 0,
    retry: false,
  });
}

export function useFormFillAnswer(answerId: string | null) {
  return useQuery({
    queryKey: answerDetailKey(answerId ?? ""),
    queryFn: () => api.getFormFillAnswer(answerId as string),
    enabled: answerId != null,
    retry: 1,
  });
}

export function useFormFillCaptures(filters: Omit<CaptureFilters, "cursor">) {
  return useFormFillCollection(
    [...FORM_FILL_KEY, "captures", filters],
    (cursor) => api.listFormFillCaptures({ ...filters, cursor }),
    true,
  );
}

export function useFormFillCapture(captureId: string | null) {
  return useQuery({
    queryKey: captureDetailKey(captureId ?? ""),
    queryFn: () => api.getFormFillCapture(captureId as string),
    enabled: captureId != null,
    retry: 1,
  });
}

export function useFormFillConflictCaptures(captureIds: string[]) {
  return useQueries({
    queries: captureIds.map((captureId) => ({
      queryKey: captureDetailKey(captureId),
      queryFn: () => api.getFormFillCapture(captureId),
      retry: 1,
    })),
  });
}

export function useFormFillQuestions(filters: Omit<QuestionFilters, "cursor">) {
  return useFormFillCollection(
    [...FORM_FILL_KEY, "questions", filters],
    (cursor) => api.listFormFillQuestions({ ...filters, cursor }),
    true,
  );
}

export function useFormFillQuestion(questionId: string | null) {
  return useQuery({
    queryKey: questionDetailKey(questionId ?? ""),
    queryFn: () => api.getFormFillQuestion(questionId as string),
    enabled: questionId != null,
    retry: 1,
  });
}

export function useFormFillReviewPresence() {
  const capture = useQuery({
    queryKey: [...FORM_FILL_KEY, "presence", "captures"] as const,
    queryFn: () => api.listFormFillCaptures({ status: "current", limit: 1 }),
    refetchInterval: FORM_FILL_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const question = useQuery({
    queryKey: [...FORM_FILL_KEY, "presence", "questions"] as const,
    queryFn: () => api.listFormFillQuestions({ needs_review: true, limit: 1 }),
    refetchInterval: FORM_FILL_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const hasCaptures = !!capture.data?.items.length;
  const hasQuestions = !!question.data?.items.length;
  return {
    hasReview: hasCaptures || hasQuestions,
    hasCaptures,
    hasQuestions,
    isLoading: capture.isLoading || question.isLoading,
  };
}

function useFormFillMutation<TVariables, TData>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: FORM_FILL_KEY }),
  });
}

export function useCreateFormFillAnswer() {
  return useFormFillMutation((body: AnswerCreate) => api.createFormFillAnswer(body));
}

export function useCreateFormFillAnswerForQuestion() {
  return useFormFillMutation(
    ({ questionId, body }: { questionId: string; body: QuestionAnswerCreate }) =>
      api.createFormFillAnswerForQuestion(questionId, body),
  );
}

export function useUpdateFormFillAnswer() {
  return useFormFillMutation(({ answerId, body }: { answerId: string; body: AnswerUpdate }) =>
    api.updateFormFillAnswer(answerId, body),
  );
}

export function useUpdateFormFillCapture() {
  return useFormFillMutation(({ captureId, body }: { captureId: string; body: CaptureUpdate }) =>
    api.updateFormFillCapture(captureId, body),
  );
}

export function useApplyFormFillCapture() {
  return useFormFillMutation(({ captureId, body }: { captureId: string; body: CaptureApply }) =>
    api.applyFormFillCapture(captureId, body),
  );
}

export function useUpdateFormFillQuestion() {
  return useFormFillMutation(
    ({ questionId, body }: { questionId: string; body: QuestionReviewUpdate }) =>
      api.updateFormFillQuestion(questionId, body),
  );
}

export function usePutFormFillMapping() {
  return useFormFillMutation(({ questionId, body }: { questionId: string; body: MappingPut }) =>
    api.putFormFillMapping(questionId, body),
  );
}

export function useUpdateFormFillMapping() {
  return useFormFillMutation(({ questionId, body }: { questionId: string; body: MappingUpdate }) =>
    api.updateFormFillMapping(questionId, body),
  );
}

export function useResolveFormFillCaptureConflict() {
  return useFormFillMutation(
    ({ questionId, body }: { questionId: string; body: CaptureConflictResolve }) =>
      api.resolveFormFillCaptureConflict(questionId, body),
  );
}

export function useRemoveFormFillDetail() {
  const qc = useQueryClient();
  return useCallback(
    (kind: "answer" | "capture" | "question", id: string) => {
      qc.removeQueries({ queryKey: [...FORM_FILL_KEY, kind, id], exact: true });
    },
    [qc],
  );
}
