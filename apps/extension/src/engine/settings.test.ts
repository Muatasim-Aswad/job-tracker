import { afterEach, describe, expect, it } from "vitest";
import { applyKeywordPreferences } from "./settings";
import { getActivePolicy, matchingTitleRules } from "./keywords";
import { preferencesFixture } from "../test-support/preferences";

afterEach(() => applyKeywordPreferences(null));

describe("server keyword settings", () => {
  it("applies edited description words and title rules independently", () => {
    const state = preferencesFixture();
    state.settings.description_highlights = [{ id: "language", enabled: true, terms: ["French"] }];
    state.settings.title_rules = [
      { id: "star", enabled: true, match: "contains", terms: ["engineer"], action: "star" },
    ];
    applyKeywordPreferences(state);
    expect(
      getActivePolicy()
        .filter((signal) => signal.enabled)
        .map((signal) => signal.terms),
    ).toEqual([["French"]]);
    expect(matchingTitleRules("Software Engineer").map((rule) => rule.action)).toEqual(["star"]);
  });

  it("clears rules and highlights on a server change before new settings arrive", () => {
    const state = preferencesFixture();
    state.settings.title_rules = [
      { id: "hide", enabled: true, match: "contains", terms: ["engineer"], action: "hide" },
    ];
    applyKeywordPreferences(state);
    applyKeywordPreferences(null);
    expect(matchingTitleRules("Engineer")).toEqual([]);
    expect(getActivePolicy().every((signal) => !signal.enabled)).toBe(true);
  });
});
