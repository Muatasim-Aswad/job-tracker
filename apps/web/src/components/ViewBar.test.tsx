import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { ViewBar } from "./ViewBar";

afterEach(cleanup);

function renderBar(overrides: Partial<Parameters<typeof ViewBar>[0]> = {}) {
  const props = {
    search: "",
    onSearchChange: vi.fn(),
    searchRef: createRef<HTMLInputElement>(),
    hideHidden: false,
    onToggleHidden: vi.fn(),
    showStarred: false,
    onToggleStarred: vi.fn(),
    showAttention: false,
    onToggleAttention: vi.fn(),
    hideBlocked: false,
    onToggleBlocked: vi.fn(),
    easyApplyOnly: false,
    onToggleEasyApply: vi.fn(),
    attentionCount: 0,
    shownCount: 1172,
    totalCount: 1172,
    onClearAll: vi.fn(),
    ...overrides,
  };
  render(<ViewBar {...props} />);
  return props;
}

describe("ViewBar", () => {
  it("shows a bare total when resting", () => {
    renderBar({ shownCount: 1172, totalCount: 1172 });
    expect(screen.getByText("1172")).toBeTruthy();
    expect(screen.queryByLabelText("Clear filters")).toBeNull();
  });

  it("expands to 'x of y' with a clear-all button when search narrows the view", () => {
    renderBar({ search: "engineer", shownCount: 58, totalCount: 1172 });
    expect(screen.getByText("58 of 1172")).toBeTruthy();
    expect(screen.getByLabelText("Clear filters")).toBeTruthy();
  });

  it("expands when starred-only is on, even with no search text", () => {
    renderBar({ showStarred: true, shownCount: 12, totalCount: 1172 });
    expect(screen.getByText("12 of 1172")).toBeTruthy();
  });

  it("expands when attention-only is on and shows the non-hidden candidate count", () => {
    renderBar({ showAttention: true, attentionCount: 3, shownCount: 3 });
    expect(screen.getByText("3 of 1172")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Filters applied" }));
    expect(screen.getByText("3")).toBeTruthy();
    expect(
      (screen.getByRole("checkbox", { name: "Needs attention only" }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("keeps the attention toggle operable without rendering a zero badge", () => {
    renderBar({ attentionCount: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("checkbox", { name: "Needs attention only" })).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("expands when hidden jobs are excluded", () => {
    renderBar({ hideHidden: true, shownCount: 1100, totalCount: 1172 });
    expect(screen.getByText("1100 of 1172")).toBeTruthy();
    expect(screen.getByLabelText("Clear filters")).toBeTruthy();
  });

  it("calls clear-all when filters are active", () => {
    const { onClearAll } = renderBar({
      search: "engineer",
      hideHidden: true,
      showStarred: true,
      shownCount: 3,
    });
    fireEvent.click(screen.getByLabelText("Clear filters"));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("reflects filter state through labelled checkboxes", () => {
    renderBar({ hideHidden: true, showStarred: false });
    fireEvent.click(screen.getByRole("button", { name: "Filters applied" }));
    expect(
      (screen.getByRole("checkbox", { name: "Hide hidden jobs" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: "Starred only" }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("closes on Escape or outside interaction and restores focus on Escape", () => {
    renderBar();
    const trigger = screen.getByRole("button", { name: "Filters" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Needs attention only" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("group", { name: "Job filters" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("searchbox"));
    expect(screen.queryByRole("group", { name: "Job filters" })).toBeNull();
  });

  it("calls the toggle handlers on click", () => {
    const {
      onToggleHidden,
      onToggleStarred,
      onToggleAttention,
      onToggleBlocked,
      onToggleEasyApply,
    } = renderBar();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    fireEvent.click(screen.getByRole("checkbox", { name: "Needs attention only" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide hidden jobs" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Starred only" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide blocked companies" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Easy Apply only" }));
    expect(onToggleHidden).toHaveBeenCalledTimes(1);
    expect(onToggleStarred).toHaveBeenCalledTimes(1);
    expect(onToggleAttention).toHaveBeenCalledTimes(1);
    expect(onToggleBlocked).toHaveBeenCalledTimes(1);
    expect(onToggleEasyApply).toHaveBeenCalledTimes(1);
  });
});
