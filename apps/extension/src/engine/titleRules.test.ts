import type { TitleRule } from "@job-tracker/shared/api";
import { describe, expect, it } from "vitest";
import { matchingTitleRules, titleRuleMatches } from "./keywords";

const rule: TitleRule = {
  id: "rule",
  enabled: true,
  match: "contains",
  terms: ["senior", "lead"],
  action: "hide",
};

describe("title rule conditions", () => {
  it("matches any alternative case-insensitively at word boundaries", () => {
    expect(titleRuleMatches("Backend LEAD", rule)).toBe(true);
    expect(titleRuleMatches("Senior engineer", rule)).toBe(true);
    expect(titleRuleMatches("Leadership engineer", rule)).toBe(false);
  });
  it("starts with tolerates whitespace but does not match mid-title", () => {
    const prefix = { ...rule, match: "starts_with" as const };
    expect(titleRuleMatches("  Lead engineer", prefix)).toBe(true);
    expect(titleRuleMatches("Engineer, senior team", prefix)).toBe(false);
  });
  it("does not contain matches only when every alternative is absent", () => {
    const negative = { ...rule, match: "not_contains" as const };
    expect(titleRuleMatches("Junior engineer", negative)).toBe(true);
    expect(titleRuleMatches("Lead engineer", negative)).toBe(false);
    expect(titleRuleMatches("Senior engineer", negative)).toBe(false);
    expect(titleRuleMatches("", negative)).toBe(false);
    expect(titleRuleMatches("Engineer", { ...negative, terms: [] })).toBe(false);
  });
  it("treats punctuation literally and supports Unicode words", () => {
    expect(titleRuleMatches("C++ engineer", { ...rule, terms: ["C++"] })).toBe(true);
    expect(titleRuleMatches("Développeur confirmé", { ...rule, terms: ["développeur"] })).toBe(
      true,
    );
    expect(titleRuleMatches("Engineer", { ...rule, terms: [".*"] })).toBe(false);
  });
  it("retains all matching actions and ignores disabled rules", () => {
    const rules = [
      rule,
      { ...rule, id: "s", action: "star" as const },
      { ...rule, id: "disabled", enabled: false },
    ];
    expect(matchingTitleRules("Senior engineer", rules).map((item) => item.action)).toEqual([
      "hide",
      "star",
    ]);
  });
});

import { afterEach, vi } from "vitest";
import { setTitleRules } from "./keywords";
import { applyTitleRules } from "./titleRules";
import type { Engine } from "./types";
import { setAdapters } from "../registry";

function setup(status = "new", blocked = false) {
  setAdapters([
    { naturalKey: (id: string) => ({ platform: "linkedin", platform_id: id }) },
  ] as never);
  const card = document.createElement("div");
  card.dataset.jhId = "LI-1";
  card.dataset.jobTitle = "Senior engineer";
  const state = { status, hidden: false, starred: false };
  const engine = {
    isCardBlocked: () => blocked,
    stateOf: () => state,
    captureCardFromAction: vi.fn(),
    autoEmit: vi.fn(async (_id: string, event: string) => {
      if (event === "hidden") state.hidden = true;
      if (event === "starred") state.starred = true;
      if (event === "skipped") state.status = "skipped";
    }),
  } as unknown as Engine;
  return { engine, card };
}
afterEach(() => setTitleRules([]));

describe("automatic title actions", () => {
  it("runs hide, star and skip sequentially, without sending an event for outlines", async () => {
    const { engine, card } = setup();
    setTitleRules(
      ["outline_job_card", "hide", "star", "skip"].map((action, index) => ({
        ...rule,
        id: String(index),
        action: action as TitleRule["action"],
      })),
    );
    await applyTitleRules(engine, [card]);
    expect(vi.mocked(engine.autoEmit).mock.calls.map((call) => call[1])).toEqual([
      "hidden",
      "starred",
      "skipped",
    ]);
    expect(engine.captureCardFromAction).toHaveBeenCalledTimes(3);
    await applyTitleRules(engine, [card]);
    expect(engine.autoEmit).toHaveBeenCalledTimes(3);
  });
  it.each(["applied", "in_process", "offered", "rejected", "closed"])(
    "does not skip %s jobs",
    async (status) => {
      const { engine, card } = setup(status);
      setTitleRules([{ ...rule, action: "skip" }]);
      await applyTitleRules(engine, [card]);
      expect(engine.autoEmit).not.toHaveBeenCalled();
    },
  );
  it("does not create jobs for blocked companies", async () => {
    const { engine, card } = setup("new", true);
    setTitleRules([rule]);
    await applyTitleRules(engine, [card]);
    expect(engine.autoEmit).not.toHaveBeenCalled();
  });
  it("stops queued actions if settings change during an earlier write", async () => {
    const { engine, card } = setup();
    setTitleRules([rule, { ...rule, id: "star", action: "star" }]);
    vi.mocked(engine.autoEmit).mockImplementationOnce(async () => {
      setTitleRules([]);
    });
    await applyTitleRules(engine, [card]);
    expect(engine.autoEmit).toHaveBeenCalledTimes(1);
  });
});
