import type { JobSummary } from "@job-tracker/shared/api";

export const SORT_OPTIONS = [
  { value: "recently_updated", label: "Updated (newest)" },
  { value: "least_recently_updated", label: "Updated (oldest)" },
  { value: "newest_added", label: "Added (newest)" },
  { value: "oldest_added", label: "Added (oldest)" },
  { value: "title_az", label: "Title (A–Z)" },
  { value: "title_za", label: "Title (Z–A)" },
] as const;

export type SortOrder = (typeof SORT_OPTIONS)[number]["value"];

export const DEFAULT_SORT_ORDER: SortOrder = "recently_updated";
export const SORT_ORDER_VALUES = SORT_OPTIONS.map((option) => option.value);

const textCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function compareText(a: string | null | undefined, b: string | null | undefined): number {
  const left = a?.trim() ?? "";
  const right = b?.trim() ?? "";
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return textCollator.compare(left, right);
}

function compareTitle(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: 1 | -1,
): number {
  const left = a?.trim() ?? "";
  const right = b?.trim() ?? "";
  // Untitled jobs always follow named jobs, including for Z-A.
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return direction * textCollator.compare(left, right);
}

function compareId(a: JobSummary, b: JobSummary): number {
  return textCollator.compare(a.id, b.id);
}

function compareTitleCompanyId(a: JobSummary, b: JobSummary): number {
  return compareText(a.title, b.title) || compareText(a.company, b.company) || compareId(a, b);
}

function compareCompanyId(a: JobSummary, b: JobSummary): number {
  return compareText(a.company, b.company) || compareId(a, b);
}

function compareTimestamp(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b);
}

export const JOB_COMPARATORS: Record<SortOrder, (a: JobSummary, b: JobSummary) => number> = {
  recently_updated: (a, b) =>
    compareTimestamp(b.updated_at, a.updated_at) || compareTitleCompanyId(a, b),
  least_recently_updated: (a, b) =>
    compareTimestamp(a.updated_at, b.updated_at) || compareTitleCompanyId(a, b),
  newest_added: (a, b) =>
    compareTimestamp(b.created_at, a.created_at) || compareTitleCompanyId(a, b),
  oldest_added: (a, b) =>
    compareTimestamp(a.created_at, b.created_at) || compareTitleCompanyId(a, b),
  title_az: (a, b) => compareTitle(a.title, b.title, 1) || compareCompanyId(a, b),
  title_za: (a, b) => compareTitle(a.title, b.title, -1) || compareCompanyId(a, b),
};

// Copy the query-cache array; per-column filters preserve the chosen order.
export function sortJobs(jobs: JobSummary[], order: SortOrder): JobSummary[] {
  return jobs.toSorted(JOB_COMPARATORS[order]);
}
