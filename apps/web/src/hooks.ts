import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./api/client";
import type {
  AnswerCreate,
  AnswerFilters,
  AnswerUpdate,
  CaptureApply,
  CaptureConflictResolve,
  CaptureFilters,
  CaptureUpdate,
  MappingPut,
  MappingUpdate,
  QuestionFilters,
  QuestionReviewUpdate,
} from "./api/client";
import type {
  DocumentCreate,
  DocumentUpdate,
  EventItem,
  JobDetail,
  JobState,
  JobSummary,
  ListingCreate,
  ListingUpdate,
} from "@job-tracker/shared/api";
import { isStatusSettingEvent, type Status } from "@job-tracker/shared/funnel";

const JOBS_KEY = ["jobs"] as const;
const jobKey = (id: string) => ["job", id] as const;

// The board loads every job once, at single-user scale, and derives search, hidden,
// and column bucketing client-side, so toggling a filter never refetches or flickers.
// stubs:false drops title-less rows — bare seen/closed/auto-hide events that never got
// a listing capture, with nothing actionable to show. Backfill scripts still see them
// through the unfiltered endpoint.
export function useJobs() {
  return useQuery({ queryKey: JOBS_KEY, queryFn: () => api.listJobs({ stubs: false }) });
}

// Manually add a job by creating a listing, which the server auto-creates the job
// for. The new row can land in any board column, so refetch the whole list rather
// than splice; the caller opens the returned job to fill in the rest.
export function useCreateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ListingCreate) => api.createListing(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: JOBS_KEY }),
  });
}

// Likely reposts of a listing — the duplicates the relink picker floats to the top.
// Keyed by the listing's natural key plus the owning job's title/company, and
// disabled until both are known, since the server needs both to suggest anything.
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

// The drawer's read. It renders an explicit error state with Retry, so a failure must
// become observable quickly rather than hide behind react-query's default three
// backed-off retries — that delay is what made a failed fetch look like a drawer stuck
// on "Loading…". One retry absorbs a transient blip; anything worse surfaces.
export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: jobKey(jobId ?? ""),
    queryFn: () => api.getJob(jobId as string),
    enabled: jobId != null,
    retry: 1,
  });
}

