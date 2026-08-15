import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(bindingsComplete(options, choices, { "qo-a": "ac-a", "qo-b": "ac-a" })).toBe(false);
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

  it("puts each current selection first and prevents reusing another row's choice", () => {
    render(
      <OptionBindingEditor
        options={options}
        choices={choices}
        value={{ "qo-a": "ac-b" }}
        onChange={vi.fn()}
      />,
    );
    const first = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Meaning of Option A",
    });
    const second = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Meaning of Option B",
    });
    expect(first.options[0].value).toBe("ac-b");
    expect([...second.options].find((option) => option.value === "ac-b")?.disabled).toBe(true);
  });

  it("collapses large option sets until their mappings are opened", async () => {
    const manyOptions = Array.from({ length: 13 }, (_, index) => ({
      id: `qo-${index}`,
      raw_label: `Option ${index}`,
      normalized_label: `option ${index}`,
      stable_option_key: null,
      status: "active" as const,
    }));
    const manyChoices = Array.from({ length: 13 }, (_, index) => ({
      id: `ac-${index}`,
      choice_key: `choice-${index}`,
      display_label: `Meaning ${index}`,
      status: "active" as const,
    }));
    const { container } = render(
      <OptionBindingEditor
        options={manyOptions}
        choices={manyChoices}
        value={{ "qo-0": "ac-0" }}
        onChange={vi.fn()}
      />,
    );

    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    fireEvent.click(container.querySelector("summary")!);
    await waitFor(() => {
      expect(details.open).toBe(true);
      expect(screen.getAllByRole("combobox")).toHaveLength(13);
    });
  });
});
