import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { JobEvent } from "@job-tracker/shared/api";
import { Timeline } from "./Timeline";

vi.mock("./queries", () => ({
  useUpdateEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEvent: () => ({ mutate: vi.fn() }),
  useNoteTitles: () => ({ data: [] }),
}));

afterEach(cleanup);

function ev(overrides: Partial<JobEvent> & Pick<JobEvent, "id" | "event" | "ts">): JobEvent {
  return { job_id: "job-1", listing_id: null, meta: null, ...overrides };
}

describe("Timeline ordering", () => {
  // Event id provides the total order when a request gives events the same timestamp.
  it("breaks a timestamp tie on id, newest first", () => {
    const ts = "2026-05-01T10:00:00Z";
    render(
      <Timeline
        jobId="job-1"
        events={[ev({ id: 41, event: "applied", ts }), ev({ id: 42, event: "in_process", ts })]}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("In process")).toBeTruthy();
    expect(within(rows[1]).getByText("Applied")).toBeTruthy();
  });

  // Creation is the timeline origin even when imported activity predates capture.
  it("pins created to the bottom however recent its timestamp", () => {
    render(
      <Timeline
        jobId="job-1"
        events={[
          ev({ id: 1, event: "created", ts: "2026-07-03T01:00:00Z" }),
          ev({ id: 2, event: "applied", ts: "2025-08-21T11:59:00Z" }),
          ev({ id: 3, event: "rejected", ts: "2025-08-21T12:00:00Z" }),
        ]}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("Rejected")).toBeTruthy();
    expect(within(rows[1]).getByText("Applied")).toBeTruthy();
    expect(within(rows[2]).getByText("Created")).toBeTruthy();
  });

  it("groups repeat captures at the bottom, newest first among themselves", () => {
    render(
      <Timeline
        jobId="job-1"
        events={[
          ev({ id: 1, event: "created", ts: "2026-07-03T01:00:00Z", meta: { via: "capture" } }),
          ev({ id: 2, event: "created", ts: "2026-07-04T22:29:00Z", meta: { via: "seen" } }),
          ev({ id: 3, event: "rejected", ts: "2025-08-21T12:00:00Z" }),
        ]}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("Rejected")).toBeTruthy();
    expect(within(rows[1]).getByText("seen")).toBeTruthy();
    expect(within(rows[2]).getByText("capture")).toBeTruthy();
  });

  it("renders a sub-minute held span as <1m, never 'just now'", () => {
    const ts = "2026-05-01T10:00:00Z";
    render(
      <Timeline
        jobId="job-1"
        events={[ev({ id: 41, event: "applied", ts }), ev({ id: 42, event: "in_process", ts })]}
      />,
    );

    const applied = screen.getAllByRole("listitem")[1];
    expect(within(applied).getByText("held <1m")).toBeTruthy();
    expect(screen.queryByText("held just now")).toBeNull();
  });

  // A held span belongs only to a stage with a known end.
  it("gives the current stage no held span, only the closed ones", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    render(
      <Timeline
        jobId="job-1"
        events={[
          ev({ id: 1, event: "seen", ts: twoDaysAgo }),
          ev({ id: 2, event: "applied", ts: dayAgo }),
        ]}
      />,
    );

    const [current, previous] = screen.getAllByRole("listitem");
    expect(within(current).getByText("Applied")).toBeTruthy();
    expect(within(current).queryByText(/^held /)).toBeNull();
    expect(within(previous).getByText("held 1d")).toBeTruthy();
  });
});

describe("Timeline labels", () => {
  it("labels an organic status event with its status label", () => {
    render(
      <Timeline
        jobId="job-1"
        events={[ev({ id: 1, event: "in_process", ts: "2026-05-01T10:00:00Z" })]}
      />,
    );
    expect(screen.getByText("In process")).toBeTruthy();
    expect(screen.queryByText("in_process")).toBeNull();
  });

  it("labels a created event and falls back to 'Note' for an untitled note", () => {
    render(
      <Timeline
        jobId="job-1"
        events={[
          ev({ id: 1, event: "created", ts: "2026-05-01T10:00:00Z" }),
          ev({ id: 2, event: "note", ts: "2026-05-02T10:00:00Z", meta: { note: "body" } }),
        ]}
      />,
    );
    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.getByText("Note")).toBeTruthy();
  });
});

describe("Timeline provenance", () => {
  // Explicit provenance takes precedence over the listing-based fallback.
  it("prefers meta.via over the listing_id fallback, and shows it once", () => {
    render(
      <Timeline
        jobId="job-1"
        events={[
          ev({ id: 1, event: "created", ts: "2026-05-01T10:00:00Z", meta: { via: "capture" } }),
        ]}
      />,
    );
    expect(screen.getByText("capture")).toBeTruthy();
    expect(screen.queryByText("manual")).toBeNull();
    expect(screen.queryByText(/via: capture/)).toBeNull();
  });

  it("falls back to captured/manual when there is no via", () => {
    render(
      <Timeline
        jobId="job-1"
        events={[ev({ id: 1, event: "applied", ts: "2026-05-01T10:00:00Z", listing_id: "lst-7" })]}
      />,
    );
    expect(screen.getByText("captured")).toBeTruthy();
  });

  it("surfaces a superseded automatic closure without treating it as active", () => {
    render(
      <Timeline
        jobId="job-1"
        events={[
          ev({
            id: 1,
            event: "closed",
            ts: "2026-05-01T10:00:00Z",
            meta: {
              source: "automatic",
              reason: "all_listings_closed",
              invalidated_at: "2026-05-02T10:00:00Z",
              invalidated_reason: "open_listing",
            },
          }),
        ]}
      />,
    );

    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Automatic closure superseded")).toBeTruthy();
    expect(within(row).getByText("automatic")).toBeTruthy();
    expect(within(row).queryByText(/^held /)).toBeNull();
    expect(screen.queryByText("Raw metadata")).toBeNull();
  });
});

describe("Timeline metadata rendering", () => {
  it("renders a nested meta value as JSON in a disclosure, never [object Object]", () => {
    render(
      <Timeline
        jobId="job-1"
        events={[
          ev({
            id: 1,
            event: "applied",
            ts: "2026-05-01T10:00:00Z",
            meta: { some_script_key: { nested: ["a", 1] } },
          }),
        ]}
      />,
    );

    expect(document.body.textContent).not.toContain("[object Object]");
    const disclosure = screen.getByText("Raw metadata");
    expect(disclosure).toBeTruthy();
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain('"nested"');
  });

  it("shows no disclosure when the bag holds only named keys", () => {
    render(
      <Timeline
        jobId="job-1"
        events={[
          ev({
            id: 1,
            event: "note",
            ts: "2026-05-01T10:00:00Z",
            meta: { title: "Call", note: "went well" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("Raw metadata")).toBeNull();
  });
});

describe("Timeline note composer", () => {
  it("opens and focuses the existing composer when the drawer requests it", async () => {
    render(<Timeline jobId="job-1" events={[]} addNoteRequest={1} />);

    const title = await screen.findByPlaceholderText("Title (e.g. Phone screen)");
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.getAllByPlaceholderText("Details (optional)")).toHaveLength(1);
  });

  it("names both composer fields independently of their placeholders", async () => {
    render(<Timeline jobId="job-1" events={[]} addNoteRequest={1} />);

    expect(await screen.findByRole("combobox", { name: "Note title" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Note details (optional)" })).toBeTruthy();
  });
});
