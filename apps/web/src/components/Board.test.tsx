// Dragging to a later column posts a funnel event; an earlier column uses a
// correction. The test stubs geometry for dnd-kit's pointer collisions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import type { JobSummary } from "@job-tracker/shared/api";
import { STATUS_LABEL } from "@job-tracker/shared/funnel";
import { sortJobs } from "../lib/jobSort";
import { Board } from "./Board";

vi.mock("../api/client", () => ({
  api: {
    correctStatus: vi.fn(() => new Promise(() => {})),
  },
}));

import { api } from "../api/client";

const mockedApi = vi.mocked(api);

function makeJob(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "job-1",
    title: "Engineer",
    title_key: "engineer",
    company: "Sample Company",
    company_key: "sample company",
    status: "seen",
    hidden: false,
    starred: false,
    apply_types: [],
    platforms: [],
    listing_count: 1,
    primary_listing: null,
    attention: null,
    meta: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// getBoundingClientRect keyed by element identity, so dnd-kit's continuous
// (WhileDragging) rect measuring sees whatever this test set up for that node and
// a zero rect for everything else — including every OTHER column, so only the
// intended drop target ever has positive collision area.
const rects = new WeakMap<Element, DOMRect>();

function stubRect(el: Element, rect: { x: number; y: number; width: number; height: number }) {
  rects.set(el, {
    ...rect,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON() {
      return this;
    },
  } as DOMRect);
}

function dropZoneFor(label: string): HTMLElement {
  // Column renders a label row, then the droppable jobs container, as siblings
  // under one wrapper div.
  const labelRow = screen.getByText(label).closest("div")!;
  return labelRow.parentElement!.children[1] as HTMLElement;
}

function renderBoard(jobs: JobSummary[], onEvent = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Board jobs={jobs} onOpen={vi.fn()} onEvent={onEvent} />
    </QueryClientProvider>,
  );
  return { onEvent };
}

// Drags job-1's card from its own rect to whatever rect was stubbed for `target`,
// exceeding the 5px pointer-sensor activation distance first.
function drag(target: Element) {
  const cardEl = document.querySelector<HTMLElement>('[data-card-id="job-1"]')!;
  stubRect(cardEl, { x: 0, y: 0, width: 50, height: 30 });

  fireEvent.pointerDown(cardEl, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: 0,
    clientY: 0,
  });
  // Exceed the activation distance to start the drag.
  fireEvent.pointerMove(document, { pointerId: 1, isPrimary: true, clientX: 0, clientY: 10 });
  // Move onto the target's rect.
  const targetRect = rects.get(target)!;
  fireEvent.pointerMove(document, {
    pointerId: 1,
    isPrimary: true,
    clientX: targetRect.x + 20,
    clientY: targetRect.y + 10,
  });
  fireEvent.pointerUp(document, { pointerId: 1, isPrimary: true });
}

describe("Board drag interaction", () => {
  beforeEach(() => {
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      return (
        rects.get(this) ??
        ({
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          toJSON() {
            return this;
          },
        } as DOMRect)
      );
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the matching funnel event when dropped on a later (forward) column", () => {
    const { onEvent } = renderBoard([makeJob({ status: "seen" })]);
    const target = dropZoneFor(STATUS_LABEL.applied);
    stubRect(target, { x: 300, y: 0, width: 300, height: 2000 });

    drag(target);

    expect(onEvent).toHaveBeenCalledWith("job-1", [{ event: "applied" }]);
    expect(mockedApi.correctStatus).not.toHaveBeenCalled();
  });

  it("renders server-provided attention as passive card text", () => {
    renderBoard([
      makeJob({
        status: "applied",
        attention: { stage: "applied", since: "2026-06-26T09:00:00Z", days: 24 },
      }),
    ]);

    // Duration first, stage after the dot — "Stalled in {stage}" doubled the
    // preposition for noun-phrase stages ("Stalled in In process").
    expect(screen.getByText("Stalled 24 days · Applied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ghosted/i })).toBeNull();
  });

  it("routes a drop onto an earlier column through the correction endpoint instead", async () => {
    const { onEvent } = renderBoard([makeJob({ status: "applied" })]);
    const target = dropZoneFor(STATUS_LABEL.seen);
    stubRect(target, { x: 300, y: 0, width: 300, height: 2000 });

    drag(target);

    // useCorrectStatus's mutationFn calls api.correctStatus asynchronously.
    await waitFor(() =>
      expect(mockedApi.correctStatus).toHaveBeenCalledWith("job-1", "seen", undefined),
    );
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("navigates cards in their sorted DOM order", () => {
    const ordered = sortJobs(
      [
        makeJob({ id: "charlie", title: "Charlie" }),
        makeJob({ id: "alpha", title: "Alpha" }),
        makeJob({ id: "bravo", title: "Bravo" }),
      ],
      "title_az",
    );
    renderBoard(ordered);

    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-card-id]"));
    expect(cards.map((card) => card.dataset.cardId)).toEqual(["alpha", "bravo", "charlie"]);

    cards[0].focus();
    fireEvent.keyDown(cards[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(cards[1]);
    fireEvent.keyDown(cards[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(cards[2]);
    fireEvent.keyDown(cards[2], { key: "ArrowUp" });
    expect(document.activeElement).toBe(cards[1]);
  });
});
