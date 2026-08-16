import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionDetail } from "./model";

const mocks = vi.hoisted(() => {
  const mutation = () => ({
    error: null,
    isPending: false,
    mutateAsync: vi.fn(),
    reset: vi.fn(),
  });
  return {
    create: mutation(),
    createForQuestion: mutation(),
    update: mutation(),
  };
});

vi.mock("../hooks", () => ({
  useCreateFormFillAnswer: () => mocks.create,
  useCreateFormFillAnswerForQuestion: () => mocks.createForQuestion,
  useFormFillAnswer: () => ({ data: undefined, refetch: vi.fn() }),
  useFormFillQuestion: () => ({ refetch: vi.fn() }),
  useRemoveFormFillDetail: () => vi.fn(),
  useUpdateFormFillAnswer: () => mocks.update,
}));

vi.mock("./Drawer", () => ({
  Drawer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { AnswerDrawer } from "./AnswerDrawer";

const question = {
  id: "question-1",
  raw_question: "Are you authorized to work here?",
  control_kind: "radio",
  revision: 3,
  mapping: { id: "mapping-1", revision: 4 },
  options: [
    { id: "option-yes", raw_label: "Yes", status: "active" },
    { id: "option-no", raw_label: "No", status: "active" },
  ],
} as QuestionDetail;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AnswerDrawer Question creation", () => {
  it("locks Question-owned fields and creates the Answer and Match together", async () => {
    mocks.createForQuestion.mutateAsync.mockResolvedValue({
      answer: { id: "answer-created" },
    });
    const onCreated = vi.fn();
    render(
      <AnswerDrawer
        answerId={null}
        questionContext={question}
        onClose={vi.fn()}
        onCreated={onCreated}
        onOpenQuestion={vi.fn()}
      />,
    );

    expect((screen.getByLabelText("Value type") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Choice 1 label") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Add choice" })).toBeNull();

    fireEvent.click(screen.getByLabelText("Use Yes as the value"));
    fireEvent.click(screen.getByRole("button", { name: "Create Answer" }));

    await waitFor(() => expect(mocks.createForQuestion.mutateAsync).toHaveBeenCalledOnce());
    expect(mocks.create.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.createForQuestion.mutateAsync).toHaveBeenCalledWith({
      questionId: "question-1",
      body: {
        expected_question_revision: 3,
        expected_mapping_revision: 4,
        answer_key: "are_you_authorized_to_work_here",
        choices: [
          { choice_key: "yes", display_label: "Yes", status: "active" },
          { choice_key: "no", display_label: "No", status: "active" },
        ],
        description: null,
        fill_policy: "auto",
        label: "Are you authorized to work here?",
        value: { kind: "single_choice", choice_key: "yes" },
        bindings: [
          { question_option_id: "option-yes", answer_choice_key: "yes" },
          { question_option_id: "option-no", answer_choice_key: "no" },
        ],
      },
    });
    expect(onCreated).toHaveBeenCalledWith("answer-created");
  });
});
