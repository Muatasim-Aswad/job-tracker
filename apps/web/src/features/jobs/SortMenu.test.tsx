import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SortMenu } from "./SortMenu";
import type { SortOrder } from "./jobSort";

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState<SortOrder>("recently_updated");
  return <SortMenu value={value} onChange={setValue} />;
}

describe("SortMenu", () => {
  it("shows the current option and marks it checked", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Sort: Updated (newest)" }));

    expect(screen.getByRole("menu", { name: "Sort jobs" })).toBeTruthy();
    expect(
      screen.getByRole("menuitemradio", { name: "Updated (newest)" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(6);
  });

  it("selects an option, closes, and updates the trigger label", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Sort: Updated (newest)" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Added (oldest)" }));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Sort: Added (oldest)" })).toBeTruthy();
  });

  it("supports roving arrows and Home/End", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Sort: Updated (newest)" }));
    const current = screen.getByRole("menuitemradio", { name: "Updated (newest)" });
    const menu = screen.getByRole("menu", { name: "Sort jobs" });

    expect(document.activeElement).toBe(current);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemradio", { name: "Updated (oldest)" }),
    );
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Title (Z–A)" }));
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(current);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Title (Z–A)" }));
  });

  it("closes with Escape and returns focus to the trigger", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Sort: Updated (newest)" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
