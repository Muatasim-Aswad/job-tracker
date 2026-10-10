import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ReviewFilterSelect, ReviewList } from "./ReviewList";

afterEach(cleanup);

const baseProps = {
  titleId: "review-title",
  title: "Remembered values",
  description: "Provisional values.",
  isLoading: false,
  isError: false,
  onRetry: () => {},
  loadingLabel: "Loading…",
  errorLabel: "Couldn’t load.",
  emptyTitle: "Nothing to review.",
  emptyBody: "Values appear here.",
  hasNextPage: false,
  isFetchingNextPage: false,
  onLoadMore: () => {},
};

describe("Form Fill review list", () => {
  it("keeps a named region without repeating the navigation title and shows explanations on demand", () => {
    render(<ReviewList {...baseProps} filters={null} rows={[]} onOpen={() => {}} />);
    expect(screen.getByRole("region", { name: "Remembered values" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Remembered values" })).toBeNull();
    expect(screen.queryByText("Provisional values.")).toBeNull();
    const help = screen.getByRole("button", { name: "About remembered values" });
    fireEvent.mouseEnter(help.parentElement!);
    expect(screen.getByRole("tooltip").textContent).toBe("Provisional values.");
    fireEvent.mouseLeave(help.parentElement!);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(help);
    expect(help.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
  });
  it("keeps filters in their own block and opens rows by id", () => {
    const onOpen = vi.fn();
    const onChange = vi.fn();
    render(
      <ReviewList
        {...baseProps}
        filters={
          <ReviewFilterSelect
            label="Source"
            value=""
            onChange={onChange}
            options={[
              ["", "All sources"],
              ["user_input", "You typed this"],
            ]}
          />
        }
        rows={[{ id: "capture-1", title: "Salary?", meta: "You typed this", aside: "Revision 1" }]}
        onOpen={onOpen}
      />,
    );
    const filters = screen.getByRole("group", { name: "Filters" });
    fireEvent.change(within(filters).getByRole("combobox", { name: "Source" }), {
      target: { value: "user_input" },
    });
    expect(onChange).toHaveBeenCalledWith("user_input");
    expect(filters.contains(screen.getByRole("list"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Salary\?/ }));
    expect(onOpen).toHaveBeenCalledWith("capture-1");
  });

  it("shows the empty state when there are no rows", () => {
    render(<ReviewList {...baseProps} filters={null} rows={[]} onOpen={() => {}} />);
    expect(screen.getByText("Nothing to review.")).toBeTruthy();
  });
});
