import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  it("uses semantic tabs and keeps only enum and resource state in the URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/?view=form-fill&section=answers&q=private-search&raw_question=private-prompt",
    );
    render(<FormFillWorkspace />);
    expect(screen.getByRole("tab", { name: "Answers" }).getAttribute("aria-selected")).toBe("true");
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

  it("switches the review collection through nested semantic tabs", () => {
    render(<FormFillWorkspace />);
    fireEvent.click(screen.getByRole("tab", { name: "Needs review" }));
    expect(screen.getByRole("tab", { name: "Remembered values" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Unresolved Questions" }));
    expect(screen.getByText("Question list")).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get("type")).toBe("questions");
  });
});
