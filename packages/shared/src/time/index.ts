// Shared timeline formatting, relative-age parsing, and local date-input helpers.
import { platformMeta } from "../platforms";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function fmtAbsolute(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// A locale-independent local calendar date, such as `3 Jul 2026`.
export function fmtDate(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

// Compact span between two instants ("just now", "3h", "8d"). Rounds down to the
// coarsest whole unit — precise enough for "how long in this stage".
export function fmtSpan(fromTs: string, toTs: string | number = Date.now()): string {
  const from = new Date(fromTs).getTime();
  const to = typeof toTs === "number" ? toTs : new Date(toTs).getTime();
  if (isNaN(from) || isNaN(to)) return "";
  const ms = Math.max(0, to - from);
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

// "3d ago" — a relative read anchored to now.
export function fmtRelative(ts: string): string {
  const span = fmtSpan(ts);
  return span === "just now" ? span : `${span} ago`;
}

// Resolve relative ages at capture time so stored dates do not drift. Months and
// years use clamped UTC calendar subtraction; smaller units use elapsed duration.
// The Python port is checked against relative_age.golden.json.

export type PostedPrecision = "exact" | "estimated";

export interface ParsedRelativeAge {
  at: string;
  precision: "estimated";
}

type AgeUnit = "minute" | "hour" | "day" | "week" | "month" | "year";

const UNIT_ALIASES: Record<string, AgeUnit> = {
  min: "minute",
  mins: "minute",
  minute: "minute",
  minutes: "minute",
  hr: "hour",
  hrs: "hour",
  hour: "hour",
  hours: "hour",
  day: "day",
  days: "day",
  week: "week",
  weeks: "week",
  wk: "week",
  wks: "week",
  month: "month",
  months: "month",
  mo: "month",
  mos: "month",
  year: "year",
  years: "year",
  yr: "year",
  yrs: "year",
};

const ELAPSED_MS: Partial<Record<AgeUnit, number>> = {
  minute: MINUTE,
  hour: HOUR,
  day: DAY,
  week: 7 * DAY,
};

// Reject implausible counts as scrape errors.
const MAX_COUNT = 1000;

// Scraped and legacy evidence is untrusted. Keep these patterns linear independently
// of the whitespace normalization at their call sites.
const AGE_RE =
  /\b(\d{1,5}|an?|one)(?:\s+|\s*\+\s*)?(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?)\b/;
const BARE_AGE_REMAINDER_RE = /^(?:posted|reposted|listed)?[^a-z]*$/;

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// Preserve time of day while clamping the day at month end.
function subtractUtcMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const monthIndex = from.getUTCMonth();
  const day = from.getUTCDate();
  const target = new Date(
    Date.UTC(
      year,
      monthIndex - months,
      1,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
  const dim = daysInUtcMonth(target.getUTCFullYear(), target.getUTCMonth());
  target.setUTCDate(Math.min(day, dim));
  return target;
}

/**
 * Resolve a scraped relative age against the instant it was captured.
 *
 * Returns `null` — never a guess — when the text carries no age, when the count or
 * unit is unrecognised, or when `capturedAt` is unparseable. Callers store the raw
 * text as evidence regardless.
 */
export function parseRelativeAge(text: string, capturedAt: string): ParsedRelativeAge | null {
  if (typeof text !== "string" || typeof capturedAt !== "string") return null;
  const anchor = new Date(capturedAt);
  if (isNaN(anchor.getTime())) return null;

  const s = text.toLowerCase().trim().replace(/\s+/g, " ");
  if (!s) return null;

  // Keyword forms carry no number.
  if (/\b(just now|moments? ago|today)\b/.test(s)) {
    return { at: anchor.toISOString(), precision: "estimated" };
  }
  if (/\byesterday\b/.test(s)) {
    return { at: new Date(anchor.getTime() - DAY).toISOString(), precision: "estimated" };
  }

  const m = AGE_RE.exec(s);
  if (!m) return null;

  // "30 days remaining" is a deadline, not an age — the same shape pointing the other
  // way. Only accept a bare age phrase, or one explicitly marked as past.
  const isPast = /\bago\b/.test(s) || BARE_AGE_REMAINDER_RE.test(s.replace(m[0], ""));
  if (!isPast) return null;

  const rawCount = m[1];
  const count = /^\d+$/.test(rawCount) ? Number(rawCount) : 1;
  if (!Number.isFinite(count) || count < 0 || count > MAX_COUNT) return null;

  const unit = UNIT_ALIASES[m[2]];
  if (!unit) return null;

  const elapsed = ELAPSED_MS[unit];
  const at =
    elapsed !== undefined
      ? new Date(anchor.getTime() - count * elapsed)
      : subtractUtcMonths(anchor, unit === "year" ? count * 12 : count);

  if (isNaN(at.getTime())) return null;
  return { at: at.toISOString(), precision: "estimated" };
}

// Display estimates only to the precision of their evidence: day for hours, days,
// and weeks; month for months; year for years. Exact source dates keep day precision.

/** Metadata consumed by the posting-date display rather than rendered as custom fields. */
export const POSTED_META_KEYS = ["posted_at", "posted_precision", "posted_age", "posted_date"];

/** Coarsest unit the evidence named — the finest unit the label may use. */
export type PostedGrain = "day" | "month" | "year";

export interface PostedRead {
  /** Evidence-grained date, prefixed `~` when estimated, or `"unknown"`. */
  text: string;
  /** What it was derived from and when the page was captured. Plain text. */
  tooltip: string;
  known: boolean;
}

/** The grain of a scraped relative age, or `null` when it names no age. */
export function postedGrain(raw: string | null | undefined): PostedGrain | null {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().trim().replace(/\s+/g, " ");
  if (!s) return null;
  if (/\b(just now|moments? ago|today|yesterday)\b/.test(s)) return "day";
  const m = AGE_RE.exec(s);
  const unit = m ? UNIT_ALIASES[m[2]] : undefined;
  if (!unit) return null;
  if (unit === "year") return "year";
  if (unit === "month") return "month";
  return "day";
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function atGrain(ts: string, grain: PostedGrain): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  if (grain === "year") return String(d.getFullYear());
  if (grain === "month") return `${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  return fmtDate(ts);
}

/**
 * Read a listing's posting date for display.
 *
 * Accepts either normalized `posted_at` metadata or raw capture evidence.
 */
export function readPosted(
  meta: Record<string, unknown> | null | undefined,
  opts: { platform?: string | null; capturedAt?: string | null } = {},
): PostedRead {
  const bag = meta ?? {};
  const capturedAt = str(opts.capturedAt);
  const captured = capturedAt ? ` Listing captured ${fmtDate(capturedAt)}.` : "";
  const evidence = str(bag.posted_age);

  let at = str(bag.posted_at);
  let estimated = str(bag.posted_precision) !== "exact";

  if (!at) {
    // Compatibility path for captures that contain only raw posting-date evidence.
    const trusted = !platformMeta(str(opts.platform).toLowerCase())?.untrustedExactDate;
    const legacyExact = trusted ? str(bag.posted_date) : "";
    if (legacyExact && !isNaN(new Date(legacyExact).getTime())) {
      at = new Date(legacyExact).toISOString();
      estimated = false;
    } else if (evidence && capturedAt) {
      const parsed = parseRelativeAge(evidence, capturedAt);
      if (parsed) {
        at = parsed.at;
        estimated = true;
      }
    }
  }

  if (!at || isNaN(new Date(at).getTime())) {
    return {
      known: false,
      text: "unknown",
      tooltip: `The captured page carried no posting date.${captured}`,
    };
  }

  const grain = estimated ? (postedGrain(evidence) ?? "day") : "day";
  const text = `${estimated ? "~" : ""}${atGrain(at, grain)}`;

  if (!estimated) {
    return { known: true, text, tooltip: `Exact date from the posting page.${captured}` };
  }
  const from = evidence ? ` from “${evidence}”` : "";
  const accuracy = grain === "day" ? "the day" : grain === "month" ? "the month" : "the year";
  return {
    known: true,
    text,
    tooltip: `Estimated${from} on the posting page — accurate to ${accuracy}, not the date shown.${captured}`,
  };
}

// A UTC instant's local calendar day for date inputs.
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Convert a UTC instant to a local datetime input value.
export function toDatetimeLocalValue(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${localDay(ts)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
