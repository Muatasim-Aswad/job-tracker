import { ApiError, request, toQuery } from "../../infra/http";
import type {
  EventItem,
  Job,
  JobDetail,
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

function markManualClosures(events: EventItem[]): EventItem[] {
  return events.map((item) =>
    item.event === "closed" ? { ...item, meta: { ...item.meta, source: "manual" } } : item,
  );
}

export const api = {
  listJobs: (filters: JobFilters = {}): Promise<JobSummary[]> =>
    request(`/jobs${toQuery(filters)}`),

  getJob: (jobId: string): Promise<JobDetail> => request(`/jobs/${jobId}`),

  jobMatches: (
    platform: string,
    platformId: string,
    title: string,
    company: string,
  ): Promise<JobMatch[]> =>
    request(`/jobs/matches${toQuery({ platform, platform_id: platformId, title, company })}`),

  lookupListing: (
    platform: string,
    platformId: string,
  ): Promise<{ job_id: string; listing_id: string }> =>
    request(`/listings/lookup${toQuery({ platform, platform_id: platformId })}`),

  updateJob: (
    jobId: string,
    body: { title?: string; company?: string; meta?: Record<string, unknown> },
  ): Promise<Job> => request(`/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(body) }),

  createListing: (body: ListingCreate): Promise<{ job_id: string; listing_id: string }> =>
    request("/listings", { method: "POST", body: JSON.stringify(body) }),

  updateListing: (
    listingId: string,
    body: ListingUpdate,
  ): Promise<{ job_id: string; listing_id: string }> =>
    request(`/listings/${listingId}`, { method: "PATCH", body: JSON.stringify(body) }),

  postEvents: (jobId: string, events: EventItem[]): Promise<JobMutationState> =>
    request("/events", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, events: markManualClosures(events) }),
    }),

  correctStatus: (jobId: string, status: Status, reason?: string): Promise<JobMutationState> =>
    request(`/jobs/${jobId}/corrections`, {
      method: "POST",
      body: JSON.stringify({ status, reason }),
    }),

  revertStatus: (jobId: string): Promise<JobMutationState> =>
    request(`/jobs/${jobId}/status/revert`, { method: "POST" }),

  updateEvent: (
    eventId: number,
    body: { meta?: Record<string, unknown> | null; ts?: string },
  ): Promise<JobEvent> =>
    request(`/events/${eventId}`, { method: "PATCH", body: JSON.stringify(body) }),

  addNote: (jobId: string, meta: { title?: string; note?: string }): Promise<JobMutationState> =>
    request("/events", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, events: [{ event: "note", meta }] }),
    }),

  noteTitles: (): Promise<string[]> => request("/meta/note-titles"),

  deleteEvent: (eventId: number): Promise<void> =>
    request(`/events/${eventId}`, { method: "DELETE" }),

  metaVocabulary: (entity = "jobs"): Promise<MetaVocabulary> =>
    request(`/meta/vocabulary${toQuery({ entity })}`),

  deleteJob: (jobId: string): Promise<void> => request(`/jobs/${jobId}`, { method: "DELETE" }),

  deleteListing: (listingId: string): Promise<void> =>
    request(`/listings/${listingId}`, { method: "DELETE" }),
};
export { ApiError };
