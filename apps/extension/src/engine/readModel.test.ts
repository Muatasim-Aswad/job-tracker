// Unit tests for the read-model concern in isolation: a fake Engine supplies just
// the cross-concern hooks readModel calls out to (bridge/renderJob/flashError), so
// these exercise emit/autoEmit/refreshStates' own logic — dedup, viewState
// projection, failure handling — without the real bridge or a background worker.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createReadModel } from "./readModel";
import type { Engine } from "./types";
import type { Adapter } from "../adapters/types";
import { setAdapters } from "../registry";
import type { BridgeResponse } from "../messages";

// Only jobIds prefixed "LI-" resolve to a natural key — mirrors a real adapter's
// naturalKey() so the "unregistered id" branch (toNaturalKey → null) is reachable.
const fakeAdapter: Adapter = {
  matches: () => true,
  naturalKey: (jhId) =>
    jhId.startsWith("LI-") ? { platform: "linkedin", platform_id: jhId.slice(3) } : null,
  findCards: () => [],
};

function makeEngine(bridgeImpl?: (msg: unknown) => Promise<BridgeResponse>) {
  const bridge = vi.fn(bridgeImpl ?? (async () => ({ ok: true, result: null }) as BridgeResponse));
  const renderJob = vi.fn();
  const flashError = vi.fn();
  const engine = { bridge, renderJob, flashError } as unknown as Engine;
  const readModel = createReadModel(engine);
  return { engine, bridge, renderJob, flashError, readModel };
}

// A promise plus its resolver, for tests that need to control exactly when a
// bridge call settles (concurrency/dedup assertions).
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  setAdapters([fakeAdapter]);
});

describe("stateOf", () => {
  it("defaults to untracked/unhidden/unstarred for a job with no known state", () => {
    const { readModel } = makeEngine();
    expect(readModel.stateOf("LI-1")).toEqual({
      status: "untracked",
      hidden: false,
      starred: false,
    });
  });
});

