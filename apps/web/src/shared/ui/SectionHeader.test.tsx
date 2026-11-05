import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SectionHeader } from "./SectionHeader";

afterEach(cleanup);

describe("SectionHeader", () => {
  it("renders a heading with the count appended", () => {
    render(<SectionHeader title="Timeline" count={3} />);
    expect(screen.getByRole("heading").textContent).toBe("Timeline (3)");
  });

  it("shows a zero count rather than hiding it", () => {
    render(<SectionHeader title="Documents" count={0} />);
    expect(screen.getByRole("heading").textContent).toBe("Documents (0)");
  });

  it("omits the parenthetical when there is nothing to count", () => {
    render(<SectionHeader title="Status" />);
    expect(screen.getByRole("heading").textContent).toBe("Status");
  });

  it("words the add toggle from the noun, both ways", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <SectionHeader title="Timeline" add={{ noun: "note", open: false, onToggle }} />,
    );
    const add = screen.getByRole("button", { name: "Add note" });
    fireEvent.click(add);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<SectionHeader title="Timeline" add={{ noun: "note", open: true, onToggle }} />);
    expect(screen.getByRole("button", { name: "Cancel adding note" })).toBeTruthy();
  });

  it("announces the add toggle as a disclosure, not a plain button", () => {
    render(
      <SectionHeader title="Timeline" add={{ noun: "note", open: true, onToggle: vi.fn() }} />,
    );
    const add = screen.getByRole("button", { name: "Cancel adding note" });
    expect(add.getAttribute("aria-expanded")).toBe("true");
    expect(add.getAttribute("aria-pressed")).toBeNull();
  });

  it("offers help behind a named control that describes the section on demand", () => {
    render(<SectionHeader title="Custom fields" help="Free-form key/value notes." />);
    const q = screen.getByRole("button", { name: "About Custom fields" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(q.parentElement!);
    expect(screen.getByRole("tooltip").textContent).toBe("Free-form key/value notes.");
  });

  it("has no help control when no help text is given", () => {
    render(<SectionHeader title="Custom fields" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders extra controls alongside the add toggle", () => {
    render(
      <SectionHeader title="Documents" add={{ noun: "document", open: false, onToggle: vi.fn() }}>
        <button type="button">Sort</button>
      </SectionHeader>,
    );
    expect(screen.getByRole("button", { name: "Sort" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add document" })).toBeTruthy();
  });
});
