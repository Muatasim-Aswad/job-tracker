import { describe, expect, it } from "vitest";
import type { JobSummary } from "@job-tracker/shared/api";
import { sortJobs, type SortOrder } from "./jobSort";

function job(
  id: string,
  title: string | null,
  company: string | null,
  createdAt: string,
  updatedAt: string,
): JobSummary {
  return {
    id,
    title,
    company,
    created_at: createdAt,
    updated_at: updatedAt,
  } as JobSummary;
}

const jobs = [
  job("delta", "Beta", "Sample Company", "2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"),
  job("charlie", "Alpha", "Zephyr", "2026-02-01T00:00:00Z", "2026-02-01T00:00:00Z"),
  job("bravo", "Alpha", "Sample Company", "2026-02-01T00:00:00Z", "2026-02-01T00:00:00Z"),
  job("alpha", null, null, "2026-03-01T00:00:00Z", "2026-01-01T00:00:00Z"),
];

function ids(order: SortOrder): string[] {
  return sortJobs(jobs, order).map((item) => item.id);
}

describe("sortJobs", () => {
  it.each([
    ["recently_updated", ["delta", "bravo", "charlie", "alpha"]],
    ["least_recently_updated", ["alpha", "bravo", "charlie", "delta"]],
    ["newest_added", ["alpha", "bravo", "charlie", "delta"]],
    ["oldest_added", ["delta", "bravo", "charlie", "alpha"]],
    ["title_az", ["bravo", "charlie", "delta", "alpha"]],
    ["title_za", ["delta", "bravo", "charlie", "alpha"]],
  ] satisfies [SortOrder, string[]][])(
    "orders by %s with deterministic tie-breakers",
    (order, expected) => {
      expect(ids(order)).toEqual(expected);
    },
  );

  it("does not mutate the loaded query data", () => {
    const originalIds = jobs.map((item) => item.id);
    sortJobs(jobs, "title_az");
    expect(jobs.map((item) => item.id)).toEqual(originalIds);
  });

  it("uses job ID as the final tie-breaker for every option", () => {
    const tied = [
      job("job-z", "Same", "Same", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
      job("job-a", "Same", "Same", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    ];

    for (const order of [
      "recently_updated",
      "least_recently_updated",
      "newest_added",
      "oldest_added",
      "title_az",
      "title_za",
    ] as const) {
      expect(sortJobs(tied, order).map((item) => item.id)).toEqual(["job-a", "job-z"]);
    }
  });

  it("keeps empty titles last in both title directions", () => {
    const blank = job(
      "blank",
      "   ",
      "Sample Company",
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );
    for (const order of ["title_az", "title_za"] as const) {
      expect(
        sortJobs([...jobs, blank], order)
          .slice(-2)
          .map((item) => item.id),
      ).toEqual(["blank", "alpha"]);
    }
  });
});
