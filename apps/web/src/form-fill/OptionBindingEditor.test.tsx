import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { bindingsComplete, suggestBindings } from "./bindings";
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
  it("suggests only unambiguous identical labels and preserves explicit selections", () => {
    const exact = choices.map((choice, index) => ({
      ...choice,
      display_label: options[index].raw_label,
    }));
    expect(suggestBindings(options, exact)).toEqual({ "qo-a": "ac-a", "qo-b": "ac-b" });
    expect(suggestBindings(options, exact, { "qo-a": "ac-b" })).toEqual({ "qo-a": "ac-b" });
    expect(suggestBindings(options, [...exact, { ...exact[0], id: "duplicate" }])).toEqual({
      "qo-b": "ac-b",
    });
  });
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
    const suggest = screen.getByRole("button", { name: "Suggest identical labels" });
    fireEvent.mouseEnter(suggest.parentElement!);
    expect(screen.getByRole("tooltip").textContent).toContain("review every match");
    fireEvent.click(suggest);
    expect(onChange).toHaveBeenCalledOnce();
    fireEvent.mouseLeave(suggest.parentElement!);
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

  it("opens incomplete option sets and makes missing matches searchable", async () => {
    const manyOptions = Array.from({ length: 11 }, (_, index) => ({
      id: `qo-${index}`,
      raw_label: `Option ${index}`,
      normalized_label: `option ${index}`,
      stable_option_key: null,
      status: "active" as const,
    }));
    const manyChoices = Array.from({ length: 11 }, (_, index) => ({
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
    expect(details.open).toBe(true);
    expect(screen.getAllByRole("combobox")).toHaveLength(11);
    fireEvent.click(screen.getByLabelText("Only unmatched choices"));
    expect(screen.getAllByRole("combobox")).toHaveLength(10);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search form choices" }), {
      target: { value: "Option 3" },
    });
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });
});
