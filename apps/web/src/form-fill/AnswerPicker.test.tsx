import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AnswerPicker } from "./AnswerPicker";
import { testAnswer } from "./testFixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AnswerPicker", () => {
  it("keeps search and the add icon visible when a selected answer arrives", async () => {
    vi.spyOn(api, "listFormFillAnswers").mockResolvedValue({ items: [], next_cursor: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = {
      control: "text" as const,
      prompt: "Synthetic question",
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
    expect(screen.getByRole("searchbox", { name: "Find a saved answer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New answer" })).toBeTruthy();
    expect(screen.getByText("Synthetic saved value")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change answer" })).toBeNull();
    client.clear();
  });

  it("uses one chooser with similar names first and all compatible answers without fetching values", async () => {
    vi.spyOn(api, "listFormFillAnswers").mockResolvedValue({
      items: [
        {
          ...testAnswer,
          id: "employment",
          label: "Employment status",
          value_kind: "single_choice",
          mapping_count: 0,
        },
        {
          ...testAnswer,
          id: "english",
          label: "English proficiency",
          value_kind: "single_choice",
          mapping_count: 0,
        },
      ],
      next_cursor: null,
    });
    const detail = vi.spyOn(api, "getFormFillAnswer");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AnswerPicker
          control="radio"
          prompt="Employment status"
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
    client.clear();
  });

  it("searches on the server and reaches an answer beyond the first 100 results", async () => {
    const item = (index: number) => ({
      ...testAnswer,
      id: `answer-${index}`,
      label: `Synthetic answer ${index}`,
      mapping_count: 0,
    });
    const list = vi.spyOn(api, "listFormFillAnswers").mockImplementation(async (filters) => {
      if (filters?.q) return { items: [item(101)], next_cursor: null };
      return filters?.cursor
        ? { items: [item(101)], next_cursor: null }
        : {
            items: Array.from({ length: 100 }, (_, i) => ({
              ...item(i + 1),
              value_kind: i === 99 ? ("text" as const) : ("decimal" as const),
            })),
            next_cursor: "next-page",
          };
    });
    const change = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AnswerPicker
          control="text"
          prompt="Synthetic question"
          value=""
          onChange={change}
          onRetry={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: /Synthetic answer 100/ });
    fireEvent.click(screen.getByRole("button", { name: "Load more answers" }));
    const later = await screen.findByRole("button", { name: /Synthetic answer 101/ });
    fireEvent.click(later);
    expect(change).toHaveBeenCalledWith("answer-101");
    const search = screen.getByRole("searchbox", { name: "Find a saved answer" });
    fireEvent.focus(search);
    expect(screen.getByRole("tooltip").textContent).toContain("Compatible answers");
    expect(search.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.change(search, {
      target: { value: "Later answer" },
    });
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ q: "Later answer", status: "active" }),
      ),
    );
    expect(window.location.search).not.toContain("Later");
    client.clear();
  });
});
