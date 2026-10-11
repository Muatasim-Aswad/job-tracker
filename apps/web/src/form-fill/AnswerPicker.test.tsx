import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AnswerPicker } from "./AnswerPicker";
import { testAnswer } from "./testFixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AnswerPicker", () => {
  it("loads near the bottom inside the picker, preserves rows on failure, and releases previews on close", async () => {
    const observers: {
      callback: IntersectionObserverCallback;
      root: Element | Document | null;
      element?: Element;
      disconnected: boolean;
    }[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        entry: (typeof observers)[number];
        constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
          this.entry = { callback, root: options.root ?? null, disconnected: false };
          observers.push(this.entry);
        }
        observe(element: Element) {
          this.entry.element = element;
        }
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
    let attempts = 0;
    const item = {
      id: "answer-1",
      label: "Python experience",
      revision: 1,
      value_preview: "5 years",
    };
    const list = vi
      .spyOn(api, "listFormFillAnswerCandidates")
      .mockImplementation(async (_id, filters) => {
        if (!filters?.cursor) return { items: [item], next_cursor: "next" };
        if (++attempts === 1) throw new Error("Synthetic failure");
        return { items: [{ ...item, id: "later", label: "Later answer" }], next_cursor: null };
      });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <AnswerPicker
          questionId="question-1"
          questionRevision={1}
          value=""
          onRetry={vi.fn()}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await screen.findByText("5 years");
    const observer = observers.findLast((entry) => !entry.disconnected)!;
    expect(observer.root).toBe(screen.getByRole("list"));
    expect(observer.root?.contains(observer.element!)).toBe(true);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    observer.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText("Python experience")).toBeTruthy();
    expect(attempts).toBe(1);
    fireEvent.click(retry);
    await screen.findByText("Later answer");
    expect(attempts).toBe(2);
    expect(list).toHaveBeenCalledWith("question-1", expect.objectContaining({ cursor: "next" }));
    unmount();
    await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
    client.clear();
  });
  it("replaces search and candidates with the selected card and a cancel icon", async () => {
    vi.spyOn(api, "listFormFillAnswerCandidates").mockResolvedValue({
      items: [],
      next_cursor: null,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = {
      questionId: "question-1",
      questionRevision: 1,
      onChange: vi.fn(),
      onRetry: vi.fn(),
      onCreate: vi.fn(),
    };
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <AnswerPicker {...props} value="" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("searchbox", { name: "Find a saved answer" })).toBeTruthy();
    const add = screen.getByRole("button", { name: "New answer" });
    expect(add.textContent).toBe("");
    expect(add.getAttribute("title")).toBe("New answer");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(add);
    expect(props.onCreate).toHaveBeenCalledOnce();
    rerender(
      <QueryClientProvider client={client}>
        <AnswerPicker {...props} value={testAnswer.id} selected={testAnswer} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "New answer" })).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("Synthetic saved value")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel answer selection" }));
    expect(props.onChange).toHaveBeenCalledWith("");
    expect(screen.queryByRole("button", { name: "Change answer" })).toBeNull();
    client.clear();
  });

  it("shows private value previews in backend order without fetching full details", async () => {
    vi.spyOn(api, "listFormFillAnswerCandidates").mockResolvedValue({
      items: [
        {
          ...testAnswer,
          id: "employment",
          label: "Employment status",
          value_preview: "Synthetic preview",
        },
        {
          ...testAnswer,
          id: "english",
          label: "English proficiency",
          value_preview: "Synthetic preview",
        },
      ],
      next_cursor: null,
    });
    const detail = vi.spyOn(api, "getFormFillAnswer");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AnswerPicker
          questionId="question-1"
          questionRevision={1}
          value=""
          onChange={vi.fn()}
          onRetry={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: /Employment status/ });
    expect(
      within(screen.getAllByRole("listitem")[0]).getByRole("button", { name: /Employment status/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /English proficiency/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Browse compatible answers" })).toBeNull();
    expect(detail).not.toHaveBeenCalled();
    expect(screen.getAllByText("Synthetic preview")).toHaveLength(2);
    expect(screen.queryByText("Automatic")).toBeNull();
    client.clear();
  });

  it("searches on the server and reaches an answer beyond the first 100 results", async () => {
    const item = (index: number) => ({
      ...testAnswer,
      id: `answer-${index}`,
      label: `Synthetic answer ${index}`,
      value_preview: "Synthetic preview",
    });
    const list = vi
      .spyOn(api, "listFormFillAnswerCandidates")
      .mockImplementation(async (_id, filters) => {
        if (filters?.q) return { items: [item(101)], next_cursor: null };
        return filters?.cursor
          ? { items: [item(101)], next_cursor: null }
          : {
              items: [item(100)],
              next_cursor: "next-page",
            };
      });
    const change = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AnswerPicker
          questionId="question-1"
          questionRevision={1}
          value=""
          onChange={change}
          onRetry={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: /Synthetic answer 100/ });
    const more = screen.getByRole("button", { name: "Load more" });
    expect(screen.getByRole("list").contains(more)).toBe(true);
    fireEvent.click(more);
    const later = await screen.findByRole("button", { name: /Synthetic answer 101/ });
    fireEvent.click(later);
    expect(change).toHaveBeenCalledWith("answer-101");
    const search = screen.getByRole("searchbox", { name: "Find a saved answer" });
    fireEvent.focus(search);
    expect(screen.getByRole("tooltip").textContent).toContain("Suggested answers");
    expect(search.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.change(search, {
      target: { value: "Later answer" },
    });
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        "question-1",
        expect.objectContaining({ q: "Later answer" }),
      ),
    );
    expect(window.location.search).not.toContain("Later");
    client.clear();
  });
});