describe("emit", () => {
  it("bails without calling bridge for an id no adapter recognizes", async () => {
    const { readModel, bridge } = makeEngine();
    const result = await readModel.emit("unknown-1", "seen");
    expect(result).toBeNull();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("sends the natural key and event, projects the response, and re-renders", async () => {
    const { readModel, bridge, renderJob } = makeEngine(async () => ({
      ok: true,
      result: { status: "seen", hidden: false, starred: false },
    }));

    const result = await readModel.emit("LI-42", "seen");

    expect(bridge).toHaveBeenCalledWith({
      type: "event",
      payload: {
        platform: "linkedin",
        platform_id: "42",
        events: [{ event: "seen", meta: undefined }],
      },
    });
    expect(result).toEqual({ status: "seen", hidden: false, starred: false });
    expect(readModel.stateOf("LI-42")).toEqual({ status: "seen", hidden: false, starred: false });
    expect(renderJob).toHaveBeenCalledWith("LI-42");
  });

  it("rides the explicit ts along when given one", async () => {
    const { readModel, bridge } = makeEngine();
    await readModel.emit("LI-1", "rejected", undefined, { ts: "2026-01-01T00:00:00Z" });
    expect(bridge).toHaveBeenCalledWith({
      type: "event",
      payload: {
        platform: "linkedin",
        platform_id: "1",
        events: [{ event: "rejected", meta: undefined }],
        ts: "2026-01-01T00:00:00Z",
      },
    });
  });

  it("leaves viewState untouched and flashes an error on a failed write", async () => {
    const { readModel, flashError } = makeEngine(async () => ({ ok: false, error: "boom" }));

    const result = await readModel.emit("LI-1", "seen");

    expect(result).toBeNull();
    expect(readModel.stateOf("LI-1").status).toBe("untracked");
    expect(flashError).toHaveBeenCalledWith("LI-1");
  });

  it("stays quiet on a failed silent write", async () => {
    const { readModel, flashError } = makeEngine(async () => ({ ok: false, error: "boom" }));
    await readModel.emit("LI-1", "seen", undefined, { silent: true });
    expect(flashError).not.toHaveBeenCalled();
  });

  it("drops a second emit for the same job while its first write is still in flight", async () => {
    const pending = deferred<BridgeResponse>();
    const { readModel, bridge } = makeEngine(() => pending.promise);

    const first = readModel.emit("LI-1", "seen");
    const second = await readModel.emit("LI-1", "applied"); // dropped — write in flight
    expect(second).toBeNull();
    expect(bridge).toHaveBeenCalledTimes(1);

    pending.resolve({ ok: true, result: { status: "seen", hidden: false, starred: false } });
    await first;

    // The in-flight guard clears once the first write settles.
    await readModel.emit("LI-1", "applied");
    expect(bridge).toHaveBeenCalledTimes(2);
  });
});

describe("autoEmit", () => {
  it("emits only once per job+event for the session", async () => {
    const { readModel, bridge } = makeEngine(async () => ({
      ok: true,
      result: { status: "seen", hidden: false, starred: false },
    }));

    await readModel.autoEmit("LI-1", "seen");
    await readModel.autoEmit("LI-1", "seen");

    expect(bridge).toHaveBeenCalledTimes(1);
    expect(readModel.hasEmitted("LI-1:seen")).toBe(true);
  });

  it("un-marks the dedup key on failure, so a later scan retries", async () => {
    const { readModel, bridge } = makeEngine(async () => ({ ok: false, error: "boom" }));

    await readModel.autoEmit("LI-1", "seen");
    expect(readModel.hasEmitted("LI-1:seen")).toBe(false);

    await readModel.autoEmit("LI-1", "seen");
    expect(bridge).toHaveBeenCalledTimes(2);
  });

  it("never flashes an error banner for a failed auto-emit (silent)", async () => {
    const { readModel, flashError } = makeEngine(async () => ({ ok: false, error: "boom" }));
    await readModel.autoEmit("LI-1", "seen");
    expect(flashError).not.toHaveBeenCalled();
  });
});

describe("refreshStates", () => {
  it("groups requested ids by platform, one bridge call per platform", async () => {
    setAdapters([
      fakeAdapter,
      {
        matches: () => true,
        naturalKey: (jhId) =>
          jhId.startsWith("GM-") ? { platform: "gmail", platform_id: jhId.slice(3) } : null,
        findCards: () => [],
      },
    ]);
    const { readModel, bridge } = makeEngine(async () => ({ ok: true, result: [] }));

    await readModel.refreshStates(["LI-1", "GM-1", "LI-2"]);

    expect(bridge).toHaveBeenCalledTimes(2);
    expect(bridge).toHaveBeenCalledWith({
      type: "state-batch",
      platform: "linkedin",
      platform_ids: ["1", "2"],
    });
    expect(bridge).toHaveBeenCalledWith({
      type: "state-batch",
      platform: "gmail",
      platform_ids: ["1"],
    });
  });

  it("populates viewState from the matched results", async () => {
    const { readModel } = makeEngine(async () => ({
      ok: true,
      result: [{ platform_id: "1", status: "applied", hidden: false, starred: true }],
    }));

    const available = await readModel.refreshStates(["LI-1"]);

    expect(available).toBe(true);
    expect(readModel.stateOf("LI-1")).toEqual({ status: "applied", hidden: false, starred: true });
  });

  it("skips ids already known, unless force is set", async () => {
    const { readModel, bridge } = makeEngine(async () => ({
      ok: true,
      result: [{ platform_id: "1", status: "applied", hidden: false, starred: false }],
    }));

    await readModel.refreshStates(["LI-1"]);
    expect(bridge).toHaveBeenCalledTimes(1);

    await readModel.refreshStates(["LI-1"]); // already known — no network
    expect(bridge).toHaveBeenCalledTimes(1);

    await readModel.refreshStates(["LI-1"], { force: true });
    expect(bridge).toHaveBeenCalledTimes(2);
  });

  it("keeps the last-known state when the batch call fails", async () => {
    const { readModel } = makeEngine(async () => ({ ok: false, error: "boom" }));
    const available = await readModel.refreshStates(["LI-1"]);
    expect(available).toBe(false);
    expect(readModel.stateOf("LI-1")).toEqual({
      status: "untracked",
      hidden: false,
      starred: false,
    });
  });

  it("doesn't double-request an id whose lookup is already in flight", async () => {
    const pending = deferred<BridgeResponse>();
    const { readModel, bridge } = makeEngine(() => pending.promise);

    const first = readModel.refreshStates(["LI-1"]);
    const second = readModel.refreshStates(["LI-1"]); // same id, already in flight
    await Promise.all([
      second,
      (async () => {
        pending.resolve({ ok: true, result: [] });
        await first;
      })(),
    ]);

    expect(bridge).toHaveBeenCalledTimes(1);
  });
});
