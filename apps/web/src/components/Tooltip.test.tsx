import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "./Tooltip";

afterEach(cleanup);

const trigger = (label = "Help") => (
  <Tooltip label="What this section means">
    <button type="button">{label}</button>
  </Tooltip>
);

describe("Tooltip", () => {
  it("is closed until something asks for it", () => {
    render(trigger());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens on hover and closes when the pointer leaves", () => {
    render(trigger());
    const wrap = screen.getByRole("button").parentElement!;
    fireEvent.mouseEnter(wrap);
    expect(screen.getByRole("tooltip").textContent).toBe("What this section means");
    fireEvent.mouseLeave(wrap);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens on keyboard focus and closes on blur", () => {
    render(trigger());
    const btn = screen.getByRole("button");
    fireEvent.focus(btn);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.blur(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("toggles on tap, so a touch user can dismiss it", () => {
    render(trigger());
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("leaves action clicks intact when click toggling is disabled", () => {
    const action = vi.fn();
    render(
      <Tooltip label="Save the reviewed changes" toggleOnClick={false}>
        <button type="button" onClick={action}>
          Save
        </button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.focus(button);
    fireEvent.click(button);
    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByRole("tooltip").textContent).toBe("Save the reviewed changes");
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(button);
    expect(action).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("describes the trigger itself while open, and stops when closed", () => {
    render(trigger());
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-describedby")).toBeNull();
    fireEvent.focus(btn);
    const tip = screen.getByRole("tooltip");
    expect(btn.getAttribute("aria-describedby")).toBe(tip.id);
    // The name stays the trigger's own text — the tooltip describes, never renames.
    expect(btn.textContent).toBe("Help");
    fireEvent.blur(btn);
    expect(btn.getAttribute("aria-describedby")).toBeNull();
  });

  it("escapes closed", () => {
    render(trigger());
    fireEvent.focus(screen.getByRole("button"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("renders outside the trigger's container so a clipping ancestor cannot cut it", () => {
    render(<div style={{ overflow: "hidden" }}>{trigger()}</div>);
    fireEvent.focus(screen.getByRole("button"));
    const tip = screen.getByRole("tooltip");
    expect(tip.parentElement).toBe(document.body);
    expect(tip.style.position).toBe("fixed");
  });

  it("keeps the bubble inside the viewport", () => {
    // A trigger hard against the right edge: the bubble must slide back, not
    // centre itself off-screen.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const wide = this.getAttribute("role") === "tooltip";
      return {
        top: 4,
        bottom: 24,
        left: wide ? 0 : window.innerWidth - 10,
        right: wide ? 200 : window.innerWidth,
        width: wide ? 200 : 10,
        height: wide ? 30 : 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
    render(trigger());
    fireEvent.focus(screen.getByRole("button"));
    const tip = screen.getByRole("tooltip");
    const left = parseFloat(tip.style.left);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + 200).toBeLessThanOrEqual(window.innerWidth);
    // No room above (top 4 < bubble height + gap), so it flips below the trigger.
    expect(parseFloat(tip.style.top)).toBeGreaterThan(24);
    vi.restoreAllMocks();
  });
});
