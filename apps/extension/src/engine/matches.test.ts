// Unit tests for the duplicate-suggestion concern's server round-trips. A fake
// Engine supplies only `bridge`; with no detail bar in the document the render path
// is a no-op, leaving these focused on which query wins and when one is issued.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMatches } from "./matches";
import type { JobMatch } from "@job-tracker/shared/api";
import type { Engine } from "./types";
import type { Adapter } from "../adapters/types";
import { setAdapters } from "../registry";
import { installCssEscape } from "../test-support/cssEscape";
import type { BridgeResponse } from "../messages";

const fakeAdapter: Adapter = {
  matches: () => true,
  naturalKey: (jhId) =>
    jhId.startsWith("LI-") ? { platform: "linkedin", platform_id: jhId.slice(3) } : null,
  findCards: () => [],
};

const match = (job_id: string, similarity: number | null): JobMatch => ({
  job_id,
  status: "seen",
  title: "Backend Engineer",
  company: "Example Labs",
  listing_count: 1,
  created_at: "2026-07-01T00:00:00Z",
  closed_at: null,
  similarity,
  insights: {},
  timing: null,
});

function makeMatches(bridgeImpl?: (msg: unknown) => Promise<BridgeResponse>) {
  const bridge = vi.fn(bridgeImpl ?? (async () => ({ ok: true, result: [] }) as BridgeResponse));
  // Only the badge path can reach the DOM here; it builds its button through the
  // engine, so a minimal real element keeps that path honest.
  const mkBtn = (cls: string) => {
    const btn = document.createElement("button");
    btn.className = "jh-btn " + cls;
    return btn;
  };
  const engine = { bridge, mkBtn } as unknown as Engine;
  return { bridge, matches: createMatches(engine) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  setAdapters([fakeAdapter]);
  document.body.innerHTML = "";
  installCssEscape();
});

describe("checkMatches", () => {
  it("queries once per job and caches the answer", async () => {
    const { bridge, matches } = makeMatches();
    await matches.checkMatches("LI-1", "Backend Engineer", "Example Labs");
    await matches.checkMatches("LI-1", "Backend Engineer", "Example Labs");
    expect(bridge).toHaveBeenCalledTimes(1);
  });

  it("leaves a failed query uncached so a later scan retries", async () => {
    const { bridge, matches } = makeMatches(async () => ({ ok: false, error: "offline" }));
    await matches.checkMatches("LI-1", "Backend Engineer", "Example Labs");
    await matches.checkMatches("LI-1", "Backend Engineer", "Example Labs");
    expect(bridge).toHaveBeenCalledTimes(2);
  });
});

describe("refreshMatches", () => {
  it("does nothing for a job no check has run for", async () => {
    const { bridge, matches } = makeMatches();
    await matches.refreshMatches("LI-1");
    expect(bridge).not.toHaveBeenCalled();
  });

  it("re-queries a checked job, so a JD captured after the check gets scored", async () => {
    const responses = [
      { ok: true, result: [match("job-1", null)] } as BridgeResponse,
      { ok: true, result: [match("job-1", 0.82)] } as BridgeResponse,
    ];
    const { bridge, matches } = makeMatches(async () => responses.shift()!);

    await matches.checkMatches("LI-1", "Backend Engineer", "Example Labs");
    await matches.refreshMatches("LI-1");

    expect(bridge).toHaveBeenCalledTimes(2);
  });

  // The capture that triggers the refresh lands while the first check is still in
  // flight, so the unscored answer can arrive last. Ordering by issue time, not by
  // arrival, is what keeps the popover from falling back to "no description yet".
  it("keeps the newest query's answer when an earlier one resolves after it", async () => {
    document.body.innerHTML = `<div class="jh-detail-actions" data-jh-job-id="LI-1"></div>`;
    const first = deferred<BridgeResponse>();
    const second = deferred<BridgeResponse>();
    const pending = [first.promise, second.promise];
    const { matches } = makeMatches(() => pending.shift()!);

    const checking = matches.checkMatches("LI-1", "Backend Engineer", "Example Labs");
    const refreshing = matches.refreshMatches("LI-1");

    second.resolve({ ok: true, result: [match("job-2", 0.82)] });
    await refreshing;
    first.resolve({ ok: true, result: [match("job-2", null), match("job-3", null)] });
    await checking;

    // The badge counts whatever set is cached, so its label is the observable answer.
    const badge = document.querySelector(".jh-btn-match") as HTMLElement;
    expect(badge.dataset.jhCount).toBe("1");
  });
});
