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
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByLabelText("Stop filtering by attention").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("keeps the attention toggle operable without rendering a zero badge", () => {
    renderBar({ attentionCount: 0 });
    expect(screen.getByLabelText("Show jobs needing attention")).toBeTruthy();
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

  it("reflects toggle state via aria-pressed", () => {
    renderBar({ hideHidden: true, showStarred: false });
    expect(screen.getByLabelText("Include hidden").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Show starred only").getAttribute("aria-pressed")).toBe("false");
  });

  it("calls the toggle handlers on click", () => {
    const { onToggleHidden, onToggleStarred, onToggleAttention } = renderBar();
    fireEvent.click(screen.getByLabelText("Show jobs needing attention"));
    fireEvent.click(screen.getByLabelText("Only visible"));
    fireEvent.click(screen.getByLabelText("Show starred only"));
    expect(onToggleHidden).toHaveBeenCalledTimes(1);
    expect(onToggleStarred).toHaveBeenCalledTimes(1);
    expect(onToggleAttention).toHaveBeenCalledTimes(1);
  });
});
