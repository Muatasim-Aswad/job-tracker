import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ReviewFilterSelect, ReviewList } from "./ReviewList";
import { QuestionList } from "./QuestionList";
import { testQuestion } from "./testFixtures";
import { useState } from "react";

const queries = vi.hoisted(() => ({ questions: vi.fn() }));
vi.mock("../hooks", () => ({ useFormFillQuestions: queries.questions }));

afterEach(cleanup);

const baseProps = {
  titleId: "review-title",
  title: "Remembered values",
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
  it("keeps cleared values on one question row alongside its current status and passes independent filters", () => {
    queries.questions.mockReturnValue({
      data: {
        pages: [
          { items: [{ ...testQuestion, review_state: "ignored", ignored_capture_count: 2 }] },
        ],
      },
      isLoading: false,
      isError: false,
      hasNextPage: false,
    });
    const onOpen = vi.fn();
    const inclusionControls = {
      onIncludeMatchedChange: vi.fn(),
      onIncludeDismissedChange: vi.fn(),
      onClearInclusions: vi.fn(),
    };
    const { rerender } = render(
      <QuestionList {...inclusionControls} includeMatched includeDismissed onOpen={onOpen} />,
    );
    const order = screen.getByRole("button", { name: "Order: Most recent" });
    expect(order.textContent).toBe("");
    expect(order.getAttribute("title")).toBe("Order: Most recent");
    fireEvent.click(order);
    expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
      "Most recent",
      "Most seen",
      "A–Z",
    ]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Most recent" }));
    expect(queries.questions).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "last_seen" }),
    );
    const recentOrder = screen.getByRole("button", { name: "Order: Most recent" });
    fireEvent.click(recentOrder);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "A–Z" }));
    expect(queries.questions).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "prompt" }));
    expect(screen.getByRole("button", { name: "Order: A–Z" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const options = screen.getByRole("group", { name: "List options" });
    expect(within(options).getByRole("checkbox", { name: "Matched" })).toBeTruthy();
    expect(within(options).getByRole("checkbox", { name: "Dismissed" })).toBeTruthy();
    expect(within(options).getByRole("checkbox", { name: "Show source details" })).toBeTruthy();
    expect(queries.questions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        review_inbox: true,
        review_state: undefined,
        include_matched: true,
        include_dismissed: true,
      }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(within(screen.getByRole("listitem")).getByText("Dismissed")).toBeTruthy();
    expect(screen.getByText("2 values cleared")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Synthetic question/ }));
    expect(onOpen).toHaveBeenCalledWith(testQuestion.id);
    rerender(<QuestionList {...inclusionControls} includeMatched onOpen={onOpen} />);
    expect(queries.questions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        review_state: "open",
        include_matched: true,
        include_dismissed: false,
      }),
    );
    rerender(<QuestionList {...inclusionControls} onOpen={onOpen} />);
    expect(queries.questions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        review_state: "open",
        include_matched: false,
        include_dismissed: false,
      }),
    );
    queries.questions.mockReturnValue({
      data: { pages: [{ items: [] }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
    });
    rerender(<QuestionList {...inclusionControls} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Matched" }));
    expect(inclusionControls.onIncludeMatchedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("checkbox", { name: "Dismissed" })).toBeTruthy();
  });
  it("clears search, inclusion and display options together", () => {
    queries.questions.mockReturnValue({
      data: { pages: [{ items: [testQuestion] }] },
      hasNextPage: false,
      isLoading: false,
      isError: false,
    });
    function Questions() {
      const [includeMatched, setMatched] = useState(true);
      const [includeDismissed, setDismissed] = useState(true);
      return (
        <QuestionList
          onOpen={vi.fn()}
          includeMatched={includeMatched}
          includeDismissed={includeDismissed}
          onIncludeMatchedChange={setMatched}
          onIncludeDismissedChange={setDismissed}
          onClearInclusions={() => {
            setMatched(false);
            setDismissed(false);
          }}
        />
      );
    }
    render(<Questions />);
    const search = screen.getByRole("searchbox", { name: "Search questions" });
    fireEvent.change(search, { target: { value: "Synthetic search" } });
    fireEvent.click(screen.getByRole("button", { name: "Filters applied" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show question details" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show source details" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect((search as HTMLInputElement).value).toBe("");
    expect(queries.questions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: undefined,
        include_matched: false,
        include_dismissed: false,
        review_state: "open",
      }),
    );
    expect(
      (screen.getByRole("checkbox", { name: "Show question details" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: "Show source details" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });
  it("shows loaded counts in the header without implying a total or showing zero on failure", () => {
    const data = { pages: [{ items: [testQuestion] }] };
    queries.questions.mockReturnValue({
      data,
      hasNextPage: true,
      isLoading: false,
      isError: false,
    });
    function HeaderQuestions() {
      const [host, setHost] = useState<HTMLElement | null>(null);
      return (
        <>
          <header ref={setHost} aria-label="Collection header" />
          <QuestionList
            toolbarHost={host}
            onOpen={vi.fn()}
            onIncludeMatchedChange={vi.fn()}
            onIncludeDismissedChange={vi.fn()}
            onClearInclusions={vi.fn()}
          />
        </>
      );
    }
    const { rerender } = render(<HeaderQuestions />);
    const header = screen.getByRole("banner", { name: "Collection header" });
    expect(within(header).getByTitle("1 question loaded; more available.").textContent).toBe("1+");
    expect(screen.queryByText("1 loaded")).toBeNull();
    queries.questions.mockReturnValue({
      data,
      hasNextPage: false,
      isLoading: false,
      isError: false,
    });
    rerender(<HeaderQuestions />);
    expect(within(header).getByTitle("1 question shown.").textContent).toBe("1");
    queries.questions.mockReturnValue({ hasNextPage: false, isLoading: false, isError: true });
    rerender(<HeaderQuestions />);
    expect(within(header).getByTitle("Count unavailable").textContent).toBe("—");
    queries.questions.mockReturnValue({ hasNextPage: false, isLoading: true, isError: false });
    rerender(<HeaderQuestions />);
    expect(within(header).getByTitle("Loading questions").textContent).toBe("…");
  });
  it("keeps a named region without repeating the navigation title or adding help buttons", () => {
    render(<ReviewList {...baseProps} filters={null} rows={[]} onOpen={() => {}} />);
    expect(screen.getByRole("region", { name: "Remembered values" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Remembered values" })).toBeNull();
    expect(screen.queryByRole("button", { name: /About/ })).toBeNull();
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

  it("allows hiding question details independently of source details while keeping status visible", () => {
    render(
      <ReviewList
        {...baseProps}
        filters={null}
        rows={[
          {
            id: "question-1",
            title: "Where do you live?",
            context: "Required. Maximum 200 characters.",
            meta: "LinkedIn Easy Apply · Seen 12 times",
            aside: "",
            badge: "Choose an answer",
          },
        ]}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("Required. Maximum 200 characters.")).toBeTruthy();
    expect(screen.queryByText(/Seen 12 times/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show question details" }));
    expect(screen.queryByText("Required. Maximum 200 characters.")).toBeNull();
    expect(screen.getByText("Where do you live?")).toBeTruthy();
    expect(screen.getByText("Choose an answer")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show source details" }));
    expect(screen.getByText(/Seen 12 times/)).toBeTruthy();
    expect(screen.queryByText("Required. Maximum 200 characters.")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show question details" }));
    expect(screen.getByText("Required. Maximum 200 characters.")).toBeTruthy();
  });

  it("shows the empty state when there are no rows", () => {
    render(<ReviewList {...baseProps} filters={null} rows={[]} onOpen={() => {}} />);
    expect(screen.getByText("Nothing to review.")).toBeTruthy();
  });
});
