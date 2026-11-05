import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { NoResults } from "./NoResults";

afterEach(cleanup);

describe("NoResults", () => {
  it("names the search term when only search narrows the view", () => {
    render(
      <NoResults
        query="engineer"
        showStarred={false}
        showAttention={false}
        hideHidden={false}
        hideBlocked={false}
        easyApplyOnly={false}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("No jobs match “engineer”.")).toBeTruthy();
  });

  it("mentions starred when both search and starred narrow the view", () => {
    render(
      <NoResults
        query="engineer"
        showStarred
        showAttention={false}
        hideHidden={false}
        hideBlocked={false}
        easyApplyOnly={false}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("No jobs match “engineer” among starred.")).toBeTruthy();
  });

  it("has starred-only copy when starred narrows with no search text", () => {
    render(
      <NoResults
        query=""
        showStarred
        showAttention={false}
        hideHidden={false}
        hideBlocked={false}
        easyApplyOnly={false}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("No starred jobs match.")).toBeTruthy();
  });

  it("mentions the hidden filter when it excludes every job", () => {
    render(
      <NoResults
        query=""
        showStarred={false}
        showAttention={false}
        hideHidden
        hideBlocked={false}
        easyApplyOnly={false}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("No non-hidden jobs match.")).toBeTruthy();
  });

  it("calls onClear when the button is clicked", () => {
    const onClear = vi.fn();
    render(
      <NoResults
        query="engineer"
        showStarred={false}
        showAttention={false}
        hideHidden={false}
        hideBlocked={false}
        easyApplyOnly={false}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByText("Clear filters"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("has attention-only copy", () => {
    render(
      <NoResults
        query=""
        showStarred={false}
        showAttention
        hideHidden={false}
        hideBlocked={false}
        easyApplyOnly={false}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("No jobs need attention.")).toBeTruthy();
  });
});