// Replay the submitted events onto a state locally, the same projection the server
// does, so drags and toggles reflect instantly before the round-trip lands.
function project(base: JobState, events: EventItem[]): JobState {
  let { status, hidden, starred } = base;
  for (const { event } of events) {
    if (event === "hidden") hidden = true;
    else if (event === "unhidden") hidden = false;
    else if (event === "starred") starred = true;
    else if (event === "unstarred") starred = false;
    else if (event === "note")
      continue; // a note sets no state
    else status = event as Status; // funnel event name == the status it sets
  }
  return { status, hidden, starred };
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
      qc.setQueryData<JobSummary[]>(JOBS_KEY, (jobs) =>
        jobs?.map((j) => (j.id === jobId ? { ...j, ...state } : j)),
      );
      qc.setQueryData<JobDetail>(jobKey(jobId), (job) => (job ? { ...job, ...state } : job));
      void qc.invalidateQueries({ queryKey: jobKey(jobId) });
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

// Corrections return authoritative state and change the timeline, so update the
// list from the response and refetch the detail.
export function useCorrectStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, status, reason }: { jobId: string; status: Status; reason?: string }) =>
      api.correctStatus(jobId, status, reason),
    onSuccess: (state, { jobId }) => {
      qc.setQueryData<JobSummary[]>(JOBS_KEY, (jobs) =>
        jobs?.map((j) => (j.id === jobId ? { ...j, ...state, attention: null } : j)),
      );
      qc.setQueryData<JobDetail>(jobKey(jobId), (job) => (job ? { ...job, ...state } : job));
      void qc.invalidateQueries({ queryKey: jobKey(jobId) });
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

export function useRevertStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.revertStatus(jobId),
    onSuccess: (state, jobId) => {
      qc.setQueryData<JobSummary[]>(JOBS_KEY, (jobs) =>
        jobs?.map((j) => (j.id === jobId ? { ...j, ...state, attention: null } : j)),
      );
      qc.setQueryData<JobDetail>(jobKey(jobId), (job) => (job ? { ...job, ...state } : job));
      void qc.invalidateQueries({ queryKey: jobKey(jobId) });
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

// The `meta` vocabulary for fuzzy field suggestions. Cheap and rarely-changing, so a
// long stale window keeps the drawer snappy.
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

// Record a manual note. It changes no funnel state but resets the attention
// clock, so clear the summary projection immediately and reconcile both reads.
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

// The note-title suggestion pool. Cheap and slow-changing, so a long stale window
// keeps the note form snappy.
export function useNoteTitles() {
  return useQuery({
    queryKey: ["note-titles"] as const,
    queryFn: () => api.noteTitles(),
    staleTime: 60_000,
  });
}

// Delete a manual note event. Funnel state stays put, but removing the newest
// activity can restore attention, so reconcile the timeline and summaries.
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

// ── Company blocklist ────────────────────────────────────────────────────────
// The list the extension enforces to skip capture and hide cards; this dashboard is
// its management surface. Rarely changes, so a long stale window keeps it quiet.
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

// Relink a listing to a different job, through the shared link_listing_to_job
// cascade. The source job may be dissolved server-side if this was its last listing,
// and the target gains the listing plus its attributed events, so the board and both
// job details are refetched. Returns the new owning job's id.
export function useRelinkListing() {
  const qc = useQueryClient();
  return useMutation({
    // sourceJobId is the job the listing is leaving, carried so its detail can be
    // refreshed — or dropped, once dissolved — alongside the target's.
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

// ── Form Fill knowledge workspace ───────────────────────────────────────────
// Knowledge is server-authoritative: none of these mutations has onMutate or writes
// query data. A successful write invalidates the whole bounded workspace graph so
// Answer, Question, Match, Capture, presence, and detail projections stay coherent.

const FORM_FILL_KEY = ["form-fill"] as const;
const answerDetailKey = (id: string) => [...FORM_FILL_KEY, "answer", id] as const;
const captureDetailKey = (id: string) => [...FORM_FILL_KEY, "capture", id] as const;
const questionDetailKey = (id: string) => [...FORM_FILL_KEY, "question", id] as const;

export function useFormFillAnswers(filters: Omit<AnswerFilters, "cursor">) {
  return useInfiniteQuery({
    queryKey: [...FORM_FILL_KEY, "answers", filters] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listFormFillAnswers({ ...filters, cursor: pageParam }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
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
  return useInfiniteQuery({
    queryKey: [...FORM_FILL_KEY, "captures", filters] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listFormFillCaptures({ ...filters, cursor: pageParam }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
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
  return useInfiniteQuery({
    queryKey: [...FORM_FILL_KEY, "questions", filters] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listFormFillQuestions({ ...filters, cursor: pageParam }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
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
  });
  const question = useQuery({
    queryKey: [...FORM_FILL_KEY, "presence", "questions"] as const,
    queryFn: () => api.listFormFillQuestions({ review_state: "open", limit: 1 }),
  });
  return {
    hasReview: !!capture.data?.items.length || !!question.data?.items.length,
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
  return (kind: "answer" | "capture" | "question", id: string) => {
    qc.removeQueries({ queryKey: [...FORM_FILL_KEY, kind, id], exact: true });
  };
}

// Edit a listing's own fields (url, JD in meta, …). Exposed only for manual listings:
// captured ones are scraper-owned, and a re-capture would clobber the edit. Both the
// board rollup, where a url change moves the card link, and the detail may shift.
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
    // jobId is carried to refresh the right detail. The server may have dissolved the
    // job if this was its last listing, so the board list is re-fetched regardless.
    mutationFn: ({ listingId }: { listingId: string; jobId: string }) =>
      api.deleteListing(listingId),
    onSuccess: (_void, { jobId }) => {
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
      void qc.invalidateQueries({ queryKey: jobKey(jobId) });
    },
  });
}
