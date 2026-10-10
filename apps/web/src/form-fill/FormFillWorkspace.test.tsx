import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../hooks", () => ({
  useFormFillReviewPresence: () => ({
    hasReview: true,
    hasCaptures: false,
    hasQuestions: true,
    isLoading: false,
  }),
}));

vi.mock("./AnswerList", () => ({
  AnswerList: ({ onOpen }: { onOpen: (id: string) => void }) => (
    <button type="button" onClick={() => onOpen("answer-opaque")}>
      Open synthetic Answer
    </button>
  ),
}));
vi.mock("./CaptureList", () => ({ CaptureList: () => <div>Remembered list</div> }));
vi.mock("./QuestionList", () => ({ QuestionList: () => <div>Question list</div> }));
vi.mock("./AnswerDrawer", () => ({ AnswerDrawer: () => <div>Answer drawer</div> }));
vi.mock("./CaptureDrawer", () => ({ CaptureDrawer: () => <div>Capture drawer</div> }));
vi.mock("./QuestionDrawer", () => ({ QuestionDrawer: () => <div>Question drawer</div> }));

import { FormFillWorkspace } from "./FormFillWorkspace";

beforeEach(() => window.history.replaceState(null, "", "/?view=form-fill&section=answers"));
afterEach(cleanup);

describe("FormFillWorkspace navigation", () => {
  it("uses navigation labels without repeating a workspace heading or permanent introduction", () => {
    render(<FormFillWorkspace />);
    expect(screen.queryByRole("heading", { name: "Form Fill" })).toBeNull();
    expect(screen.queryByText(/Choose the answers Job Tracker can reuse/)).toBeNull();
    const tab = screen.getByRole("tab", { name: "Saved answers" });
    expect(screen.queryByRole("button", { name: /About/ })).toBeNull();
    fireEvent.mouseEnter(tab.parentElement!);
    expect(screen.getByRole("tooltip").textContent).toContain(
      "Reusable answers and the questions that use them",
    );
    fireEvent.mouseLeave(tab.parentElement!);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(tab);
    expect(tab.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.click(tab);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });
  it("uses semantic tabs and keeps only enum and resource state in the URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/?view=form-fill&section=answers&q=private-search&raw_question=private-prompt",
    );
    render(<FormFillWorkspace />);
    expect(screen.getByRole("tab", { name: "Saved answers" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await waitFor(() => expect(window.location.search).toBe("?view=form-fill&section=answers"));
  });

  it("deep-links by opaque resource id without adding display text", () => {
    render(<FormFillWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Open synthetic Answer" }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("answer")).toBe("answer-opaque");
    expect(params.has("q")).toBe(false);
    expect(screen.getByText("Answer drawer")).toBeTruthy();
  });

  it("provides one review inbox and separate recovery collections", () => {
    render(<FormFillWorkspace />);
    fireEvent.click(screen.getByRole("tab", { name: "Review inbox" }));
    expect(screen.getByText("Question list")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Remembered values" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Dismissed" }));
    fireEvent.click(screen.getByRole("tab", { name: "Remembered values" }));
    expect(screen.getByText("Remembered list")).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get("section")).toBe("dismissed");
  });

  it("opens the unified inbox for old review links", () => {
    window.history.replaceState(null, "", "/?view=form-fill&section=review&type=captures");
    render(<FormFillWorkspace />);
    expect(screen.getByText("Question list")).toBeTruthy();
  });
});
