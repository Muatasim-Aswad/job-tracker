import { fmtDate } from "@job-tracker/shared/time";
import type { JobSummary } from "@job-tracker/shared/api";
import { Tooltip } from "./Tooltip";

export function AvailabilityLabel({
  closed,
  date,
  observedAt,
  message,
  count,
}: {
  closed: boolean;
  date?: string | null;
  observedAt?: string | null;
  message?: string | null;
  count?: number;
}) {
  const label = closed ? "Closed" : "Unavailable";
  const text =
    count === undefined
      ? `${label}${date ? ` ${fmtDate(date)}` : ""}`
      : `${count} ${label.toLowerCase()}`;
  const detail =
    [
      message,
      closed && date ? `Listing closed ${new Date(date).toLocaleString()}` : null,
      observedAt ? `Availability observed ${new Date(observedAt).toLocaleString()}` : null,
      count !== undefined
        ? `${count} ${count === 1 ? "listing" : "listings"} ${label.toLowerCase()}`
        : null,
    ]
      .filter(Boolean)
      .join(". ") || `Applications ${label.toLowerCase()}`;
  return (
    <Tooltip label={detail} stopPropagation>
      <span
        tabIndex={0}
        aria-label={count === undefined ? `Listing ${text.toLowerCase()}` : text}
        className={closed ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300"}
      >
        {date && count === undefined ? <time dateTime={date}>{text}</time> : text}
      </span>
    </Tooltip>
  );
}

export function JobListingAvailability({ job }: { job: JobSummary }) {
  const availability = job.listing_availability;
  if (!availability) return null;
  if (job.listing_count === 1) {
    if (availability.closed_count)
      return <AvailabilityLabel closed date={availability.closed_at} />;
    if (availability.unavailable_count)
      return (
        <AvailabilityLabel
          closed={false}
          date={availability.unavailable_observed_at}
          observedAt={availability.unavailable_observed_at}
        />
      );
    return null;
  }
  return (
    <>
      {availability.unavailable_count > 0 && (
        <AvailabilityLabel closed={false} count={availability.unavailable_count} />
      )}
      {availability.closed_count > 0 && (
        <AvailabilityLabel closed count={availability.closed_count} />
      )}
    </>
  );
}
