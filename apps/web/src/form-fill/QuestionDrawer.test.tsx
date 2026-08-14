import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks", () => {
  const mutation = () => ({
    error: null,
    isPending: false,
    mutateAsync: vi.fn(),
    reset: vi.fn(),
  });
  return {
    useFormFillQuestion: () => ({
      data: {
        id: "question-1",
        raw_question: "Synthetic matched question",
        raw_section: null,
        raw_help: null,
        site_scope: "linkedin:easy-apply",
        control_kind: "text",
        review_state: "open",
        revision: 1,
        seen_count: 2,
        last_seen_at: "2026-08-14T00:00:00Z",
        capture_conflict: false,
        current_captures: [],
        options: [],
        events: [],
        answer: { id: "answer-1", label: "Synthetic answer" },
        mapping: {
          id: "mapping-1",
          answer_id: "answer-1",
          status: "active",
          revision: 1,
          bindings: [],
        },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useFormFillAnswers: () => ({
      data: { pages: [{ items: [{ id: "answer-1", label: "Synthetic answer" }] }] },
    }),
    useFormFillAnswer: () => ({
      data: { id: "answer-1", revision: 1, value_kind: "text", choices: [] },
      refetch: vi.fn(),
    }),
    useFormFillConflictCaptures: () => [],
    usePutFormFillMapping: mutation,
    useUpdateFormFillMapping: mutation,
    useUpdateFormFillQuestion: mutation,
    useResolveFormFillCaptureConflict: mutation,
    useRemoveFormFillDetail: () => vi.fn(),
  };
});

vi.mock("./Drawer", () => ({
  Drawer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { QuestionDrawer } from "./QuestionDrawer";

afterEach(cleanup);

describe("QuestionDrawer", () => {
  it("does not offer the server-invalid mute action for an active Match", () => {
    render(<QuestionDrawer questionId="question-1" onClose={vi.fn()} onCreateAnswer={vi.fn()} />);

    expect(screen.getByText("This Question is handled by its active Match.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mute Question" })).toBeNull();
  });
});
