import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "./api/client";
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
} from "./api/client";
import type {
  DocumentCreate,
  DocumentUpdate,
  EventItem,
  JobDetail,
  JobMutationState,
  JobState,
  JobSummary,
  ListingCreate,
  ListingUpdate,
} from "@job-tracker/shared/api";
import { isStatusSettingEvent, type Status } from "@job-tracker/shared/funnel";

const JOBS_KEY = ["jobs"] as const;
const jobKey = (id: string) => ["job", id] as const;

// Load the complete single-user job set for client-side filtering; exclude titleless stubs.
export function useJobs() {
  return useQuery({ queryKey: JOBS_KEY, queryFn: () => api.listJobs({ stubs: false }) });
}

// Refetch after manual listing creation because the new job can affect any column.
export function useCreateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ListingCreate) => api.createListing(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: JOBS_KEY }),
  });
}

// Suggestions require known title/company and track their natural-key context.
export function useJobMatches(
  platform: string,
  platformId: string,
  title: string,
  company: string,
) {
  return useQuery({
    queryKey: ["job-matches", platform, platformId, title, company] as const,
    queryFn: () => api.jobMatches(platform, platformId, title, company),
    enabled: !!title && !!company,
  });
}

// One retry absorbs transient failures while keeping drawer errors promptly observable.
export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: jobKey(jobId ?? ""),
    queryFn: () => api.getJob(jobId as string),
    enabled: jobId != null,
    retry: 1,
  });
}

// Project optimistic events locally before the server response.
function project(base: JobState, events: EventItem[]): JobState {
  let { status, hidden, starred } = base;
  for (const { event } of events) {
    if (event === "hidden") hidden = true;
    else if (event === "unhidden") hidden = false;
    else if (event === "starred") starred = true;
    else if (event === "unstarred") starred = false;
    else if (event === "note") continue; // a note sets no state
    else status = event as Status; // funnel event name == the status it sets
  }
  return { status, hidden, starred };
}

function settledState(state: JobMutationState): JobState {
  return { status: state.status, hidden: state.hidden, starred: state.starred };
}

interface EventVars {
  jobId: string;
  events: EventItem[];
}

export function useJobEvents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, events }: EventVars) => api.postEvents(jobId, events),
    onMutate: async ({ jobId, events }) => {
      await qc.cancelQueries({ queryKey: JOBS_KEY });
      const prev = qc.getQueryData<JobSummary[]>(JOBS_KEY);
      const clearsAttention = events.some(
        ({ event }) => event === "note" || isStatusSettingEvent(event),
      );
      qc.setQueryData<JobSummary[]>(JOBS_KEY, (jobs) =>
        jobs?.map((j) =>
          j.id === jobId
            ? { ...j, ...project(j, events), ...(clearsAttention ? { attention: null } : {}) }
            : j,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(JOBS_KEY, ctx.prev);
    },
    onSuccess: (state, { jobId }) => {
      // Reconcile with the server's authoritative projection.
      const settled = settledState(state);
      qc.setQueryData<JobSummary[]>(JOBS_KEY, (jobs) =>
        jobs?.map((j) => (j.id === state.job_id ? { ...j, ...settled } : j)),
      );
      qc.setQueryData<JobDetail>(jobKey(state.job_id), (job) =>
        job ? { ...job, ...settled } : job,
      );
      void qc.invalidateQueries({ queryKey: jobKey(jobId) });
      if (state.job_id !== jobId) void qc.invalidateQueries({ queryKey: jobKey(state.job_id) });
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

// Apply authoritative correction state and refetch the timeline.
export function useCorrectStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, status, reason }: { jobId: string; status: Status; reason?: string }) =>
      api.correctStatus(jobId, status, reason),
    onSuccess: (state, { jobId }) => {
      const settled = settledState(state);
      qc.setQueryData<JobSummary[]>(JOBS_KEY, (jobs) =>
        jobs?.map((j) => (j.id === state.job_id ? { ...j, ...settled, attention: null } : j)),
      );
      qc.setQueryData<JobDetail>(jobKey(state.job_id), (job) =>
        job ? { ...job, ...settled } : job,
      );
      void qc.invalidateQueries({ queryKey: jobKey(jobId) });
      if (state.job_id !== jobId) void qc.invalidateQueries({ queryKey: jobKey(state.job_id) });
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

export function useRevertStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.revertStatus(jobId),
    onSuccess: (state, jobId) => {
      const settled = settledState(state);
      qc.setQueryData<JobSummary[]>(JOBS_KEY, (jobs) =>
        jobs?.map((j) => (j.id === state.job_id ? { ...j, ...settled, attention: null } : j)),
      );
      qc.setQueryData<JobDetail>(jobKey(state.job_id), (job) =>
        job ? { ...job, ...settled } : job,
      );
      void qc.invalidateQueries({ queryKey: jobKey(jobId) });
      if (state.job_id !== jobId) void qc.invalidateQueries({ queryKey: jobKey(state.job_id) });
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

export function useUpdateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      body,
    }: {
      jobId: string;
      body: { title?: string; company?: string; meta?: Record<string, unknown> };
    }) => api.updateJob(jobId, body),
    onSuccess: (job) => {
      qc.setQueryData<JobSummary[]>(JOBS_KEY, (jobs) =>
        jobs?.map((j) => (j.id === job.id ? { ...j, ...job } : j)),
      );
      qc.setQueryData<JobDetail>(jobKey(job.id), (d) => (d ? { ...d, ...job } : d));
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

// Metadata vocabulary changes slowly, allowing a long stale window.
export function useMetaVocabulary(entity = "jobs") {
  return useQuery({
    queryKey: ["meta-vocabulary", entity] as const,
    queryFn: () => api.metaVocabulary(entity),
    staleTime: 60_000,
  });
}

// Timestamp changes can affect attention, so refresh detail and summaries.
export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventId,
      meta,
      ts,
    }: {
      eventId: number;
      meta?: Record<string, unknown> | null;
      ts?: string;
      jobId: string;
    }) =>
      api.updateEvent(eventId, { ...(meta !== undefined ? { meta } : {}), ...(ts ? { ts } : {}) }),
    onSuccess: (_ev, { jobId }) => {
      void qc.invalidateQueries({ queryKey: jobKey(jobId) });
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

// Notes reset attention without moving state; clear attention and reconcile both reads.
export function useAddNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, meta }: { jobId: string; meta: { title?: string; note?: string } }) =>
      api.addNote(jobId, meta),
    onSuccess: (_state, { jobId }) => {
      qc.setQueryData<JobSummary[]>(JOBS_KEY, (jobs) =>
        jobs?.map((job) => (job.id === jobId ? { ...job, attention: null } : job)),
      );
      void qc.invalidateQueries({ queryKey: jobKey(jobId) });
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

// Note-title vocabulary changes slowly, allowing a long stale window.
export function useNoteTitles() {
  return useQuery({
    queryKey: ["note-titles"] as const,
    queryFn: () => api.noteTitles(),
    staleTime: 60_000,
  });
}

// Deleting recent activity can restore attention; reconcile detail and summaries.
export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId }: { eventId: number; jobId: string }) => api.deleteEvent(eventId),
    onSuccess: (_void, { jobId }) => {
      void qc.invalidateQueries({ queryKey: jobKey(jobId) });
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

export function useAddDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, body }: { jobId: string; body: DocumentCreate }) =>
      api.addDocument(jobId, body),
    onSuccess: (_doc, { jobId }) => qc.invalidateQueries({ queryKey: jobKey(jobId) }),
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      body,
    }: {
      documentId: number;
      body: DocumentUpdate;
      jobId: string;
    }) => api.updateDocument(documentId, body),
    onSuccess: (_doc, { jobId }) => qc.invalidateQueries({ queryKey: jobKey(jobId) }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId }: { documentId: number; jobId: string }) =>
      api.deleteDocument(documentId),
    onSuccess: (_void, { jobId }) => qc.invalidateQueries({ queryKey: jobKey(jobId) }),
  });
}

