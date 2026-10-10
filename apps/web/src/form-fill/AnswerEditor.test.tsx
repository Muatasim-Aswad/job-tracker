import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnswerEditor } from "./AnswerEditor";
import { emptyAnswerDraft } from "./answerDraft";
import { useState } from "react";

afterEach(cleanup);

describe("AnswerEditor", () => {
  it("associates question requirements with the contextual input below it", () => {
    render(
      <AnswerEditor
        draft={emptyAnswerDraft()}
        existing={false}
        questionLocked
        valueHelp="Required. Maximum 200 characters."
        onChange={vi.fn()}
      />,
    );
    const value = screen.getByRole("textbox", { name: "Value" });
    const help = screen.getByText("Required. Maximum 200 characters.");
    expect(value.getAttribute("aria-describedby")).toBe(help.id);
    expect(value.closest("label")?.nextElementSibling).toBe(help);
    expect(help.closest("details")).toBeNull();
  });
  it("explains the stable key on focus without adding permanent help copy or changing its name", () => {
    render(<AnswerEditor draft={emptyAnswerDraft()} existing={false} onChange={vi.fn()} />);
    const key = screen.getByRole("textbox", { name: "Stable key" });
    expect(screen.queryByText(/Generated from the label/)).toBeNull();
    fireEvent.focus(key);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe(
      "Generated from the label. Change it only to distinguish answers with the same label.",
    );
    expect(key.getAttribute("aria-describedby")).toBe(tooltip.id);
    fireEvent.blur(key);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
  it("explains the fill policy on the select without changing selection behavior", () => {
    function Harness() {
      const [draft, setDraft] = useState(emptyAnswerDraft);
      return <AnswerEditor draft={draft} existing={false} onChange={setDraft} />;
    }
    render(<Harness />);
    const details = screen.getByText("Answer details").closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText("Answer details"));
    const policy = screen.getByRole("combobox", { name: "Fill behavior" });
    expect(policy.closest("details")).toBe(details);
    expect((policy as HTMLSelectElement).value).toBe("auto");
    const type = screen.getByRole("combobox", { name: "Value type" });
    expect(type.compareDocumentPosition(policy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const key = screen.getByRole("textbox", { name: "Stable key" });
    const description = screen.getByRole("textbox", { name: "Description" });
    expect(
      key.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /About/ })).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(policy);
    expect(policy.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.click(policy);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.change(policy, { target: { value: "never" } });
    expect((policy as HTMLSelectElement).value).toBe("never");
    expect(screen.getByRole("tooltip").textContent).toBe("This answer will not fill forms.");
    fireEvent.blur(policy);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps an automatic key in sync while typing and preserves a custom key", () => {
    function Harness() {
      const [draft, setDraft] = useState(emptyAnswerDraft);
      return <AnswerEditor draft={draft} existing={false} onChange={setDraft} />;
    }
    render(<Harness />);
    const label = screen.getByLabelText("Answer name");
    fireEvent.change(label, { target: { value: "U" } });
    fireEvent.change(label, { target: { value: "UX audit draft" } });
    expect((screen.getByLabelText("Stable key") as HTMLInputElement).value).toBe("ux_audit_draft");
    fireEvent.change(screen.getByLabelText("Stable key"), { target: { value: "custom_key" } });
    fireEvent.change(label, { target: { value: "Another label" } });
    expect((screen.getByLabelText("Stable key") as HTMLInputElement).value).toBe("custom_key");
  });
  it("collapses and searches a large vocabulary with the selected choice first", async () => {
    const choices = Array.from({ length: 11 }, (_, index) => ({
      choice_key: `country_${index + 1}`,
      display_label: `Country ${index + 1}`,
      status: "active" as const,
    }));
    const draft = {
      ...emptyAnswerDraft(),
      answerKey: "country_code",
      choices,
      label: "Country code",
      selected: ["country_5"],
      valueKind: "single_choice" as const,
    };
    const { container } = render(<AnswerEditor draft={draft} existing onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Value" })).toBeTruthy();

    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(screen.getByText("11 choices · Selected: Country 5")).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Search choices" })).toBeNull();

    fireEvent.click(container.querySelector("summary")!);
    await waitFor(() => expect(details.open).toBe(true));

    const radios = screen.getAllByRole("radio");
    expect(radios[0].getAttribute("aria-label")).toBe("Use Country 5 as the value");
    expect(screen.getByPlaceholderText("Search choices")).toBe(
      screen.getByRole("searchbox", { name: "Search choices" }),
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search choices" }), {
      target: { value: "country 2" },
    });
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Use Country 2 as the value" })).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search choices" }), {
      target: { value: "missing" },
    });
    expect(screen.getByText("No choices match this search.")).toBeTruthy();
  });
});
