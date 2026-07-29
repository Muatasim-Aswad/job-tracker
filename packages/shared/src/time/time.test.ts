import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fmtAbsolute,
  fmtDate,
  fmtRelative,
  fmtSpan,
  localDay,
  parseRelativeAge,
  postedGrain,
  readPosted,
  toDatetimeLocalValue,
} from "./index";
import { registerPlatform } from "../platforms";
import golden from "./relative_age.golden.json";
import { AGE_RE, BARE_AGE_REMAINDER_RE } from "./relativeAgePatterns";

describe("fmtAbsolute", () => {
  it("renders — for a null timestamp", () => {
    expect(fmtAbsolute(null)).toBe("—");
  });

  it("falls back to the raw string for an unparseable timestamp", () => {
    expect(fmtAbsolute("not-a-date")).toBe("not-a-date");
  });

  it("renders a locale string for a valid timestamp", () => {
    expect(fmtAbsolute("2026-01-01T00:00:00Z")).not.toBe("—");
  });
});

describe("fmtDate", () => {
  it("renders — for a null timestamp", () => {
    expect(fmtDate(null)).toBe("—");
  });

  it("falls back to the raw string for an unparseable timestamp", () => {
    expect(fmtDate("not-a-date")).toBe("not-a-date");
  });

  // The point of the format: a named month, so no reader has to know whether the
  // renderer put the day or the month first.
  it("names the month rather than emitting an order-ambiguous numeric date", () => {
    expect(fmtDate("2026-07-03T12:00:00Z")).toBe("3 Jul 2026");
    expect(fmtDate("2026-03-07T12:00:00Z")).toBe("7 Mar 2026");
  });

  it("does not pad the day", () => {
    expect(fmtDate("2026-01-09T12:00:00Z")).toBe("9 Jan 2026");
  });
});

