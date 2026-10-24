import { fmtDate } from "@job-tracker/shared/time";
import type { JobSummary } from "@job-tracker/shared/api";
import { Tooltip } from "./Tooltip";

export function AvailabilityLabel({
  closed,
  date,
  observedAt,
  message,
}: {
  closed: boolean;
  date?: string | null;
  observedAt?: string | null;
  message?: string | null;
}) {
  const label = closed ? "Closed" : "Unavailable";
  const text = `${label}${date ? ` ${fmtDate(date)}` : ""}`;
  const detail =
    [
      message,
      closed && date ? `Listing closed ${new Date(date).toLocaleString()}` : null,
      observedAt ? `Availability observed ${new Date(observedAt).toLocaleString()}` : null,
    ]
      .filter(Boolean)
      .join(". ") || `Applications ${label.toLowerCase()}`;
  return (
    <Tooltip label={detail} stopPropagation>
      <span
        tabIndex={0}
        aria-label={`Listing ${text.toLowerCase()}`}
        className={closed ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300"}
      >
        {date ? <time dateTime={date}>{text}</time> : text}
      </span>
    </Tooltip>
  );
}

export function JobListingAvailability({ job }: { job: JobSummary }) {
  if (job.availability === "unavailable")
    return <AvailabilityLabel closed={false} message="A listing is unavailable" />;
  if (job.availability === "closed")
    return <AvailabilityLabel closed message="A listing is closed" />;
  return null;
}
