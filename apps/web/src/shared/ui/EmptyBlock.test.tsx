import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EmptyBlock } from "./EmptyBlock";

afterEach(cleanup);

describe("EmptyBlock", () => {
  it("states what is absent", () => {
    render(<EmptyBlock message="No documents yet." />);
    expect(screen.getByText("No documents yet.")).toBeTruthy();
  });

  it("offers no control when there is nothing to do", () => {
    render(<EmptyBlock message="No events." />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("runs the single offered action", () => {
    const onClick = vi.fn();
    render(<EmptyBlock message="No documents yet." action={{ label: "Add one", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add one" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("reads at the prose size, not the chip size — it is a sentence", () => {
    const { container } = render(<EmptyBlock message="No listings." />);
    expect(container.firstElementChild!.className).toContain("text-prose");
  });
});
