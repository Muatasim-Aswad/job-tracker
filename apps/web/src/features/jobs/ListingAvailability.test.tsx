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
  ["unavailable", "Unavailable"],
  ["closed", "Closed"],
  ["open", ""],
  ["unknown", ""],
] as const)("displays API availability %s as %s", (availability, label) => {
  const job = { availability } as JobSummary;
  const { container } = render(<JobListingAvailability job={job} />);
  expect(container.textContent).toBe(label);
  expect(container.querySelector("time")).toBeNull();
});

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
