// Unit tests for the scan loop's scheduling. A fake Engine and a stub adapter reduce
// a "scan" to a counter, so these assert only WHEN the loop runs. The host page's
// mutation cadence, a route change, and a tab becoming visible each decide whether the
// injections land at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScan } from "./scan";
import type { Engine } from "./types";
import type { Adapter } from "../adapters/types";
import { setAdapters } from "../registry";
import { installFakeChrome } from "../test-support/fakeChrome";

interface ScanOptions {
  // Leave the stored hide mode unresolved to isolate the mutation-driven path from
  // the first pass the boot ladder would otherwise run.
  hideModeResolves?: boolean;
  activeOn?: (path: string) => boolean;
  onKeyDown?: (event: KeyboardEvent) => void;
  renderPageActions?: (statesAvailable?: boolean) => void;
}

// A scan calls the adapter's hooks, so scanDetail counts passes. findCards returns
// nothing: card processing is exercised separately, and an empty list keeps the
// engine stubs trivial.
function makeScan({
  hideModeResolves = true,
  activeOn,
  onKeyDown,
  renderPageActions,
}: ScanOptions = {}) {
  const scans = vi.fn();
  const adapter: Adapter = {
    matches: () => true,
    naturalKey: (jhId) => ({ platform: "linkedin", platform_id: jhId }),
    findCards: () => [],
    scanDetail: scans,
    ...(activeOn ? { activeOn } : {}),
    ...(onKeyDown ? { onKeyDown } : {}),
    ...(renderPageActions ? { renderPageActions } : {}),
  };
  setAdapters([adapter]);
  const engine = {
    // The first pass waits on the stored hide mode; a test that wants only the
    // mutation-driven path leaves that callback pending.
    loadHideMode: (cb?: () => void) => {
      if (hideModeResolves) cb?.();
    },
    renderAll: vi.fn(),
    refreshStates: vi.fn(async () => true),
    stateOf: () => ({ status: "untracked", hidden: false, starred: false }),
    invalidateStates: vi.fn(),
    setOffline: vi.fn(),
    syncBlocklist: vi.fn(async () => {}),
    bridge: vi.fn(async () => ({ ok: false, error: "no server" })),
    captureCardFromAction: vi.fn(),
    injectButtons: vi.fn(),
    flagCard: vi.fn(),
    autoEmit: vi.fn(async () => {}),
  } as unknown as Engine;
  return { scans, engine, scan: createScan(engine) };
}

// MutationObserver records are delivered on the microtask queue, which vitest's fake
// timers leave alone — one turn is enough to reach the callback.
async function mutate() {
  document.body.appendChild(document.createElement("div"));
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  installFakeChrome();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scan scheduling", () => {
  // A hidden tab clamps timers to ~1s, the same cadence the host page renders on. If
  // each mutation only cleared the pending scan, the settle delay would never elapse
  // and the page would get its bars only after a manual reload.
  it("still scans while mutations keep arriving faster than the settle delay", async () => {
    const { scans, scan } = makeScan({ hideModeResolves: false });
    scan.start();

    for (let i = 0; i < 12; i++) {
      await mutate();
      vi.advanceTimersByTime(150); // never a quiet stretch long enough to settle
    }

    expect(scans).toHaveBeenCalled();
  });

  it("keeps scanning as a route change renders in stages", async () => {
    const { scans, scan } = makeScan();
    scan.start();
    vi.advanceTimersByTime(10_000); // the first document's own ladder
    scans.mockClear();

    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.advanceTimersByTime(10_000);

    // The pane can finish long after the URL changed, so one timed guess is not enough.
    expect(scans.mock.calls.length).toBeGreaterThan(1);
  });

  // A job opened in a background tab renders and goes quiet before it is looked at,
  // leaving no mutation to ride.
  it("scans when the tab becomes visible", () => {
    const { scans, scan } = makeScan();
    scan.start();
    vi.advanceTimersByTime(10_000);
    scans.mockClear();

    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(10_000);

    expect(scans).toHaveBeenCalled();
  });

  // More passes must not mean work off the adapter's own surfaces.
  it("stays idle on a surface the adapter does not target", () => {
    const { scans, scan } = makeScan({ activeOn: (path) => path.startsWith("/jobs") });
    scan.start();
    vi.advanceTimersByTime(10_000);

    expect(scans).not.toHaveBeenCalled();
  });

  it("forwards page keydowns to the active host adapter", () => {
    const onKeyDown = vi.fn();
    const { scan } = makeScan({ onKeyDown });
    scan.start();
    const event = new KeyboardEvent("keydown", { key: "h", altKey: true });

    window.dispatchEvent(event);

    expect(onKeyDown).toHaveBeenCalledWith(event);
  });

  it("reports when all card states are available", async () => {
    const renderPageActions = vi.fn();
    const { scan } = makeScan({ renderPageActions });
    scan.start();

    vi.advanceTimersByTime(10_000);
    await Promise.resolve();

    expect(renderPageActions).toHaveBeenCalledWith(true);
  });
});

describe("card processing", () => {
  // Keyword rules arrive from storage after the first cards are on screen, and can be
  // edited at any time, so they are re-applied to every tagged card — not only to the
  // ones a pass has just discovered.
  it("re-applies keyword rules to cards tagged by an earlier pass", () => {
    const { engine, scan } = makeScan();
    document.body.innerHTML = `<div data-jh-id="LI-1" data-job-title="Backend Engineer"></div>`;
    scan.start();
    vi.advanceTimersByTime(10_000);

    expect(engine.flagCard).toHaveBeenCalledWith(document.querySelector("[data-jh-id]"));
  });
});
