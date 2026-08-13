import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Drawer } from "./Drawer";

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open details
      </button>
      {open && (
        <Drawer label="Knowledge details" onClose={() => setOpen(false)}>
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </Drawer>
      )}
    </>
  );
}

describe("Form Fill drawer", () => {
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
