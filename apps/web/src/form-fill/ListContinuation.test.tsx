import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AnswerList } from "./AnswerList";
import { testAnswer } from "./testFixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("prefetches near the list end without revealing rows until Load more is clicked", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  let approach: IntersectionObserverCallback | undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        approach = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const item = { ...testAnswer, mapping_count: 0 };
  const list = vi
    .spyOn(api, "listFormFillAnswers")
    .mockImplementation(async (filters) =>
      filters?.cursor
        ? { items: [{ ...item, id: "later", label: "Later answer" }], next_cursor: null }
        : { items: [item], next_cursor: "next" },
    );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnswerList onOpen={vi.fn()} onCreate={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Load more" });
  approach!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Later answer")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByText("Later answer");
  expect(list).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  client.clear();
});
