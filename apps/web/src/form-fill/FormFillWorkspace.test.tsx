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
vi.mock("./QuestionList", () => ({
  QuestionList: ({
    includeMatched,
    includeDismissed,
    onIncludeMatchedChange,
    onIncludeDismissedChange,
  }: {
    includeMatched: boolean;
    includeDismissed: boolean;
    onIncludeMatchedChange: (checked: boolean) => void;
    onIncludeDismissedChange: (checked: boolean) => void;
  }) => (
    <div data-matched={includeMatched} data-dismissed={includeDismissed}>
      Question list
      <label>
        Matched
        <input
          type="checkbox"
          checked={includeMatched}
          onChange={(event) => onIncludeMatchedChange(event.target.checked)}
        />
      </label>
      <label>
        Dismissed
        <input
          type="checkbox"
          checked={includeDismissed}
          onChange={(event) => onIncludeDismissedChange(event.target.checked)}
        />
      </label>
    </div>
  ),
}));
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

  it("includes matched and dismissed questions independently without a separate history table", () => {
    render(<FormFillWorkspace />);
    fireEvent.click(screen.getByRole("tab", { name: "Review inbox" }));
    const matched = screen.getByRole("checkbox", { name: "Matched" });
    const dismissed = screen.getByRole("checkbox", { name: "Dismissed" });
    expect(screen.queryByRole("tab", { name: "Dismissed" })).toBeNull();
    expect(screen.queryByText("Cleared value history")).toBeNull();
    fireEvent.click(matched);
    expect(screen.getByText("Question list").getAttribute("data-matched")).toBe("true");
    expect(screen.getByText("Question list").getAttribute("data-dismissed")).toBe("false");
    expect(new URLSearchParams(window.location.search).get("include")).toBe("matched");
    fireEvent.click(dismissed);
    expect(new URLSearchParams(window.location.search).get("include")).toBe("matched,dismissed");
    fireEvent.click(matched);
    expect(screen.getByText("Question list").getAttribute("data-matched")).toBe("false");
    expect(screen.getByText("Question list").getAttribute("data-dismissed")).toBe("true");
    expect(new URLSearchParams(window.location.search).get("include")).toBe("dismissed");
  });

  it.each(["questions", "captures"])(
    "preserves legacy Dismissed %s links in the unified inbox",
    (type) => {
      window.history.replaceState(
        null,
        "",
        `/?view=form-fill&section=dismissed&type=${type}&capture=capture-opaque`,
      );
      render(<FormFillWorkspace />);
      expect(screen.getByRole("tab", { name: "Review inbox" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(
        (screen.getByRole("checkbox", { name: "Dismissed" }) as HTMLInputElement).checked,
      ).toBe(true);
      expect((screen.getByRole("checkbox", { name: "Matched" }) as HTMLInputElement).checked).toBe(
        type === "captures",
      );
      expect(screen.getByText("Capture drawer")).toBeTruthy();
      const params = new URLSearchParams(window.location.search);
      expect(params.get("section")).toBe("review");
      expect(params.get("type")).toBeNull();
      expect(params.get("history")).toBeNull();
      expect(params.get("include")).toBe(type === "captures" ? "matched,dismissed" : "dismissed");
      expect(params.get("capture")).toBe("capture-opaque");
    },
  );

  it("preserves old combined filter links and restores filters through browser history", () => {
    window.history.replaceState(
      null,
      "",
      "/?view=form-fill&section=review&include=handled&history=cleared",
    );
    render(<FormFillWorkspace />);
    expect(screen.getByText("Question list").getAttribute("data-matched")).toBe("true");
    expect(screen.getByText("Question list").getAttribute("data-dismissed")).toBe("true");
    window.history.replaceState(null, "", "/?view=form-fill&section=review");
    fireEvent.popState(window);
    expect(screen.getByText("Question list").getAttribute("data-matched")).toBe("false");
    expect(screen.getByText("Question list").getAttribute("data-dismissed")).toBe("false");
  });

  it("opens the unified inbox for old review links", () => {
    window.history.replaceState(null, "", "/?view=form-fill&section=review&type=captures");
    render(<FormFillWorkspace />);
    expect(screen.getByText("Question list")).toBeTruthy();
  });
});
