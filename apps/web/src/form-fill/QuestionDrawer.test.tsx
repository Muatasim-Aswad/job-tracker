import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureDetail } from "./model";
import { testAnswer, testCapture, testQuestion } from "./testFixtures";

const mocks = vi.hoisted(() => {
  const mutation = () => ({ error: null, isPending: false, mutateAsync: vi.fn(), reset: vi.fn() });
  return {
    captures: [] as { data: CaptureDetail; isLoading: boolean; isError: boolean }[],
    put: mutation(),
    update: mutation(),
    review: mutation(),
    resolve: mutation(),
    remove: vi.fn(),
  };
});
const question = {
  ...testQuestion,
  answer: testAnswer,
  mapping: {
    id: "mapping-1",
    answer_id: "answer-1",
    status: "active" as const,
    revision: 1,
    bindings: [],
  },
};
vi.mock("../hooks", () => ({
  useFormFillQuestion: () => ({
    data: question,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useFormFillAnswers: () => ({
    data: { pages: [{ items: [{ ...testAnswer, mapping_count: 1 }] }] },
  }),
  useFormFillAnswer: (id: string | null) => ({
    data: id ? testAnswer : undefined,
    refetch: vi.fn(),
  }),
  useFormFillConflictCaptures: () => mocks.captures,
  usePutFormFillMapping: () => mocks.put,
  useUpdateFormFillMapping: () => mocks.update,
  useUpdateFormFillQuestion: () => mocks.review,
  useResolveFormFillCaptureConflict: () => mocks.resolve,
  useRemoveFormFillDetail: () => mocks.remove,
}));
import { QuestionDrawer } from "./QuestionDrawer";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.captures = [];
  question.capture_conflict = false;
});

describe("QuestionDrawer", () => {
  it("keeps conflict resolution explicit and sends every capture revision", async () => {
    question.capture_conflict = true;
    mocks.captures = ["First candidate", "Second candidate"].map((value, index) => ({
      data: {
        ...testCapture,
        id: `capture-${index}`,
        revision: index + 1,
        question,
        value: { kind: "text" as const, value },
      },
      isLoading: false,
      isError: false,
    }));
    render(<QuestionDrawer questionId="question-1" onClose={vi.fn()} onCreateAnswer={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Review match" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Keep selected value" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Second candidate/ }));
    fireEvent.click(screen.getByRole("button", { name: "Keep selected value" }));
    await waitFor(() =>
      expect(mocks.resolve.mutateAsync).toHaveBeenCalledWith({
        questionId: "question-1",
        body: {
          expected_question_revision: question.revision,
          winner_capture_id: "capture-1",
          captures: [
            { capture_id: "capture-0", expected_revision: 1 },
            { capture_id: "capture-1", expected_revision: 2 },
          ],
        },
      }),
    );
  });
  it("opens a remembered value from the primary action even when an answer is already matched", () => {
    mocks.captures = [
      {
        data: { ...testCapture, question, answer: testAnswer, mapping: question.mapping },
        isLoading: false,
        isError: false,
      },
    ];
    const openCapture = vi.fn();
    render(
      <QuestionDrawer
        questionId="question-1"
        onClose={vi.fn()}
        onCreateAnswer={vi.fn()}
        onOpenCapture={openCapture}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review remembered value" }));
    expect(openCapture).toHaveBeenCalledWith(testCapture.id);
    expect(mocks.put.mutateAsync).not.toHaveBeenCalled();
  });
  it("shows the saved value and does not offer invalid dismissal for an active match", () => {
    render(<QuestionDrawer questionId="question-1" onClose={vi.fn()} onCreateAnswer={vi.fn()} />);
    const value = screen.getByText("Synthetic saved value");
    expect(value.nextElementSibling).toBe(screen.getByText("Synthetic help"));
    expect(screen.getAllByRole("heading", { name: testQuestion.raw_question })).toHaveLength(1);
    expect(screen.getByText("Manage question · Matched").closest("details")?.open).toBe(false);
    expect(screen.getByText("Question details").closest("details")?.open).toBe(false);
    expect(screen.queryByRole("button", { name: "Dismiss question" })).toBeNull();
  });
  it("passes the observed question into contextual answer creation", () => {
    const onCreateAnswer = vi.fn();
    render(
      <QuestionDrawer questionId="question-1" onClose={vi.fn()} onCreateAnswer={onCreateAnswer} />,
    );
    expect(screen.getByRole("searchbox", { name: "Find a saved answer" })).toBeTruthy();
    expect(screen.getByText("Synthetic saved value")).toBeTruthy();
    expect(screen.queryByText("Saved answer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New answer" }));
    expect(onCreateAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "question-1", control_kind: "text" }),
    );
  });
  it("reviews value and behavior, then saves with all revision preconditions and advances", async () => {
    const next = vi.fn();
    render(
      <QuestionDrawer
        questionId="question-1"
        onClose={vi.fn()}
        onCreateAnswer={vi.fn()}
        onNext={next}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review match" }));
    expect(screen.getByRole("region", { name: "What will change" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save and review next" }));
    await waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(mocks.put.mutateAsync).toHaveBeenCalledWith({
      questionId: "question-1",
      body: {
        answer_id: "answer-1",
        expected_answer_revision: 1,
        expected_mapping_revision: 1,
        expected_question_revision: 1,
        bindings: [],
      },
    });
  });
});
