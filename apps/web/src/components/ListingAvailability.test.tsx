import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { JobSummary } from "@job-tracker/shared/api";
import { AvailabilityLabel, JobListingAvailability } from "./ListingAvailability";

afterEach(cleanup);

it("keeps the original notice and precise time in a focusable tooltip", () => {
  render(
    <AvailabilityLabel
      closed={false}
      date="2026-10-19T10:15:00Z"
      observedAt="2026-10-19T10:15:00Z"
      message="Not currently accepting applications"
    />,
  );
  expect(screen.queryByText("Not currently accepting applications")).toBeNull();
  fireEvent.focus(screen.getByText("Unavailable 19 Oct 2026").closest("span")!);
  expect(screen.getByRole("tooltip").textContent).toContain("Not currently accepting applications");
  expect(screen.getByRole("tooltip").textContent).toContain("Availability observed");
});

it.each([
  [0, 1, 0, "Unavailable"],
  [0, 0, 1, "Closed"],
  [0, 1, 1, "Unavailable"],
  [1, 1, 0, ""],
  [1, 0, 1, ""],
  [1, 1, 1, ""],
  [0, 0, 0, ""],
])(
  "summarizes LinkedIn open=%i unavailable=%i closed=%i as %s",
  (open, unavailable, closed, label) => {
    const job = {
      listing_count: open + unavailable + closed || 1,
      listing_availability: {
        linkedin_open_count: open,
        unavailable_count: unavailable,
        closed_count: closed,
        closed_at: "2026-10-19T10:15:00Z",
        unavailable_observed_at: "2026-10-19T10:15:00Z",
      },
    } as JobSummary;
    const { container } = render(<JobListingAvailability job={job} />);
    expect(container.textContent).toBe(label);
    expect(container.querySelector("time")).toBeNull();
  },
);

it("allows tapping availability without opening or dragging its job card", () => {
  const open = vi.fn();
  const drag = vi.fn();
  render(
    <div onClick={open} onPointerDown={drag}>
      <AvailabilityLabel closed />
    </div>,
  );
  const label = screen.getByText("Closed");
  fireEvent.pointerDown(label, { pointerType: "touch" });
  fireEvent.click(label);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
  expect(drag).not.toHaveBeenCalled();
});
