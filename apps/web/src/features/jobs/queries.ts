import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";

import type {
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
export const jobKey = (id: string) => ["job", id] as const;

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
