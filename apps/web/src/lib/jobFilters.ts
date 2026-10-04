import type { BlockedCompany, JobSummary } from "@job-tracker/shared/api";
import { normalizeCompany } from "@job-tracker/shared/text";

export interface JobViewFilters {
  search: string;
  hideHidden: boolean;
  showStarred: boolean;
  showAttention: boolean;
  hideBlocked: boolean;
  easyApplyOnly: boolean;
}

// A '*' block applies everywhere; a platform-scoped block applies only when the job
// has a listing on that platform, matching the extension's blocklist semantics.
export function isJobBlocked(job: JobSummary, blocked: BlockedCompany[]): boolean {
  const key = job.company_key ?? normalizeCompany(job.company);
  if (!key) return false;
  return blocked.some(
    (b) => b.company_key === key && (b.platform === "*" || job.platforms.includes(b.platform)),
  );
}

export function isEasyApply(job: JobSummary): boolean {
  return job.apply_types.includes("easy_apply");
}

// Attention is a narrowing filter over the complete client-side job set, with
// AND semantics alongside the other filters. Hidden jobs never participate in the
// attention view even when the general hide-hidden preference is off.
export function filterJobs(
  jobs: JobSummary[],
  filters: JobViewFilters,
  blocked: BlockedCompany[] = [],
): JobSummary[] {
  const query = filters.search.trim().toLowerCase();
  return jobs.filter((job) => {
    if (filters.hideHidden && job.hidden) return false;
    if (filters.showStarred && !job.starred) return false;
    if (filters.showAttention && (job.hidden || job.attention == null)) return false;
    if (filters.hideBlocked && isJobBlocked(job, blocked)) return false;
    if (filters.easyApplyOnly && !isEasyApply(job)) return false;
    if (!query) return true;
    return (
      (job.title ?? "").toLowerCase().includes(query) ||
      (job.company ?? "").toLowerCase().includes(query)
    );
  });
}

// The badge is global to the loaded set: search and starred do not change it.
export function countAttention(jobs: JobSummary[]): number {
  return jobs.filter((job) => !job.hidden && job.attention != null).length;
}
