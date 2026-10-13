import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerDetail, CaptureDetail, QuestionDetail } from "./model";
import { testAnswer, testCapture, testQuestion } from "./testFixtures";
const mocks = vi.hoisted(() => {
  const mutation = () => ({ error: null, isPending: false, mutateAsync: vi.fn(), reset: vi.fn() });
  return {
    apply: mutation(),
    update: mutation(),
    remove: vi.fn(),
    capture: null as CaptureDetail | null,
    question: null as QuestionDetail | null,
    answers: {} as Record<string, AnswerDetail>,
  };
});
vi.mock("../hooks", () => ({
  useFormFillCapture: () => ({
    data: mocks.capture,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useFormFillQuestion: () => ({
    data: mocks.question,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useFormFillAnswer: (id: string | null) => ({
    data: id ? mocks.answers[id] : undefined,
    refetch: vi.fn(),
  }),
  useFormFillAnswerCandidates: () => ({
    data: {
      pages: [
        { items: Object.values(mocks.answers).map((answer) => ({ ...answer, mapping_count: 1 })) },
      ],
    },
  }),
  useApplyFormFillCapture: () => mocks.apply,
  useUpdateFormFillCapture: () => mocks.update,
  useRemoveFormFillDetail: () => mocks.remove,
}));
import { CaptureDrawer } from "./CaptureDrawer";
beforeEach(() => {
  mocks.capture = testCapture;
  mocks.question = { ...testQuestion, current_captures: [testCapture] };
  mocks.answers = {};
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mappedCapture(kind: "text" | "single_choice", action: "retarget" | "update" | "replace") {
  const choices: AnswerDetail["choices"] = [
    { id: "choice-yes", choice_key: "yes", display_label: "Yes", status: "active" },
    { id: "choice-no", choice_key: "no", display_label: "No", status: "active" },
  ];
  const current: AnswerDetail =
    kind === "text"
      ? testAnswer
      : {
          ...testAnswer,
          value_kind: kind,
          value: { kind, choice_key: "yes" },
          choices,
        };
  const replacement: AnswerDetail = {
    ...current,
    id: "answer-2",
    label: "Replacement answer",
    choices: current.choices.map((choice) => ({
      ...choice,
      id: `replacement-${choice.choice_key}`,
    })),
  };
  mocks.answers = { [current.id]: current, [replacement.id]: replacement };
  mocks.question = {
    ...testQuestion,
    control_kind: kind === "text" ? "text" : "radio",
    answer: current,
    options:
      kind === "text"
        ? []
        : choices.map((choice) => ({
            id: `option-${choice.choice_key}`,
            raw_label: choice.display_label,
            normalized_label: choice.choice_key,
            stable_option_key: null,
            status: "active",
          })),
    mapping: {
      id: "mapping-1",
      answer_id: current.id,
      status: "active",
      revision: 1,
      bindings:
        kind === "text"
          ? []
          : choices.map((choice) => ({
              question_option_id: `option-${choice.choice_key}`,
              answer_choice_id: choice.id,
            })),
    },
    current_captures: [testCapture],
  };
  mocks.capture = {
    ...testCapture,
    question: mocks.question,
    answer: current,
    mapping: mocks.question.mapping,
    value_kind: kind,
    value: kind === "text" ? testCapture.value : { kind, question_option_id: "option-yes" },
  };
  const props = { captureId: testCapture.id, onClose: vi.fn(), onOpenQuestion: vi.fn() };
  const view = render(<CaptureDrawer {...props} />);
  if (action === "retarget") {
    fireEvent.click(screen.getByRole("radio", { name: "Use another answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel answer selection" }));
    fireEvent.click(screen.getByRole("button", { name: /Replacement answer/ }));
  }
  if (action === "replace")
    fireEvent.click(screen.getByRole("radio", { name: "Change choice matches" }));
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  return { props, view, current };
}

describe("CaptureDrawer", () => {
  it("invalidates review when fill behavior changes and saves the newly reviewed policy", async () => {
    const next = vi.fn();
    render(
      <CaptureDrawer
        captureId="capture-1"
        onClose={vi.fn()}
        onOpenQuestion={vi.fn()}
        onNext={next}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Fill behavior"), {
      target: { value: "confirm_each_time" },
    });
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and review next" }));
    await waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(mocks.apply.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          action: "create_answer_and_map",
          fill_policy: "confirm_each_time",
          value: testCapture.value,
          expected_capture_revision: 1,
          expected_question_revision: 1,
        }),
      }),
    );
  });
  it("shows option labels and creates collision-free choice keys", async () => {
    mocks.question = {
      ...testQuestion,
      control_kind: "radio",
      current_captures: [testCapture],
      options: [
        {
          id: "option-a",
          raw_label: "C++",
          normalized_label: "c++",
          stable_option_key: null,
          status: "active",
        },
        {
          id: "option-b",
          raw_label: "C#",
          normalized_label: "c#",
          stable_option_key: null,
          status: "active",
        },
      ],
    };
    mocks.capture = {
      ...testCapture,
      question: mocks.question!,
      value_kind: "single_choice",
      value: { kind: "single_choice", question_option_id: "option-b" },
    };
    render(<CaptureDrawer captureId="capture-1" onClose={vi.fn()} onOpenQuestion={vi.fn()} />);
    expect(screen.getByText("C#")).toBeTruthy();
    expect(screen.queryByText("option-b")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.apply.mutateAsync).toHaveBeenCalledOnce());
    expect(mocks.apply.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          value: { kind: "single_choice", choice_key: "c_2" },
          bindings: [
            { question_option_id: "option-a", answer_choice_key: "c" },
            { question_option_id: "option-b", answer_choice_key: "c_2" },
          ],
        }),
      }),
    );
  });

  it.each([
    ["text", "retarget", "mapping"],
    ["text", "retarget", "currentAnswer"],
    ["single_choice", "retarget", "mapping"],
    ["single_choice", "retarget", "currentAnswer"],
    ["single_choice", "update", "mapping"],
    ["single_choice", "update", "currentAnswer"],
    ["single_choice", "replace", "mapping"],
    ["single_choice", "replace", "currentAnswer"],
  ] as const)("requires renewed %s %s approval after %s changes", async (kind, action, changed) => {
    const { props, view, current } = mappedCapture(kind, action);
    if (changed === "mapping") {
      const mapping = { ...mocks.capture!.mapping!, revision: 2, status: "disabled" as const };
      mocks.capture = { ...mocks.capture!, mapping };
      mocks.question = { ...mocks.question!, mapping };
    } else {
      mocks.answers = {
        ...mocks.answers,
        [current.id]: {
          ...current,
          revision: 2,
          fill_policy: "never",
          value:
            kind === "text"
              ? { kind: "text", value: "Changed current value" }
              : { kind: "single_choice", choice_key: "no" },
        },
      };
    }
    view.rerender(<CaptureDrawer {...props} />);
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(mocks.apply.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    if (changed === "mapping" && action !== "update")
      expect(screen.getByText("Saving reactivates this question’s match.")).toBeTruthy();
    if (changed === "currentAnswer" && kind === "text")
      expect(screen.getByRole("region", { name: "What will change" }).textContent).toContain(
        "Changed current value",
      );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
    expect(mocks.apply.mutateAsync).toHaveBeenCalledWith({
      captureId: testCapture.id,
      body: expect.objectContaining({
        action:
          action === "retarget"
            ? "retarget_mapping"
            : action === "update"
              ? "update_answer"
              : "replace_option_bindings",
        expected_mapping_revision: changed === "mapping" ? 2 : 1,
        expected_answer_revision: changed === "currentAnswer" && action !== "retarget" ? 2 : 1,
        expected_capture_revision: 1,
        expected_question_revision: 1,
      }),
    });
  });

  it.each(["mapping", "question", "capture", "answer"] as const)(
    "waits for coherent %s summary and detail before renewed review",
    (changed) => {
      const { props, view, current } = mappedCapture("text", "retarget");
      if (changed === "mapping")
        mocks.question = {
          ...mocks.question!,
          mapping: { ...mocks.question!.mapping!, revision: 2, status: "disabled" },
        };
      if (changed === "question")
        mocks.question = { ...mocks.question!, revision: 2, raw_help: "New requirement" };
      if (changed === "capture")
        mocks.question = {
          ...mocks.question!,
          current_captures: [{ ...testCapture, revision: 2 }],
        };
      if (changed === "answer")
        mocks.capture = { ...mocks.capture!, answer: { ...current, revision: 2 } };
      view.rerender(<CaptureDrawer {...props} />);
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Review changes" }).disabled,
      ).toBe(true);
      if (changed === "mapping")
        mocks.capture = { ...mocks.capture!, mapping: mocks.question!.mapping };
      if (changed === "question")
        mocks.capture = {
          ...mocks.capture!,
          question: { ...mocks.capture!.question, revision: 2 },
        };
      if (changed === "capture") mocks.capture = { ...mocks.capture!, revision: 2 };
      if (changed === "answer")
        mocks.answers = {
          ...mocks.answers,
          [current.id]: {
            ...current,
            revision: 2,
            value: { kind: "text", value: "New current value" },
          },
        };
      view.rerender(<CaptureDrawer {...props} />);
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
      expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    },
  );

  it("explains value clearing and does not offer reopening a cleared value", () => {
    mocks.capture = { ...testCapture, status: "ignored", value: null };
    render(<CaptureDrawer captureId="capture-1" onClose={vi.fn()} onOpenQuestion={vi.fn()} />);
    expect(screen.getByText(/This value has been cleared/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reopen remembered/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });
});
