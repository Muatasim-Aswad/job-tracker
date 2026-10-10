import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testAnswer } from "./testFixtures";

const queries = vi.hoisted(() => ({ answers: vi.fn() }));
vi.mock("../hooks", () => ({ useFormFillAnswers: queries.answers }));
beforeEach(() =>
  queries.answers.mockReturnValue({
    data: { pages: [{ items: [{ ...testAnswer, mapping_count: 0 }] }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
  }),
);
import { AnswerList } from "./AnswerList";

afterEach(cleanup);

describe("Saved answers presentation", () => {
  it("keeps secondary filters collapsed until requested", () => {
    function HeaderList() {
      const [host, setHost] = useState<HTMLElement | null>(null);
      return (
        <>
          <header ref={setHost} aria-label="Collection header" />
          <AnswerList toolbarHost={host} onOpen={vi.fn()} onCreate={vi.fn()} />
        </>
      );
    }
    render(<HeaderList />);
    const header = screen.getByRole("banner", { name: "Collection header" });
    const search = within(header).getByRole("searchbox", { name: "Search saved answers" });
    expect(within(header).getByTitle("1 answer shown.").textContent).toBe("1");
    const add = within(header).getByRole("button", { name: "New answer" });
    expect(add.textContent).toBe("");
    expect(add.getAttribute("title")).toBe("New answer");
    expect(screen.getByRole("region", { name: "Saved answers" }).contains(search)).toBe(false);
    const order = within(header).getByRole("button", { name: "Order: Most recent" });
    expect(order.textContent).toBe("");
    expect(order.getAttribute("title")).toBe("Order: Most recent");
    fireEvent.click(order);
    expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
      "Most recent",
      "Most matched questions",
      "A–Z",
    ]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "A–Z" }));
    expect(queries.answers).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "label" }));
    fireEvent.click(screen.getByRole("button", { name: "Order: A–Z" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Most matched questions" }));
    expect(queries.answers).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "mapping_count" }),
    );
    const url = window.location.search;
    fireEvent.change(search, { target: { value: "Synthetic search" } });
    expect(queries.answers).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "Synthetic search" }),
    );
    expect(window.location.search).toBe(url);
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Value type" })).toBeNull();
    const filters = screen.getByRole("button", { name: "Filters" });
    expect(filters.textContent).toBe("");
    expect(filters.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(filters);
    expect(filters.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Status" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Value type" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Value type" }), {
      target: { value: "boolean" },
    });
    expect(queries.answers).toHaveBeenLastCalledWith(
      expect.objectContaining({ value_kind: "boolean" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters applied" }));
    expect(screen.queryByRole("combobox", { name: "Value type" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Filters applied" }).getAttribute("aria-expanded"),
    ).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Filters applied" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Status" }), { key: "Escape" });
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Filters applied" }));
    fireEvent.click(screen.getByRole("button", { name: "Filters applied" }));
    fireEvent.pointerDown(search);
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
  });
  it("keeps help off the page until requested and retains the row and create actions", () => {
    const open = vi.fn();
    const create = vi.fn();
    render(<AnswerList onOpen={open} onCreate={create} />);
    expect(screen.getByRole("region", { name: "Saved answers" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Saved answers" })).toBeNull();
    expect(screen.queryByText(/Reusable answers and the questions/)).toBeNull();
    expect(screen.queryByRole("button", { name: /About/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Synthetic answer/ }));
    expect(open).toHaveBeenCalledWith(testAnswer.id);
    fireEvent.click(screen.getByRole("button", { name: "New answer" }));
    expect(create).toHaveBeenCalledOnce();
  });
});