// The extension enforces this blocklist; cache its infrequently changed management view.
const BLOCKED_KEY = ["blocked-companies"] as const;

export function useBlockedCompanies() {
  return useQuery({
    queryKey: BLOCKED_KEY,
    queryFn: () => api.listBlockedCompanies(),
    staleTime: 60_000,
  });
}

export function useBlockCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ company, platform }: { company: string; platform?: string }) =>
      api.blockCompany(company, platform),
    onSuccess: () => qc.invalidateQueries({ queryKey: BLOCKED_KEY }),
  });
}

export function useUnblockCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ companyKey, platform }: { companyKey: string; platform: string }) =>
      api.unblockCompany(companyKey, platform),
    onSuccess: () => qc.invalidateQueries({ queryKey: BLOCKED_KEY }),
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.deleteJob(jobId),
    onSuccess: (_void, jobId) => {
      qc.setQueryData<JobSummary[]>(JOBS_KEY, (jobs) => jobs?.filter((j) => j.id !== jobId));
      qc.removeQueries({ queryKey: jobKey(jobId) });
    },
  });
}

// Relinking moves events and may dissolve the source; refresh the board and both jobs.
export function useRelinkListing() {
  const qc = useQueryClient();
  return useMutation({
    // Retain sourceJobId to refresh or remove the old detail after relinking.
    mutationFn: ({
      listingId,
      targetJobId,
    }: {
      listingId: string;
      sourceJobId: string;
      targetJobId: string;
    }) => api.updateListing(listingId, { job_id: targetJobId }),
    onSuccess: (res, { sourceJobId }) => {
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
      void qc.invalidateQueries({ queryKey: jobKey(sourceJobId) });
      void qc.invalidateQueries({ queryKey: jobKey(res.job_id) });
    },
  });
}

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

// Only manual listings are editable; recapture owns scraped fields.
// Refresh board links and job details after editing.
export function useUpdateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, body }: { listingId: string; body: ListingUpdate; jobId: string }) =>
      api.updateListing(listingId, body),
    onSuccess: (_res, { jobId }) => {
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
      void qc.invalidateQueries({ queryKey: jobKey(jobId) });
    },
  });
}

export function useDeleteListing() {
  const qc = useQueryClient();
  return useMutation({
    // The last listing may dissolve its job; refresh the board as well as detail.
    mutationFn: ({ listingId }: { listingId: string; jobId: string }) =>
      api.deleteListing(listingId),
    onSuccess: (_void, { jobId }) => {
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
      void qc.invalidateQueries({ queryKey: jobKey(jobId) });
    },
  });
}
