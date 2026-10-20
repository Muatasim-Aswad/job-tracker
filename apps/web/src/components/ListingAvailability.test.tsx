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

it("counts mixed listings without labelling the whole job unavailable", () => {
  const job = {
    listing_count: 3,
    listing_availability: {
      unavailable_count: 1,
      closed_count: 1,
      closed_at: null,
      unavailable_observed_at: null,
    },
  } as JobSummary;
  render(<JobListingAvailability job={job} />);
  expect(screen.getByText("1 unavailable")).toBeTruthy();
  expect(screen.getByText("1 closed")).toBeTruthy();
  expect(screen.queryByText(/^Unavailable /)).toBeNull();
});

it("keeps open and unknown listing summaries quiet", () => {
  const job = {
    listing_count: 1,
    listing_availability: { unavailable_count: 0, closed_count: 0 },
  } as JobSummary;
  const { container } = render(<JobListingAvailability job={job} />);
  expect(container.textContent).toBe("");
});

it("allows tapping availability without opening or dragging its job card", () => {
  const open = vi.fn();
  const drag = vi.fn();
  render(
    <div onClick={open} onPointerDown={drag}>
      <AvailabilityLabel closed count={1} />
    </div>,
  );
  const label = screen.getByText("1 closed");
  fireEvent.pointerDown(label, { pointerType: "touch" });
  fireEvent.click(label);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
  expect(drag).not.toHaveBeenCalled();
});
