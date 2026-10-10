import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testAnswer, testQuestion } from "./testFixtures";

const mocks = vi.hoisted(() => {
  const mutation = () => ({ error: null, isPending: false, mutateAsync: vi.fn(), reset: vi.fn() });
  return {
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
  useFormFillConflictCaptures: () => [],
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
});

describe("QuestionDrawer", () => {
  it("shows the saved value and does not offer invalid dismissal for an active match", () => {
    render(<QuestionDrawer questionId="question-1" onClose={vi.fn()} onCreateAnswer={vi.fn()} />);
    expect(screen.getByText("Synthetic saved value")).toBeTruthy();
    expect(screen.getByText("This question already uses a saved answer.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dismiss question" })).toBeNull();
  });
  it("passes the observed question into contextual answer creation", () => {
    const onCreateAnswer = vi.fn();
    render(
      <QuestionDrawer questionId="question-1" onClose={vi.fn()} onCreateAnswer={onCreateAnswer} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save a new answer for this question" }));
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
