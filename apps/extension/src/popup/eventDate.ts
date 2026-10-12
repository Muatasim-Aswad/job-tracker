// Status dates default to the suggested email day or today; reset means today.
// Preserve exact email time, let the server timestamp today, and use noon-local
// for other days. Notes and comments do not use this picker.
import { localDay } from "@job-tracker/shared/time";

// Today as the picker's YYYY-MM-DD (its non-blank default and "now" reset value).
export function todayDay(): string {
  return localDay(new Date().toISOString());
}

// The chip's text: a short label for a YYYY-MM-DD ("Jul 12"). Parsed at noon-local, so
// the day never shifts under a negative-offset timezone the way a bare date parsed as
// UTC midnight would. Falls back to the raw string when the day doesn't parse.
export function shortDate(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// The `ts` to POST for an event dated on `eventDate`:
//   • the suggested email's day → its full ISO, keeping the mail's real clock time
//     even when that day is today.
//   • today → undefined: no override, the server stamps exact now().
//   • any other day → noon-local ISO on it, avoiding a UTC day-shift.
export function chooseTs(eventDate: string, suggestedTs: string | null): string | undefined {
  if (suggestedTs && eventDate === localDay(suggestedTs)) return suggestedTs;
  if (eventDate === todayDay()) return undefined;
  return new Date(`${eventDate}T12:00:00`).toISOString();
}
