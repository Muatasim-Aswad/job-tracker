import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testQuestion } from "./testFixtures";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../hooks", () => ({
  useFormFillReviewPresence: () => ({
    hasReview: true,
    hasCaptures: false,
    hasQuestions: true,
    isLoading: false,
  }),
}));

vi.mock("./AnswerList", () => ({
  AnswerList: ({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: () => void }) => (
    <>
      <button type="button" onClick={() => onOpen("answer-opaque")}>
        Open synthetic Answer
      </button>
      <button onClick={onCreate}>Create synthetic Answer</button>
    </>
  ),
}));
vi.mock("./QuestionList", () => ({
  QuestionList: ({
    includeMatched,
    includeDismissed,
    onIncludeMatchedChange,
    onIncludeDismissedChange,
    onOpen,
  }: {
    onOpen: (id: string) => void;
    includeMatched: boolean;
    includeDismissed: boolean;
    onIncludeMatchedChange: (checked: boolean) => void;
    onIncludeDismissedChange: (checked: boolean) => void;
  }) => (
    <div data-matched={includeMatched} data-dismissed={includeDismissed}>
      Question list
      <button onClick={() => onOpen(testQuestion.id)}>Open synthetic Question</button>
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
vi.mock("./AnswerDrawer", () => ({
  AnswerDrawer: ({ onCreated }: { onCreated: (id: string) => void }) => (
    <div>
      Answer drawer<button onClick={() => onCreated("answer-created")}>Finish answer</button>
    </div>
  ),
}));
vi.mock("./CaptureDrawer", () => ({
  CaptureDrawer: ({ onClose }: { onClose: () => void }) => (
    <div>
      Capture drawer<button onClick={onClose}>Finish capture</button>
    </div>
  ),
}));
vi.mock("./QuestionDrawer", () => ({
  QuestionDrawer: ({
    onCreateAnswer,
  }: {
    onCreateAnswer: (question: typeof testQuestion) => void;
  }) => (
    <div>
      Question drawer
      <button onClick={() => onCreateAnswer(testQuestion)}>Create matched answer</button>
    </div>
  ),
}));

import { FormFillWorkspace } from "./FormFillWorkspace";

beforeEach(() => window.history.replaceState(null, "", "/?view=form-fill&section=answers"));
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("FormFillWorkspace navigation", () => {
  it("exposes answer creation to the header only in Saved answers", async () => {
    const ready = vi.fn();
    const view = render(<FormFillWorkspace onCreateReady={ready} />);
    const create = ready.mock.calls.at(-1)?.[0];
    expect(create).toBeTypeOf("function");
    await act(async () => create());
    expect(screen.getByText("Answer drawer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish answer" }));
    fireEvent.click(screen.getByRole("tab", { name: "Review inbox" }));
    expect(ready).toHaveBeenLastCalledWith(null);
    view.unmount();
    expect(ready).toHaveBeenLastCalledWith(null);
  });

  it("closes contextual creation after completion instead of reopening the question", () => {
    window.history.replaceState(null, "", "/?view=form-fill&section=review");
    render(<FormFillWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Open synthetic Question" }));
    fireEvent.click(screen.getByRole("button", { name: "Create matched answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish answer" }));
    expect(screen.queryByText("Answer drawer")).toBeNull();
    expect(screen.queryByText("Question drawer")).toBeNull();
    expect(new URLSearchParams(window.location.search).has("question")).toBe(false);
  });

  it("closes capture review and its underlying question after completion", () => {
    window.history.replaceState(null, "", "/?view=form-fill&section=review&question=q&capture=c");
    render(<FormFillWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Finish capture" }));
    expect(screen.queryByText("Capture drawer")).toBeNull();
    expect(screen.queryByText("Question drawer")).toBeNull();
    expect(new URLSearchParams(window.location.search).has("question")).toBe(false);
  });

  it("restores local collection and inclusion preferences on a fresh visit", () => {
    localStorage.setItem("jt.formFill.section", "review");
    localStorage.setItem("jt.formFill.includeMatched", "true");
    localStorage.setItem("jt.formFill.includeDismissed", "true");
    window.history.replaceState(null, "", "/?view=form-fill");
    const view = render(<FormFillWorkspace />);
    expect(screen.getByText("Question list").getAttribute("data-matched")).toBe("true");
    expect(screen.getByText("Question list").getAttribute("data-dismissed")).toBe("true");
    view.unmount();
    window.history.replaceState(null, "", "/?view=form-fill&section=review&include=matched");
    render(<FormFillWorkspace />);
    expect(screen.getByText("Question list").getAttribute("data-dismissed")).toBe("false");
  });

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
