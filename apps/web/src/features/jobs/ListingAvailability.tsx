import { copy } from "./copy";
import { localDateTime } from "../../shared/format";
import { fmtDate } from "@job-tracker/shared/time";
import type { JobSummary } from "@job-tracker/shared/api";
import { Tooltip } from "../../shared/ui/Tooltip";

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
  const label = closed ? copy.availability.closed : copy.availability.unavailable;
  const text = `${label}${date ? ` ${fmtDate(date)}` : ""}`;
  const detail =
    [
      message,
      closed && date ? copy.listingAvailability.listingClosed(localDateTime(date)) : null,
      observedAt ? copy.listingAvailability.availabilityObserved(localDateTime(observedAt)) : null,
    ]
      .filter(Boolean)
      .join(". ") || copy.availability.applications(closed);
  return (
    <Tooltip label={detail} stopPropagation>
      <span
        tabIndex={0}
        aria-label={copy.listingAvailability.listing(text.toLowerCase())}
        className={closed ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300"}
      >
        {date ? <time dateTime={date}>{text}</time> : text}
      </span>
    </Tooltip>
  );
}

export function JobListingAvailability({ job }: { job: JobSummary }) {
  if (job.availability === "unavailable")
    return <AvailabilityLabel closed={false} message={copy.availability.listingUnavailable} />;
  if (job.availability === "closed")
    return <AvailabilityLabel closed message={copy.availability.listingClosed} />;
  return null;
}
