import { describe, expect, it } from "vitest";
import { answerKey, controlAcceptsAnswer, valueText } from "./model";

describe("form-fill value helpers", () => {
  it("creates stable, bounded keys without copying punctuation", () => {
    expect(answerKey("Preferred work location (primary)")).toBe("preferred_work_location_primary");
  });

  it("keeps numeric and choice control compatibility conservative", () => {
    expect(controlAcceptsAnswer("integer", "decimal")).toBe(true);
    expect(controlAcceptsAnswer("integer", "text")).toBe(false);
    expect(controlAcceptsAnswer("select", "single_choice")).toBe(true);
    expect(controlAcceptsAnswer("select", "multi_choice")).toBe(false);
  });

  it("renders typed values without serializing the wrapper", () => {
    expect(valueText({ kind: "boolean", value: true })).toBe("Yes");
    expect(
      valueText({ kind: "multi_choice", choice_keys: ["one", "two"] }, [
        { choice_key: "one", display_label: "First" },
        { choice_key: "two", display_label: "Second" },
      ]),
    ).toBe("First, Second");
  });

  it("shows choice labels and never leaks an option id when a label is missing", () => {
    const options = [{ id: "opaque-option", raw_label: "Professional experience" }];
    expect(valueText({ kind: "single_choice", question_option_id: "opaque-option" }, options)).toBe(
      "Professional experience",
    );
    expect(valueText({ kind: "single_choice", question_option_id: "unknown" }, options)).toBe(
      "Option no longer available",
    );
  });
});
