import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { bindingsComplete } from "./bindings";
import { OptionBindingEditor } from "./OptionBindingEditor";
import type { AnswerChoiceSummary, QuestionOption } from "./model";

afterEach(cleanup);

const options: QuestionOption[] = [
  {
    id: "qo-a",
    raw_label: "Option A",
    normalized_label: "option a",
    stable_option_key: null,
    status: "active",
  },
  {
    id: "qo-b",
    raw_label: "Option B",
    normalized_label: "option b",
    stable_option_key: null,
    status: "active",
  },
];
const choices: AnswerChoiceSummary[] = [
  { id: "ac-a", choice_key: "a", display_label: "Meaning A", status: "active" },
  { id: "ac-b", choice_key: "b", display_label: "Meaning B", status: "active" },
];

describe("OptionBindingEditor", () => {
  it("requires every active form option to have an active meaning", () => {
    expect(bindingsComplete(options, choices, { "qo-a": "ac-a" })).toBe(false);
    expect(bindingsComplete(options, choices, { "qo-a": "ac-a", "qo-b": "ac-b" })).toBe(true);
  });

  it("labels every selector with the visible form option", () => {
    const onChange = vi.fn();
    render(
      <OptionBindingEditor options={options} choices={choices} value={{}} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Meaning of Option A" }), {
      target: { value: "ac-a" },
    });
    expect(onChange).toHaveBeenCalledWith({ "qo-a": "ac-a" });
  });
});
