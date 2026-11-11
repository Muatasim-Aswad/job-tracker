import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AttentionPanel } from "./AttentionPanel";

afterEach(cleanup);

const attention = { stage: "applied", since: "2026-06-26T09:00:00Z", days: 24 } as const;

describe("AttentionPanel", () => {
  it("routes Add note to the existing composer request", () => {
    const onAddNote = vi.fn();
    render(<AttentionPanel attention={attention} onAddNote={onAddNote} onMarkGhosted={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(onAddNote).toHaveBeenCalledTimes(1);
  });

  it("marks ghosted only after the armed confirmation click", () => {
    const onMarkGhosted = vi.fn();
    render(
      <AttentionPanel attention={attention} onAddNote={vi.fn()} onMarkGhosted={onMarkGhosted} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark ghosted" }));
    expect(onMarkGhosted).not.toHaveBeenCalled();
    expect(screen.getByText("Mark this job ghosted?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mark ghosted" }));
    expect(onMarkGhosted).toHaveBeenCalledTimes(1);
  });
});
