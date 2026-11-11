import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CaptureDrawer } from "./CaptureDrawer";
import { QuestionDrawer } from "./QuestionDrawer";
import { testAnswer, testCapture, testQuestion } from "./testFixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(["capture", "question"] as const)(
  "releases private details when the %s drawer unmounts, retaining collection summaries and unrelated details",
  async (kind) => {
    const question = {
      ...testQuestion,
      answer: testAnswer,
      current_captures: [testCapture],
    };
    const capture = { ...testCapture, question, answer: testAnswer };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(["form-fill", "question", testQuestion.id], question);
    client.setQueryData(["form-fill", "capture", testCapture.id], capture);
    client.setQueryData(["form-fill", "answer", testAnswer.id], testAnswer);
    client.setQueryData(["form-fill", "answers", {}], { pages: [{ items: [] }] });
    client.setQueryData(["form-fill", "answer", "unrelated"], { id: "unrelated" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], next_cursor: null }))),
    );

    const { unmount } = render(
      <QueryClientProvider client={client}>
        {kind === "capture" ? (
          <CaptureDrawer captureId={testCapture.id} onClose={vi.fn()} onOpenQuestion={vi.fn()} />
        ) : (
          <QuestionDrawer questionId={testQuestion.id} onClose={vi.fn()} onCreateAnswer={vi.fn()} />
        )}
      </QueryClientProvider>,
    );
    await screen.findByRole("dialog", {
      name: kind === "capture" ? "Review remembered answer" : "Review question",
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: kind === "capture" ? "Review changes" : "Review match",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    unmount();

    expect(client.getQueryData(["form-fill", "question", testQuestion.id])).toBeUndefined();
    expect(client.getQueryData(["form-fill", "capture", testCapture.id])).toBeUndefined();
    expect(client.getQueryData(["form-fill", "answer", testAnswer.id])).toBeUndefined();
    expect(client.getQueryData(["form-fill", "answers", {}])).toEqual({ pages: [{ items: [] }] });
    expect(client.getQueryData(["form-fill", "answer", "unrelated"])).toEqual({ id: "unrelated" });
    client.clear();
  },
);
