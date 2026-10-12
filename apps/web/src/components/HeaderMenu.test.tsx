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
  it.each(["desktop", "mobile"])(
    "wraps Tab among visible %s items and restores the opener",
    (layout) => {
      vi.stubGlobal("matchMedia", () => ({ matches: layout === "desktop" }));
      const style = document.createElement("style");
      style.textContent = layout === "desktop" ? "[data-mobile-navigation] { display: none; }" : "";
      document.head.append(style);
      try {
        render(<HeaderMenu {...props} onAdd={vi.fn()} onRefresh={vi.fn()} />);
        const trigger = screen.getByRole("button", { name: "Navigation and settings" });
        trigger.focus();
        fireEvent.click(trigger);
        const items = screen
          .getAllByRole("menuitem")
          .filter((item) => !(item as HTMLButtonElement).disabled);
        expect(document.activeElement).toBe(items[0]);
        const backwards = new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        items[0].dispatchEvent(backwards);
        expect(backwards.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(items.at(-1));
        const forwards = new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        });
        items.at(-1)!.dispatchEvent(forwards);
        expect(forwards.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(items[0]);
        fireEvent.keyDown(items[0], { key: "ArrowUp" });
        expect(document.activeElement).toBe(items.at(-1));
        fireEvent.keyDown(window, { key: "Escape" });
        expect(screen.queryByRole("menu")).toBeNull();
        expect(document.activeElement).toBe(trigger);
      } finally {
        style.remove();
      }
    },
  );
  it("recomputes navigation when the focused mobile item becomes hidden", () => {
    const style = document.createElement("style");
    document.head.append(style);
    try {
      render(<HeaderMenu {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "Navigation and settings" }));
      const mobile = screen.getByRole("menuitem", { name: "Form Fill" });
      expect(document.activeElement).toBe(mobile);
      style.textContent = "[data-mobile-navigation] { display: none; }";
      fireEvent.keyDown(mobile, { key: "ArrowUp" });
      expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Theme: System/ }));
      mobile.focus();
      fireEvent.keyDown(mobile, { key: "Tab" });
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "Blocked companies…" }),
      );
    } finally {
      style.remove();
    }
  });
});
