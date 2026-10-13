import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { CollapsibleSection } from "../components/CollapsibleSection";
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
  it.each([true, false])(
    "uses the current boundaries when a section is collapsed=%s",
    (collapsed) => {
      render(
        <Drawer label="Section details" onClose={vi.fn()}>
          <CollapsibleSection title="Extra" disclosure={{ collapsed, onToggle: vi.fn() }}>
            <input aria-label="Section input" />
          </CollapsibleSection>
          <div style={{ display: "none" }}>
            <button>CSS hidden</button>
          </div>
          <div hidden>
            <button>Hidden attribute</button>
          </div>
          <div style={{ visibility: "hidden" }}>
            <button>Invisible control</button>
          </div>
          <div inert>
            <button>Inert control</button>
          </div>
          <fieldset disabled>
            <input aria-label="Disabled group" />
          </fieldset>
          <button tabIndex={-2}>Negative tab index</button>
        </Drawer>,
      );
      const first = screen.getByRole("button", { name: "Close" });
      const last = collapsed
        ? screen.getByRole("button", { name: /Extra/ })
        : screen.getByLabelText("Section input");
      first.focus();
      fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(last);
      fireEvent.keyDown(last, { key: "Tab" });
      expect(document.activeElement).toBe(first);
    },
  );

  it.each([false, true])(
    "keeps native details body controls outside the Tab boundary when open=%s",
    (open) => {
      render(
        <Drawer label="Native details" onClose={vi.fn()}>
          <details open={open}>
            <summary>More options</summary>
            <input aria-label="Native section input" />
          </details>
        </Drawer>,
      );
      const first = screen.getByRole("button", { name: "Close" });
      const last = open
        ? screen.getByLabelText("Native section input")
        : screen.getByText("More options");
      first.focus();
      fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(last);
      fireEvent.keyDown(last, { key: "Tab" });
      expect(document.activeElement).toBe(first);
    },
  );
});