describe("fmtSpan", () => {
  it("returns 'just now' for anything under a minute", () => {
    const now = Date.now();
    expect(fmtSpan(new Date(now - 30_000).toISOString(), now)).toBe("just now");
  });

  it("rounds down to whole minutes under an hour", () => {
    const now = Date.now();
    expect(fmtSpan(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5m");
  });

  it("rounds down to whole hours under a day", () => {
    const now = Date.now();
    expect(fmtSpan(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h");
  });

  it("rounds down to whole days at a day or more", () => {
    const now = Date.now();
    expect(fmtSpan(new Date(now - 8 * 86_400_000).toISOString(), now)).toBe("8d");
  });

  it("clamps a future 'from' to zero rather than going negative", () => {
    const now = Date.now();
    expect(fmtSpan(new Date(now + 60_000).toISOString(), now)).toBe("just now");
  });

  it("returns '' for an unparseable timestamp", () => {
    expect(fmtSpan("not-a-date")).toBe("");
  });
});

describe("fmtRelative", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("appends 'ago' to the span", () => {
    expect(fmtRelative("2026-01-07T00:00:00Z")).toBe("3d ago");
  });

  it("leaves 'just now' bare, without an 'ago' suffix", () => {
    expect(fmtRelative("2026-01-09T23:59:59Z")).toBe("just now");
  });
});

describe("localDay", () => {
  it("formats the local calendar day as YYYY-MM-DD", () => {
    const iso = "2026-03-05T12:00:00Z";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(localDay(iso)).toBe(expected);
  });

  it("returns '' for an unparseable timestamp", () => {
    expect(localDay("not-a-date")).toBe("");
  });
});

describe("toDatetimeLocalValue", () => {
  it("formats as YYYY-MM-DDTHH:mm in local time", () => {
    const iso = "2026-03-05T13:45:00Z";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${localDay(iso)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    expect(toDatetimeLocalValue(iso)).toBe(expected);
  });

  it("returns '' for an unparseable timestamp", () => {
    expect(toDatetimeLocalValue("not-a-date")).toBe("");
  });
});

// The Python port replays this fixture, keeping both implementations aligned
// when cases change.
describe("parseRelativeAge golden", () => {
  for (const c of golden.cases) {
    it(`${c.text || "<empty>"} @ ${c.captured_at} — ${c.why}`, () => {
      const got = parseRelativeAge(c.text, c.captured_at);
      if (c.at === null) {
        expect(got).toBeNull();
      } else {
        expect(got).toEqual({ at: c.at, precision: "estimated" });
      }
    });
  }
});

const UTC_DAY = 86_400_000;
const daysInUtcMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

describe("parseRelativeAge properties", () => {
  it("never returns an instant after the capture instant", () => {
    const units = ["minutes", "hours", "days", "weeks", "months", "years"];
    for (let y = 2020; y <= 2028; y++) {
      for (let m = 0; m < 12; m++) {
        const anchor = new Date(Date.UTC(y, m, daysInUtcMonth(y, m), 23, 59, 59));
        for (const unit of units) {
          for (const n of [1, 2, 3, 11, 13, 29, 47]) {
            const got = parseRelativeAge(`${n} ${unit} ago`, anchor.toISOString());
            expect(got).not.toBeNull();
            const at = new Date(got!.at);
            expect(isNaN(at.getTime())).toBe(false);
            expect(at.getTime()).toBeLessThanOrEqual(anchor.getTime());
          }
        }
      }
    }
  });

  it("lands on the same day-of-month, or clamps down to the target month's last day", () => {
    for (let y = 2020; y <= 2028; y++) {
      for (let m = 0; m < 12; m++) {
        for (const day of [1, 15, 28, 29, 30, 31]) {
          if (day > daysInUtcMonth(y, m)) continue;
          const anchor = new Date(Date.UTC(y, m, day, 12, 0, 0));
          for (let n = 1; n <= 24; n++) {
            const got = parseRelativeAge(`${n} months ago`, anchor.toISOString());
            const at = new Date(got!.at);
            // Exactly n calendar months back, whatever the day clamped to.
            const monthsBack =
              (anchor.getUTCFullYear() - at.getUTCFullYear()) * 12 +
              (anchor.getUTCMonth() - at.getUTCMonth());
            expect(monthsBack).toBe(n);
            const dim = daysInUtcMonth(at.getUTCFullYear(), at.getUTCMonth());
            expect(at.getUTCDate()).toBe(Math.min(day, dim));
            // Time of day survives calendar subtraction.
            expect(at.getUTCHours()).toBe(12);
          }
        }
      }
    }
  });

  it("resolves 29 February to 28 February one non-leap year earlier, every leap year", () => {
    for (let y = 2000; y <= 2100; y += 4) {
      if (y % 100 === 0 && y % 400 !== 0) continue; // not a leap year
      const anchor = `${y}-02-29T08:00:00Z`;
      const back1 = parseRelativeAge("1 year ago", anchor)!;
      expect(back1.at).toBe(`${y - 1}-02-28T08:00:00.000Z`);
      // Four years back is a leap year again (except across a skipped century).
      const back4 = parseRelativeAge("4 years ago", anchor)!;
      const prevLeap = y - 4;
      const prevIsLeap = prevLeap % 4 === 0 && (prevLeap % 100 !== 0 || prevLeap % 400 === 0);
      expect(back4.at).toBe(`${prevLeap}-02-${prevIsLeap ? 29 : 28}T08:00:00.000Z`);
    }
  });

  it("treats week/day/hour/minute as exact elapsed spans", () => {
    const anchor = "2026-03-01T00:00:00Z";
    const t = Date.parse(anchor);
    const spans: [string, number][] = [
      ["1 week ago", 7 * UTC_DAY],
      ["3 weeks ago", 21 * UTC_DAY],
      ["1 day ago", UTC_DAY],
      ["48 hours ago", 2 * UTC_DAY],
      ["90 minutes ago", 90 * 60_000],
    ];
    for (const [text, ms] of spans) {
      expect(parseRelativeAge(text, anchor)!.at).toBe(new Date(t - ms).toISOString());
    }
  });

  it("is idempotent — the same input always resolves to the same instant", () => {
    const anchor = "2026-07-03T12:00:00Z";
    for (const text of ["2 months ago", "17 days ago", "1 year ago", "just now"]) {
      expect(parseRelativeAge(text, anchor)).toEqual(parseRelativeAge(text, anchor));
    }
  });

  it("always reports estimated precision and a Z-suffixed UTC instant", () => {
    for (const text of ["2 months ago", "17 days ago", "an hour ago", "yesterday"]) {
      const got = parseRelativeAge(text, "2026-07-03T12:00:00Z")!;
      expect(got.precision).toBe("estimated");
      expect(got.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it("returns null rather than guessing on junk", () => {
    for (const text of ["", "   ", "Posted", "soon", "in 3 days remaining", "days ago"]) {
      expect(parseRelativeAge(text, "2026-07-03T12:00:00Z")).toBeNull();
    }
    expect(parseRelativeAge("2 months ago", "")).toBeNull();
  });
});

describe("relative-age regexp safety", () => {
  it("rejects long raw whitespace runs without ambiguous backtracking", () => {
    const spaces = " ".repeat(100_000);
    expect(AGE_RE.exec(`1${spaces}x`)).toBeNull();
    expect(BARE_AGE_REMAINDER_RE.test(`posted${spaces}x`)).toBe(false);
  });
});

// Displayed precision must not exceed the source evidence.
describe("postedGrain", () => {
  it("reads the coarsest unit the evidence named", () => {
    expect(postedGrain("2 hours ago")).toBe("day");
    expect(postedGrain("17 days ago")).toBe("day");
    expect(postedGrain("3 weeks ago")).toBe("day");
    expect(postedGrain("2 months ago")).toBe("month");
    expect(postedGrain("1 year ago")).toBe("year");
    expect(postedGrain("yesterday")).toBe("day");
  });

  it("returns null when the text names no age", () => {
    for (const text of ["", "Posted", "soon", null, undefined]) {
      expect(postedGrain(text)).toBeNull();
    }
  });
});

describe("readPosted", () => {
  const captured = "2026-07-03T12:00:00Z";

  it("renders an exact date as a date, unmarked", () => {
    const got = readPosted({ posted_at: "2026-05-03T09:30:00Z", posted_precision: "exact" });
    expect(got).toMatchObject({ known: true, text: "3 May 2026" });
  });

  it("degrades a month-grade estimate to a month and marks it approximate", () => {
    const got = readPosted(
      {
        posted_at: "2026-05-03T12:00:00Z",
        posted_precision: "estimated",
        posted_age: "2 months ago",
      },
      { capturedAt: captured },
    );
    expect(got.text).toBe("~May 2026");
    expect(got.tooltip).toContain("2 months ago");
    expect(got.tooltip).toContain("accurate to the month");
    expect(got.tooltip).toContain("3 Jul 2026");
  });

  it("keeps a day for finer evidence and a year for coarser", () => {
    const at = { posted_precision: "estimated" };
    expect(
      readPosted({ ...at, posted_at: "2026-07-01T12:00:00Z", posted_age: "2 days ago" }).text,
    ).toBe("~1 Jul 2026");
    expect(
      readPosted({ ...at, posted_at: "2025-07-03T12:00:00Z", posted_age: "1 year ago" }).text,
    ).toBe("~2025");
  });

  // Pre-backfill rows carry the evidence and nothing else; the label must not wait
  // on a migration to be right.
  it("derives the instant from the retained evidence when posted_at is absent", () => {
    const derived = readPosted({ posted_age: "2 months ago" }, { capturedAt: captured });
    const stored = readPosted(
      {
        posted_at: parseRelativeAge("2 months ago", captured)!.at,
        posted_precision: "estimated",
        posted_age: "2 months ago",
      },
      { capturedAt: captured },
    );
    expect(derived.text).toBe(stored.text);
  });

  it("reports unknown rather than a guess when there is no evidence", () => {
    const got = readPosted({}, { capturedAt: captured });
    expect(got.known).toBe(false);
    expect(got.text).toBe("unknown");
    expect(got.tooltip).toContain("3 Jul 2026");
  });

  // A platform flagged `untrustedExactDate` reports a `posted_date` that is really
  // the capture date; reading it would launder a known lie. The flag is registry
  // knowledge (set by a board's adapter overlay), so register a synthetic pair
  // here rather than name any real board.
  it("refuses an untrusted-date platform's posted_date but trusts another's", () => {
    registerPlatform("untrusted-board", { label: "Untrusted", untrustedExactDate: true });
    registerPlatform("trusted-board", { label: "Trusted" });
    const meta = { posted_date: "2026-06-01T00:00:00Z" };
    expect(readPosted(meta, { platform: "untrusted-board", capturedAt: captured }).known).toBe(
      false,
    );
    expect(readPosted(meta, { platform: "trusted-board", capturedAt: captured })).toMatchObject({
      known: true,
      text: "1 Jun 2026",
    });
  });
});
