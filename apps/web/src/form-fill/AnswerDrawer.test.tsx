import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnswerDetail, QuestionDetail } from "./model";
import { testAnswer } from "./testFixtures";

const mocks = vi.hoisted(() => {
  const mutation = () => ({
    error: null,
    isPending: false,
    mutateAsync: vi.fn(),
    reset: vi.fn(),
  });
  return {
    answer: undefined as AnswerDetail | undefined,
    create: mutation(),
    createForQuestion: mutation(),
    update: mutation(),
  };
});

vi.mock("../hooks", () => ({
  useCreateFormFillAnswer: () => mocks.create,
  useCreateFormFillAnswerForQuestion: () => mocks.createForQuestion,
  useFormFillAnswer: () => ({ data: mocks.answer, refetch: vi.fn() }),
  useFormFillQuestion: () => ({ refetch: vi.fn() }),
  useRemoveFormFillDetail: () => vi.fn(),
  useUpdateFormFillAnswer: () => mocks.update,
}));

vi.mock("./Drawer", () => ({
  Drawer: ({
    title,
    children,
    footer,
  }: {
    title: ReactNode;
    children: ReactNode;
    footer: ReactNode;
  }) => (
    <div>
      {title}
      {children}
      {footer}
    </div>
  ),
}));

import { AnswerDrawer } from "./AnswerDrawer";

const question = {
  id: "question-1",
  raw_question: "Are you authorized to work here?",
  control_kind: "radio",
  raw_help: "This field is required.",
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
  mocks.answer = undefined;
});

describe("AnswerDrawer Question creation", () => {
  it("keeps the current fill policy visible while its control starts in answer management", () => {
    mocks.answer = testAnswer;
    render(
      <AnswerDrawer
        answerId={testAnswer.id}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        onOpenQuestion={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: testAnswer.label })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Answer name" })).toBeNull();
    expect(screen.getByText("Text").closest("details")?.open).toBe(false);
    expect(screen.getByRole("textbox", { name: "Value" })).toBeTruthy();
    const policy = screen.getByRole("combobox", { name: "Fill behavior" });
    expect(policy.closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("Manage answer · Automatic"));
    fireEvent.change(screen.getByRole("combobox", { name: "Fill behavior" }), {
      target: { value: "confirm_each_time" },
    });
    expect(screen.getByText("Manage answer · Ask every time")).toBeTruthy();
    expect(screen.getByRole("region", { name: "What will change" })).toBeTruthy();
  });

  it("shows an impact summary only when the saved value or filling changes", () => {
    mocks.answer = testAnswer;
    render(
      <AnswerDrawer
        answerId={testAnswer.id}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        onOpenQuestion={vi.fn()}
      />,
    );
    expect(screen.queryByRole("region", { name: "What will change" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Save answer" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit answer name" }));
    fireEvent.change(screen.getByLabelText("Answer name"), { target: { value: "Renamed answer" } });
    expect(screen.queryByRole("region", { name: "What will change" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "Updated synthetic value" },
    });
    expect(screen.getByRole("region", { name: "What will change" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save answer" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.getByLabelText("Value").closest("label")?.parentElement?.nextElementSibling).toBe(
      screen.getByRole("region", { name: "What will change" }),
    );
  });

  it("cancels a name edit without discarding value edits and saves a confirmed rename with the draft", async () => {
    mocks.answer = testAnswer;
    mocks.update.mutateAsync.mockResolvedValue({
      ...testAnswer,
      label: "Renamed answer",
      value: { kind: "text", value: "Updated value" },
      revision: 2,
    });
    const onClose = vi.fn();
    render(
      <AnswerDrawer
        answerId={testAnswer.id}
        onClose={onClose}
        onCreated={vi.fn()}
        onOpenQuestion={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "Updated value" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit answer name" }));
    fireEvent.change(screen.getByLabelText("Answer name"), { target: { value: "Discarded name" } });
    fireEvent.keyDown(screen.getByLabelText("Answer name"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: testAnswer.label })).toBeTruthy();
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe("Updated value");

    fireEvent.click(screen.getByRole("button", { name: "Edit answer name" }));
    fireEvent.change(screen.getByLabelText("Answer name"), { target: { value: "Renamed answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("heading", { name: "Renamed answer" })).toBeTruthy();
    expect(mocks.update.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    await waitFor(() => expect(mocks.update.mutateAsync).toHaveBeenCalledOnce());
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      answerId: testAnswer.id,
      body: expect.objectContaining({
        expected_revision: 1,
        label: "Renamed answer",
        value: { kind: "text", value: "Updated value" },
      }),
    });
  });
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

    expect(screen.queryByRole("combobox", { name: "Value type" })).toBeNull();
    expect(screen.getAllByRole("heading", { name: question.raw_question })).toHaveLength(1);
    expect(screen.queryByText("Save an answer and match it to this question.")).toBeNull();
    expect(screen.queryByText("Add a name and a valid answer value to save.")).toBeNull();
    expect(screen.getByText("Single choice").closest("details")?.open).toBe(false);
    expect(screen.queryByRole("textbox", { name: "Choice 1 label" })).toBeNull();
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "What will change" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add choice" })).toBeNull();

    fireEvent.click(screen.getByLabelText("Use Yes as the value"));
    expect(screen.getByRole("region", { name: "What will change" })).toBeTruthy();
    const valueGroup = screen.getByRole("group", { name: "Value" });
    const help = screen.getByText("This field is required.");
    expect(valueGroup.nextElementSibling).toBe(help);
    expect(valueGroup.getAttribute("aria-describedby")).toBe(help.id);
    expect(valueGroup.parentElement?.nextElementSibling).toBe(
      screen.getByRole("region", { name: "What will change" }),
    );
    expect(screen.queryByText("Option no longer available")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save answer and match" }));

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
    expect(onCreated).toHaveBeenCalledWith("answer-created", false);
  });
});
