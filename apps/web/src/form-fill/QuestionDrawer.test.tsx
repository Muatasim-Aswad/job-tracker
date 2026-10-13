import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnswerDetail, CaptureDetail, QuestionDetail } from "./model";
import { testAnswer, testCapture, testQuestion } from "./testFixtures";

const mocks = vi.hoisted(() => {
  const mutation = () => ({ error: null, isPending: false, mutateAsync: vi.fn(), reset: vi.fn() });
  return {
    answersById: {} as Record<string, AnswerDetail>,
    answer: undefined as AnswerDetail | undefined,
    question: undefined as QuestionDetail | undefined,
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
    data: mocks.question ?? question,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useFormFillAnswerCandidates: () => ({
    data: {
      pages: [
        {
          items: (Object.keys(mocks.answersById).length
            ? Object.values(mocks.answersById)
            : [testAnswer]
          ).map((answer) => ({ ...answer, mapping_count: 1 })),
        },
      ],
    },
  }),
  useFormFillAnswer: (id: string | null) => ({
    data: id ? (mocks.answersById[id] ?? mocks.answer ?? testAnswer) : undefined,
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
  mocks.answer = undefined;
  mocks.answersById = {};
  mocks.question = undefined;
  question.capture_conflict = false;
});

describe("QuestionDrawer", () => {
  it("closes after a successful match save and stays open if saving fails", async () => {
    const close = vi.fn();
    mocks.put.mutateAsync.mockRejectedValueOnce(new Error("Save failed"));
    render(<QuestionDrawer questionId="question-1" onClose={close} onCreateAnswer={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Review match" }));
    fireEvent.click(screen.getByRole("button", { name: "Save match" }));
    await screen.findByRole("button", { name: "Review match" });
    expect(close).not.toHaveBeenCalled();
    mocks.put.mutateAsync.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: "Review match" }));
    fireEvent.click(screen.getByRole("button", { name: "Save match" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it.each([
    ["text", "answer"],
    ["text", "question"],
    ["text", "mapping"],
    ["text", "capture"],
    ["radio", "answer"],
    ["radio", "question"],
    ["radio", "mapping"],
    ["radio", "capture"],
  ] as const)(
    "requires a new %s review after the %s revision changes",
    async (controlKind, changed) => {
      const choices: AnswerDetail["choices"] = [
        { id: "choice-yes", choice_key: "yes", display_label: "Yes", status: "active" },
        { id: "choice-no", choice_key: "no", display_label: "No", status: "active" },
      ];
      mocks.answer =
        controlKind === "text"
          ? testAnswer
          : {
              ...testAnswer,
              value_kind: "single_choice",
              choices,
              value: { kind: "single_choice", choice_key: "yes" },
            };
      mocks.question = {
        ...question,
        control_kind: controlKind,
        answer: mocks.answer,
        options:
          controlKind === "text"
            ? []
            : choices.map((choice) => ({
                id: `option-${choice.choice_key}`,
                raw_label: choice.display_label,
                normalized_label: choice.choice_key,
                stable_option_key: null,
                status: "active",
              })),
        mapping: {
          ...question.mapping,
          bindings:
            controlKind === "text"
              ? []
              : choices.map((choice) => ({
                  question_option_id: `option-${choice.choice_key}`,
                  answer_choice_id: choice.id,
                })),
        },
      };
      mocks.captures = [
        { data: { ...testCapture, question: mocks.question }, isLoading: false, isError: false },
      ];
      const props = { questionId: question.id, onClose: vi.fn(), onCreateAnswer: vi.fn() };
      const view = render(<QuestionDrawer {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "Review match" }));
      expect(screen.getByRole("button", { name: "Save match" })).toBeTruthy();
      if (changed === "answer")
        mocks.answer = {
          ...mocks.answer,
          revision: 2,
          fill_policy: "never",
          value:
            controlKind === "text"
              ? { kind: "text", value: "New value" }
              : { kind: "single_choice", choice_key: "no" },
        };
      if (changed === "question")
        mocks.question = { ...mocks.question, revision: 2, raw_help: "New requirement" };
      if (changed === "mapping")
        mocks.question = {
          ...mocks.question,
          mapping: { ...mocks.question.mapping!, revision: 2 },
        };
      if (changed === "capture")
        mocks.captures = [
          {
            ...mocks.captures[0],
            data: {
              ...mocks.captures[0].data,
              revision: 2,
              value: { kind: "text", value: "Changed remembered value" },
            },
          },
        ];
      view.rerender(<QuestionDrawer {...props} />);
      expect(screen.getByRole("button", { name: "Review match" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Save match" })).toBeNull();
      expect(mocks.put.mutateAsync).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Review match" }));
      fireEvent.click(screen.getByRole("button", { name: "Save match" }));
      await waitFor(() => expect(mocks.put.mutateAsync).toHaveBeenCalledOnce());
      expect(mocks.put.mutateAsync).toHaveBeenCalledWith({
        questionId: question.id,
        body: expect.objectContaining({
          expected_answer_revision: changed === "answer" ? 2 : 1,
          expected_question_revision: changed === "question" ? 2 : 1,
          expected_mapping_revision: changed === "mapping" ? 2 : 1,
        }),
      });
    },
  );

  it("waits for the refreshed Capture detail before reviewing its changed summary", () => {
    mocks.question = { ...question, current_captures: [testCapture] };
    mocks.captures = [
      { data: { ...testCapture, question: mocks.question }, isLoading: false, isError: false },
    ];
    const props = { questionId: question.id, onClose: vi.fn(), onCreateAnswer: vi.fn() };
    const view = render(<QuestionDrawer {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Review match" }));
    mocks.question = { ...mocks.question, current_captures: [{ ...testCapture, revision: 2 }] };
    view.rerender(<QuestionDrawer {...props} />);
    expect(screen.queryByRole("button", { name: "Save match" })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Review match" }).disabled).toBe(
      true,
    );
    mocks.captures = [
      {
        ...mocks.captures[0],
        data: {
          ...mocks.captures[0].data,
          revision: 2,
          value: { kind: "text", value: "Updated remembered value" },
        },
      },
    ];
    view.rerender(<QuestionDrawer {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Review match" }));
    expect(screen.getByRole("button", { name: "Save match" })).toBeTruthy();
  });

  it("invalidates review when the current Answer changes independently of the selected one", async () => {
    const replacement: AnswerDetail = {
      ...testAnswer,
      id: "answer-2",
      label: "Replacement answer",
      value: { kind: "text", value: "Replacement value" },
    };
    mocks.answersById = { [testAnswer.id]: testAnswer, [replacement.id]: replacement };
    const props = { questionId: question.id, onClose: vi.fn(), onCreateAnswer: vi.fn() };
    const view = render(<QuestionDrawer {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel answer selection" }));
    fireEvent.click(screen.getByRole("button", { name: /Replacement answer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Review match" }));
    expect(screen.getByRole("button", { name: "Save match" })).toBeTruthy();
    mocks.answersById = {
      ...mocks.answersById,
      [testAnswer.id]: {
        ...testAnswer,
        revision: 2,
        value: { kind: "text", value: "Changed current value" },
      },
    };
    view.rerender(<QuestionDrawer {...props} />);
    expect(screen.queryByRole("button", { name: "Save match" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review match" }));
    expect(screen.getByRole("region", { name: "What will change" }).textContent).toContain(
      "Changed current value",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save match" }));
    await waitFor(() =>
      expect(mocks.put.mutateAsync).toHaveBeenCalledWith({
        questionId: question.id,
        body: expect.objectContaining({ answer_id: replacement.id, expected_answer_revision: 1 }),
      }),
    );
  });

  it("reveals a refreshed conflict and sends every capture revision only after explicit selection", async () => {
    mocks.question = { ...question, capture_conflict: false };
    const props = { questionId: "question-1", onClose: vi.fn(), onCreateAnswer: vi.fn() };
    const view = render(<QuestionDrawer {...props} />);
    expect(screen.queryByRole("button", { name: "Keep selected value" })).toBeNull();
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
    mocks.question = {
      ...question,
      capture_conflict: true,
      current_capture_count: 2,
      current_captures: mocks.captures.map((capture) => capture.data),
    };
    view.rerender(<QuestionDrawer {...props} />);
    expect(mocks.resolve.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
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
    expect(screen.getByText("Synthetic saved value")).toBeTruthy();
    expect(screen.getByText("Synthetic help").closest("details")?.open).toBe(false);
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
    expect(screen.getByText("Synthetic saved value")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel answer selection" }));
    expect(screen.getByRole("searchbox", { name: "Find a saved answer" })).toBeTruthy();
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
