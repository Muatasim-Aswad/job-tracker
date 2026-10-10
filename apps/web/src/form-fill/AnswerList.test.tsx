import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testAnswer } from "./testFixtures";

vi.mock("../hooks", () => ({
  useFormFillAnswers: () => ({
    data: { pages: [{ items: [{ ...testAnswer, mapping_count: 0 }] }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
  }),
}));
import { AnswerList } from "./AnswerList";

afterEach(cleanup);

describe("Saved answers presentation", () => {
  it("keeps help off the page until requested and retains the row and create actions", () => {
    const open = vi.fn();
    const create = vi.fn();
    render(<AnswerList onOpen={open} onCreate={create} />);
    expect(screen.getByRole("region", { name: "Saved answers" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Saved answers" })).toBeNull();
    expect(screen.queryByText(/Reusable answers and the questions/)).toBeNull();
    const help = screen.getByRole("button", { name: "About saved answers" });
    fireEvent.click(help);
    expect(screen.getByRole("tooltip").textContent).toContain(
      "Paused answers are hidden by default.",
    );
    fireEvent.click(help);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Synthetic answer/ }));
    expect(open).toHaveBeenCalledWith(testAnswer.id);
    fireEvent.click(screen.getByRole("button", { name: "New answer" }));
    expect(create).toHaveBeenCalledOnce();
  });
});
