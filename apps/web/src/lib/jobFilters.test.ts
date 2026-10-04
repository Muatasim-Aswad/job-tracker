import { describe, expect, it } from "vitest";
import type { JobSummary } from "@job-tracker/shared/api";
import type { BlockedCompany } from "@job-tracker/shared/api";
import { countAttention, filterJobs, type JobViewFilters } from "./jobFilters";

function job(overrides: Partial<JobSummary>): JobSummary {
  return {
    id: "job",
    title: "Engineer",
    company: "Sample Company",
    hidden: false,
    starred: false,
    attention: null,
    apply_types: [],
    platforms: ["linkedin"],
    ...overrides,
  } as JobSummary;
}

const all = [
  job({
    id: "attention",
    starred: true,
    attention: { stage: "applied", since: "2026-06-01T00:00:00Z", days: 30 },
  }),
  job({
    id: "hidden-attention",
    hidden: true,
    starred: true,
    attention: { stage: "in_process", since: "2026-06-01T00:00:00Z", days: 30 },
  }),
  job({ id: "starred", title: "Designer", starred: true }),
  job({ id: "plain", company: "Beta" }),
];

const defaults: JobViewFilters = {
  search: "",
  hideHidden: false,
  showStarred: false,
  showAttention: false,
  hideBlocked: false,
  easyApplyOnly: false,
};

describe("attention view filtering", () => {
  it("counts non-hidden candidates independently of other filters", () => {
    expect(countAttention(all)).toBe(1);
  });

  it("excludes hidden candidates from attention-only even when hidden jobs are generally shown", () => {
    expect(filterJobs(all, { ...defaults, showAttention: true }).map((item) => item.id)).toEqual([
      "attention",
    ]);
  });

  it("combines attention with search and starred using AND semantics", () => {
    expect(
      filterJobs(all, {
        ...defaults,
        search: "engineer",
        showStarred: true,
        showAttention: true,
      }).map((item) => item.id),
    ).toEqual(["attention"]);
    expect(filterJobs(all, { ...defaults, search: "designer", showAttention: true })).toEqual([]);
  });
});

describe("blocked and easy apply filtering", () => {
  const block = (company_key: string, platform = "*"): BlockedCompany =>
    ({ company_key, platform, created_at: "2026-06-01T00:00:00Z" }) as BlockedCompany;

  const jobs = [
    job({ id: "blocked", company: "Acme Inc", company_key: "acme" }),
    job({ id: "fallback", company: "Acme", company_key: null }),
    job({ id: "other-platform", company_key: "globex", platforms: ["indeed"] }),
    job({ id: "easy", company_key: "initech", apply_types: ["easy_apply", "external"] }),
  ];

  it("keeps blocked-company jobs unless the blocked filter is on", () => {
    expect(filterJobs(jobs, defaults, [block("acme")])).toHaveLength(4);
  });

  it("hides jobs whose company is blocked everywhere or on one of their platforms", () => {
    const ids = filterJobs(jobs, { ...defaults, hideBlocked: true }, [
      block("acme"),
      block("globex", "linkedin"),
      block("initech", "indeed"),
    ]).map((item) => item.id);
    expect(ids).toEqual(["other-platform", "easy"]);
  });

  it("shows only Easy Apply jobs when that filter is on", () => {
    expect(filterJobs(jobs, { ...defaults, easyApplyOnly: true }).map((item) => item.id)).toEqual([
      "easy",
    ]);
  });
});
