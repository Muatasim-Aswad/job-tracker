import { describe, expect, it } from "vitest";
import { evidenceRows, similarityPercent, timingText } from "./index";

describe("evidenceRows", () => {
  it("orders comparable checks and skips fields either side lacks", () => {
    const rows = evidenceRows({
      location: { is_same: false, current: "Amsterdam", candidate: "Utrecht" },
      apply_url: { is_same: true },
      salary: null,
    });

    expect(rows).toEqual([
      { key: "apply_url", label: "Apply link", same: true },
      {
        key: "location",
        label: "Location",
        same: false,
        current: "Amsterdam",
        candidate: "Utrecht",
      },
    ]);
  });

  it("labels apply types", () => {
    const [row] = evidenceRows({
      apply_type: { is_same: false, current: "easy_apply", candidate: "external" },
    });

    expect(row).toMatchObject({ current: "Easy apply", candidate: "External apply" });
  });

  it("is empty without insights", () => {
    expect(evidenceRows(undefined)).toEqual([]);
  });
});

describe("timingText", () => {
  it.each([
    [null, null],
    [{ overlapping: true, gap_days: null }, "Open at the same time"],
    [{ overlapping: false, gap_days: 0 }, "Reposted the day it closed"],
    [{ overlapping: false, gap_days: 1 }, "Reposted 1 day after it closed"],
    [{ overlapping: false, gap_days: 14 }, "Reposted 14 days after it closed"],
  ])("phrases %j", (timing, text) => {
    expect(timingText(timing)).toBe(text);
  });
});

describe("similarityPercent", () => {
  it("rounds a real comparison and keeps a missing one null", () => {
    expect(similarityPercent(0.826)).toBe(83);
    expect(similarityPercent(0)).toBe(0);
    expect(similarityPercent(null)).toBeNull();
  });
});
