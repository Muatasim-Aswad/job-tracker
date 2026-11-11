import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ExpandableText } from "./ExpandableText";

afterEach(cleanup);

// jsdom performs no layout, so tests supply the measured dimensions.
function stubClamp({ scroll, client }: { scroll: number; client: number }) {
  const s = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  const c = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    value: scroll,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    value: client,
  });
  return () => {
    if (s) Object.defineProperty(HTMLElement.prototype, "scrollHeight", s);
    if (c) Object.defineProperty(HTMLElement.prototype, "clientHeight", c);
  };
}

describe("ExpandableText", () => {
  it("offers no toggle when nothing is actually hidden, however long the text", () => {
    // Length alone must not imply overflow.
    const restore = stubClamp({ scroll: 60, client: 60 });
    render(<ExpandableText text={"word ".repeat(120)} />);
    expect(screen.queryByRole("button")).toBeNull();
    restore();
  });

  it("offers a toggle when text is clipped, however short", () => {
    // Rendered overflow must expose the expansion control.
    const restore = stubClamp({ scroll: 120, client: 60 });
    render(<ExpandableText text={"a\nb\nc\nd\ne"} />);
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
    restore();
  });

  it("expands and collapses, keeping the collapse control available while expanded", () => {
    const restore = stubClamp({ scroll: 120, client: 60 });
    const { container } = render(<ExpandableText text={"a\nb\nc\nd\ne"} />);
    const p = container.querySelector("p")!;
    expect(p.className).toContain("line-clamp-3");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(container.querySelector("p")!.className).not.toContain("line-clamp-3");
    // The control must not rip itself away once the element no longer overflows.
    const less = screen.getByRole("button", { name: "Show less" });
    fireEvent.click(less);
    expect(container.querySelector("p")!.className).toContain("line-clamp-3");
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
    restore();
  });
});

describe("ExpandableText — a preview that differs from the text", () => {
  // Use textContent because text queries normalize the whitespace under test.
  it("shows the preview collapsed and the real text expanded", () => {
    const restore = stubClamp({ scroll: 120, client: 60 });
    const { container } = render(
      <ExpandableText text={"Heading\n\nBody."} previewText="Heading Body." lines={2} />,
    );

    expect(container.querySelector("p")!.textContent).toBe("Heading Body.");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(container.querySelector("p")!.textContent).toBe("Heading\n\nBody.");
    restore();
  });

  // A substituted preview must expose original structure even without overflow.
  it("offers the toggle even when the preview fits the clamp", () => {
    const restore = stubClamp({ scroll: 60, client: 60 });
    render(<ExpandableText text={"One.\n\nTwo."} previewText="One. Two." lines={2} />);

    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
    restore();
  });

  it("stays overflow-gated when the preview is the text", () => {
    const restore = stubClamp({ scroll: 60, client: 60 });
    render(<ExpandableText text="Same." previewText="Same." lines={2} />);

    expect(screen.queryByRole("button")).toBeNull();
    restore();
  });
});
