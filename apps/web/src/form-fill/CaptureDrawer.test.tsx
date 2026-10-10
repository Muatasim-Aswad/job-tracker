import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testCapture, testQuestion } from "./testFixtures";
const mocks = vi.hoisted(() => {
  const mutation = () => ({ error: null, isPending: false, mutateAsync: vi.fn(), reset: vi.fn() });
  return {
    apply: mutation(),
    update: mutation(),
    remove: vi.fn(),
    capture: null as unknown,
    question: null as unknown,
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
  useFormFillAnswer: () => ({ data: undefined, refetch: vi.fn() }),
  useApplyFormFillCapture: () => mocks.apply,
  useUpdateFormFillCapture: () => mocks.update,
  useRemoveFormFillDetail: () => mocks.remove,
}));
import { CaptureDrawer } from "./CaptureDrawer";
beforeEach(() => {
  mocks.capture = testCapture;
  mocks.question = testQuestion;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
      options: [
        { id: "option-a", raw_label: "C++", normalized_label: "c++", status: "active" },
        { id: "option-b", raw_label: "C#", normalized_label: "c#", status: "active" },
      ],
    };
    mocks.capture = {
      ...testCapture,
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
  it("explains value clearing and does not offer reopening a cleared value", () => {
    mocks.capture = { ...testCapture, status: "ignored", value: null };
    render(<CaptureDrawer captureId="capture-1" onClose={vi.fn()} onOpenQuestion={vi.fn()} />);
    expect(screen.getByText(/This value has been cleared/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reopen remembered/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });
});
