import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderMenu } from "./HeaderMenu";

beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false })));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const props = {
  view: "jobs" as const,
  hasReview: false,
  onChangeView: vi.fn(),
  onOpenBlocked: vi.fn(),
  onOpenHelp: vi.fn(),
  themePref: "system" as const,
  cycleTheme: vi.fn(),
};

describe("mobile header actions", () => {
  it.each([
    ["jobs", "Jobs", "Form Fill"],
    ["form-fill", "Form Fill", "Jobs"],
  ] as const)("marks and disables the current %s workspace", (view, current, other) => {
    const change = vi.fn();
    render(<HeaderMenu {...props} view={view} onChangeView={change} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Navigation and settings" }));
    const selected = screen.getByRole("menuitem", { name: current }) as HTMLButtonElement;
    const next = screen.getByRole("menuitem", { name: other });
    expect(selected.disabled).toBe(true);
    expect(selected.getAttribute("aria-current")).toBe("page");
    expect(document.activeElement).toBe(next);
    fireEvent.click(selected);
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
    const divider = screen.getByRole("separator");
    const add = screen.getByRole("menuitem", {
      name: view === "jobs" ? "Add a job" : "New answer",
    });
    expect(next.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.keyDown(next, { key: "ArrowDown" });
    expect(document.activeElement).toBe(add);
    fireEvent.click(next);
    expect(change).toHaveBeenCalledWith(view === "jobs" ? "form-fill" : "jobs");
  });

  it.each(["Add a job", "Refresh data"])("runs %s and closes the menu", (label) => {
    const add = vi.fn();
    const refresh = vi.fn();
    render(<HeaderMenu {...props} onAdd={add} onRefresh={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Navigation and settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
    expect(label === "Add a job" ? add : refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers answer creation only when the current collection supplies it", () => {
    const add = vi.fn();
    const view = render(<HeaderMenu {...props} view="form-fill" onAdd={add} />);
    fireEvent.click(screen.getByRole("button", { name: "Navigation and settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New answer" }));
    expect(add).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    view.rerender(<HeaderMenu {...props} view="form-fill" />);
    fireEvent.click(screen.getByRole("button", { name: "Navigation and settings" }));
    expect(screen.queryByRole("menuitem", { name: "New answer" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Refresh data" })).toBeNull();
  });
});
