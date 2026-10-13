// Isolate duplicate lookup ordering; without a detail bar, rendering is a no-op.
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

  // A scored refresh must supersede an older in-flight unscored lookup.
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

describe("match popover", () => {
  it("shows a reworded title, timing, and each candidate's evidence", async () => {
    document.body.innerHTML = `<div class="jh-detail-actions" data-jh-job-id="LI-1"></div>`;
    const candidate: JobMatch = {
      ...match("job-1", 0.82),
      title: "Backend Engineer II",
      closed_at: "2026-07-10T00:00:00Z",
      insights: {
        apply_url: { is_same: true },
        company_url: { is_same: true },
        location: { is_same: false, current: "Amsterdam", candidate: "Utrecht" },
      },
      timing: { overlapping: false, gap_days: 14 },
    };
    const { matches } = makeMatches(async () => ({ ok: true, result: [candidate] }));
    await matches.checkMatches("LI-1", "Backend Engineer", "Example Labs");

    (document.querySelector(".jh-btn-match") as HTMLElement).click();

    const pop = document.querySelector(".jh-match-popover")!;
    expect(pop.querySelector(".jh-match-pct")?.textContent).toBe("82%");
    expect(pop.querySelector(".jh-match-title")?.textContent).toBe("Backend Engineer II");
    expect(pop.querySelector(".jh-match-sub")?.textContent).toContain(
      "reposted 14 days after it closed",
    );
    expect(pop.querySelector(".jh-match-same")?.textContent).toBe(
      "✓ Same Apply link · Company page",
    );
    expect(pop.querySelector(".jh-match-diff")?.textContent).toBe(
      "✗ Location: Amsterdam vs Utrecht",
    );
  });

  it("omits the title when it matches the posting on screen", async () => {
    document.body.innerHTML = `<div class="jh-detail-actions" data-jh-job-id="LI-1"></div>`;
    const { matches } = makeMatches(async () => ({ ok: true, result: [match("job-1", null)] }));
    await matches.checkMatches("LI-1", "Backend  engineer", "Example Labs");

    (document.querySelector(".jh-btn-match") as HTMLElement).click();

    expect(document.querySelector(".jh-match-title")).toBeNull();
    expect(document.querySelector(".jh-match-evidence")).toBeNull();
  });
});
