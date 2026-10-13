import { describe, expect, it } from "vitest";
import { choicePairsForQuestion, draftForQuestion, valueKindForQuestion } from "./answerDraft";
import type { QuestionDetail } from "./model";

describe("Question-derived Answer drafts", () => {
  it("chooses the compatible value kind for every Question control", () => {
    expect(valueKindForQuestion("text")).toBe("text");
    expect(valueKindForQuestion("textarea")).toBe("long_text");
    expect(valueKindForQuestion("integer")).toBe("decimal");
    expect(valueKindForQuestion("decimal")).toBe("decimal");
    expect(valueKindForQuestion("date")).toBe("date");
    expect(valueKindForQuestion("checkbox_boolean")).toBe("boolean");
    expect(valueKindForQuestion("radio")).toBe("single_choice");
    expect(valueKindForQuestion("select")).toBe("single_choice");
    expect(valueKindForQuestion("checkbox_group")).toBe("multi_choice");
    expect(valueKindForQuestion("multi_select")).toBe("multi_choice");
  });

  it("seeds active options with deterministic unique choice keys", () => {
    const question = {
      raw_question: "Pick a language",
      control_kind: "select",
      options: [
        { id: "one", raw_label: "C++", status: "active" },
        { id: "two", raw_label: "C#", status: "active" },
        { id: "old", raw_label: "COBOL", status: "disabled" },
      ],
    } as QuestionDetail;

    expect(choicePairsForQuestion(question).map(({ choiceKey }) => choiceKey)).toEqual([
      "c",
      "c_2",
    ]);
    expect(draftForQuestion(question)).toMatchObject({
      answerKey: "pick_a_language",
      label: "Pick a language",
      valueKind: "single_choice",
      choices: [
        { choice_key: "c", display_label: "C++", status: "active" },
        { choice_key: "c_2", display_label: "C#", status: "active" },
      ],
    });
  });
});
