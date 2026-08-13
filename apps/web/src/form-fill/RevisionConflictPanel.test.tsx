import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormFillApiError } from "../api/client";
import { RevisionConflictPanel } from "../components/RevisionConflictPanel";

afterEach(cleanup);

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

describe("RevisionConflictPanel", () => {
  it("preserves the draft while showing a value-free current summary", () => {
    render(
      <RevisionConflictPanel
        error={
          new FormFillApiError(409, "stale", {
            answer: {
              id: "answer-1",
              revision: 4,
              value: "private",
              raw_question: "private prompt",
            },
          })
        }
        draft="local draft"
        onReviewCurrent={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByText("Current server summary"));
    expect(screen.getByText(/answer-1/)).toBeTruthy();
    expect(screen.queryByText(/private/)).toBeNull();
  });

  it("offers explicit review, copy, and discard actions", async () => {
    const review = vi.fn();
    const discard = vi.fn();
    render(
      <RevisionConflictPanel
        error={new FormFillApiError(409, "stale")}
        draft="kept draft"
        onReviewCurrent={review}
        onDiscard={discard}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review current version" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy my changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard mine" }));
    expect(review).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("kept draft"));
  });
});
