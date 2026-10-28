// Isolate capture follow-up hooks with a fake Engine.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCapture } from "./capture";
import type { Engine } from "./types";
import type { Adapter } from "../adapters/types";
import type { ListingRecord } from "../messages";
import { setAdapters } from "../registry";
import type { BridgeResponse } from "../messages";

const fakeAdapter: Adapter = {
  matches: () => true,
  naturalKey: (jhId) =>
    jhId.startsWith("LI-") ? { platform: "linkedin", platform_id: jhId.slice(3) } : null,
  findCards: () => [],
};

const record = (over: Partial<ListingRecord> = {}): ListingRecord => ({
  platform: "linkedin",
  platform_id: "1",
  url: "https://www.linkedin.com/jobs/view/1/",
  title: "Backend Engineer",
  company: "Example Labs",
  meta: { description: "We build developer tools." },
  ...over,
});

function makeCapture(bridgeImpl?: (msg: unknown) => Promise<BridgeResponse>) {
  const bridge = vi.fn(bridgeImpl ?? (async () => ({ ok: true, result: null }) as BridgeResponse));
  const refreshMatches = vi.fn(async () => {});
  const refreshStates = vi.fn(async () => true);
  const renderJob = vi.fn();
  const engine = {
    bridge,
    refreshMatches,
    refreshStates,
    renderJob,
    isCompanyBlocked: () => false,
    isCardBlocked: () => false,
    stateOf: () => ({ status: "untracked", hidden: false, starred: false }),
    hasEmitted: () => false,
    markEmitted: vi.fn(),
    unmarkEmitted: vi.fn(),
  } as unknown as Engine;
  return { bridge, refreshMatches, refreshStates, renderJob, capture: createCapture(engine) };
}

beforeEach(() => {
  setAdapters([fakeAdapter]);
});

describe("captureListingOnce", () => {
  it.each([undefined, "", "   ", 42])(
    "skips an incomplete detail description %s",
    (description) => {
      const { bridge, capture } = makeCapture();
      capture.captureListingOnce("LI-1", () => record({ meta: { description } }));
      expect(bridge).not.toHaveBeenCalled();
    },
  );

  it("marks a complete detail capture explicitly without supplying a timestamp", () => {
    const { bridge, capture } = makeCapture();
    capture.captureListingOnce("LI-1", () => record());
    expect(bridge).toHaveBeenCalledWith({
      type: "listing",
      payload: { ...record(), capture_kind: "detail" },
    });
  });

  // Refresh duplicate evidence after the description capture lands.
  it("re-asks for duplicates once the captured JD has landed", async () => {
    const { refreshMatches, capture } = makeCapture();
    capture.captureListingOnce("LI-1", () => record());
    await vi.waitFor(() => expect(refreshMatches).toHaveBeenCalledWith("LI-1"));
  });

  it("does not re-ask when the capture itself failed", async () => {
    const { bridge, refreshMatches, capture } = makeCapture(async () => ({
      ok: false,
      error: "offline",
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    capture.captureListingOnce("LI-1", () => record());
    await vi.waitFor(() => expect(bridge).toHaveBeenCalled());
    expect(refreshMatches).not.toHaveBeenCalled();
  });
});

describe("captureCards", () => {
  it("upserts card identity without emitting seen and refreshes the landed state", async () => {
    const { bridge, refreshStates, renderJob, capture } = makeCapture();
    const card = document.createElement("div");
    card.dataset.jhId = "LI-1";
    card.dataset.jobUrl = "https://www.linkedin.com/jobs/view/1/";
    card.dataset.jobTitle = "Backend Engineer";
    card.dataset.jobCompany = "Example Labs";
    card.dataset.jobMeta = JSON.stringify({
      location: "Amsterdam",
      salary: "Scale 11: € 6.066 - € 8.666 pm",
    });

    capture.captureCards([card]);

    await vi.waitFor(() => expect(refreshStates).toHaveBeenCalled());
    expect(bridge).toHaveBeenCalledOnce();
    expect(bridge).toHaveBeenCalledWith({
      type: "listing",
      payload: {
        platform: "linkedin",
        platform_id: "1",
        capture_kind: "partial",
        url: "https://www.linkedin.com/jobs/view/1/",
        title: "Backend Engineer",
        company: "Example Labs",
        meta_patch: {
          location: "Amsterdam",
          salary: "Scale 11: € 6.066 - € 8.666 pm",
        },
      },
    });
    expect(refreshStates).toHaveBeenCalledWith(["LI-1"], { force: true });
    expect(renderJob).toHaveBeenCalledWith("LI-1");
  });
});

describe("markListingClosed", () => {
  it("asks the worker to close a bulk-opened tab only after the closure lands", async () => {
    const { bridge, capture } = makeCapture();

    await capture.markListingClosed("LI-1");

    expect(bridge.mock.calls.map(([message]) => message)).toEqual([
      {
        type: "listing",
        payload: {
          platform: "linkedin",
          platform_id: "1",
          capture_kind: "partial",
          closed_at: expect.any(String),
        },
      },
      { type: "close-bulk-job-tab" },
    ]);
  });

  it("keeps the tab open when saving the closure fails", async () => {
    const { bridge, capture } = makeCapture(async () => ({ ok: false, error: "offline" }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(capture.markListingClosed("LI-1")).rejects.toThrow("offline");

    expect(bridge).toHaveBeenCalledOnce();
    expect(bridge).not.toHaveBeenCalledWith({ type: "close-bulk-job-tab" });
  });
});

describe("availability recapture", () => {
  it("captures repeated availability changes without duplicating identical observations", async () => {
    const { bridge, capture } = makeCapture();
    const observe = (availability: "open" | "unavailable") =>
      capture.captureListingOnce("LI-1", () => record({ availability }));
    observe("unavailable");
    observe("unavailable");
    observe("open");
    observe("unavailable");
    await vi.waitFor(() => expect(bridge).toHaveBeenCalledTimes(3));
  });

  it("retries a failed availability update", async () => {
    const { bridge, capture } = makeCapture(async () => ({ ok: false, error: "offline" }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const observe = () =>
      capture.captureListingOnce("LI-1", () => record({ availability: "unavailable" }));
    observe();
    await vi.waitFor(() => expect(bridge).toHaveResolved());
    observe();
    expect(bridge).toHaveBeenCalledTimes(2);
  });
});
