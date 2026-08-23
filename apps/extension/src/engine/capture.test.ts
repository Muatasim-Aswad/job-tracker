// Unit tests for the capture concern's follow-up work. A fake Engine supplies the
// hooks capture calls out to, so these exercise when a captured listing is sent and
// what it triggers, without a background worker.
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
  const engine = {
    bridge,
    refreshMatches,
    isCompanyBlocked: () => false,
    stateOf: () => ({ status: "untracked", hidden: false, starred: false }),
    hasEmitted: () => false,
    markEmitted: vi.fn(),
    unmarkEmitted: vi.fn(),
  } as unknown as Engine;
  return { bridge, refreshMatches, capture: createCapture(engine) };
}

beforeEach(() => {
  setAdapters([fakeAdapter]);
});

describe("captureListingOnce", () => {
  it("skips a pane whose description has not rendered yet", () => {
    const { bridge, capture } = makeCapture();
    capture.captureListingOnce("LI-1", () => record({ meta: {} }));
    expect(bridge).not.toHaveBeenCalled();
  });

  // The duplicate check runs before the JD exists server-side, so its rows can only
  // say "no description captured yet" until the capture lands and it re-asks.
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
