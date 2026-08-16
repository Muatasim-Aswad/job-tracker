import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnswerEditor } from "./AnswerEditor";
import { emptyAnswerDraft } from "./answerDraft";

afterEach(cleanup);

describe("AnswerEditor", () => {
  it("collapses and searches a large vocabulary with the selected choice first", async () => {
    const choices = Array.from({ length: 6 }, (_, index) => ({
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

    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(screen.getByText("6 choices · Selected: Country 5")).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Search choices" })).toBeNull();

    fireEvent.click(container.querySelector("summary")!);
    await waitFor(() => expect(details.open).toBe(true));

    const radios = screen.getAllByRole("radio");
    expect(radios[0].getAttribute("aria-label")).toBe("Use Country 5 as the value");

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
