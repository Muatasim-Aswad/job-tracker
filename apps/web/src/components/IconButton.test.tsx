import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IconButton } from "./IconButton";

afterEach(cleanup);

describe("IconButton", () => {
  it("uses the label as both accessible name and tooltip", () => {
    render(<IconButton label="Star">★</IconButton>);
    const b = screen.getByRole("button", { name: "Star" });
    expect(b.getAttribute("title")).toBe("Star");
  });

  it("claims no state when it has none", () => {
    render(<IconButton label="Copy">c</IconButton>);
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-pressed")).toBeNull();
    expect(b.getAttribute("aria-expanded")).toBeNull();
  });

  it("announces a sticky flag as pressed, in both positions", () => {
    const { rerender } = render(
      <IconButton label="Star" active={false}>
        ★
      </IconButton>,
    );
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
    rerender(
      <IconButton label="Star" active>
        ★
      </IconButton>,
    );
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  it("announces a panel toggle as expanded, not pressed", () => {
    render(
      <IconButton label="Move" active activeMeans="expanded">
        m
      </IconButton>,
    );
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-expanded")).toBe("true");
    expect(b.getAttribute("aria-pressed")).toBeNull();
  });

  // jsdom cannot measure CSS; pin the 24px WCAG floor and coarse-pointer-only growth.
  it("grows the compact hit area on a coarse pointer only", () => {
    render(
      <IconButton label="Edit" size="sm">
        e
      </IconButton>,
    );
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("h-6 w-6");
    expect(cls).toContain("pointer-coarse:h-9");
    expect(cls).toContain("pointer-coarse:w-9");
  });
});
