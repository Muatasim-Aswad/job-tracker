import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Drawer } from "./Drawer";
import { canLeaveFormFill } from "./draftGuard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ dirty = false, backLabel }: { dirty?: boolean; backLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open details
      </button>
      {open && (
        <Drawer
          label="Knowledge details"
          onClose={() => setOpen(false)}
          dirty={dirty}
          backLabel={backLabel}
        >
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </Drawer>
      )}
    </>
  );
}

describe("Form Fill drawer", () => {
  it.each([undefined, "Back to question"])(
    "protects a dirty draft with %s on close, navigation, and browser back",
    (backLabel) => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const original = window.location.href;
      render(<Harness dirty backLabel={backLabel} />);
      fireEvent.click(screen.getByRole("button", { name: "Open details" }));
      fireEvent.click(screen.getByRole("button", { name: backLabel ?? "Close" }));
      if (backLabel) expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(canLeaveFormFill()).toBe(false);
      window.history.pushState(null, "", "/?section=other");
      fireEvent.popState(window);
      expect(window.location.href).toBe(original);
      const unload = new Event("beforeunload", { cancelable: true });
      expect(window.dispatchEvent(unload)).toBe(false);
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole("button", { name: backLabel ?? "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(canLeaveFormFill()).toBe(true);
    },
  );
  it("traps focus, closes with Escape, and restores the trigger", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open details" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Knowledge details" });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last action" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
