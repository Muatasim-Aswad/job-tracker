import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
