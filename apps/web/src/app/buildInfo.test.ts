import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubStorage } from "../test/storage";
import {
  BUILD_CHECK_TIMEOUT_MS,
  fetchCurrentBuild,
  parseBuildInfo,
  sameBuild,
  type BuildInfo,
} from "./buildInfo";

const release: BuildInfo = {
  version: "1.2.0",
  revision: "a".repeat(40),
  commit_time: "2026-10-13T09:00:00Z",
  build_time: "1980-01-01T00:00:00Z",
  dev: false,
};
beforeEach(stubStorage);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public build check", () => {
  it("requests only the fixed endpoint without caches or credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(release)));
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchCurrentBuild(new AbortController().signal)).toEqual(release);
    expect(fetcher).toHaveBeenCalledWith(
      "/version.json",
      expect.objectContaining({
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      }),
    );
  });
  it.each([
    { ...release, revision: "private value" },
    { ...release, dev: true },
    { ...release, commit_time: null },
    { ...release, build_time: "2026-02-30T00:00:00Z" },
    { ...release, extra: "private value" },
    { ...release, version: "private value" },
    null,
  ])("rejects invalid or non-public identities", (info) => {
    expect(() => parseBuildInfo(info)).toThrow("Invalid build identity");
  });
  it("accepts truthful dev identity and compares every public identity field", () => {
    expect(parseBuildInfo({ ...release, revision: "dev", dev: true, commit_time: null }).dev).toBe(
      true,
    );
    expect(sameBuild(release, { ...release })).toBe(true);
    for (const different of [
      { ...release, revision: "b".repeat(40) },
      { ...release, version: "1.2.1" },
      { ...release, build_time: "2026-10-13T09:00:00Z" },
      { ...release, commit_time: "2026-10-12T09:00:00Z" },
      { ...release, dev: true },
    ])
      expect(sameBuild(release, different)).toBe(false);
  });
  it.each([503, 404])("fails on HTTP %s without displaying the response", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private error body", { status })),
    );
    await expect(fetchCurrentBuild(new AbortController().signal)).rejects.toThrow(
      "Build check failed",
    );
  });
  it("fails on malformed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>SPA fallback</html>")));
    await expect(fetchCurrentBuild(new AbortController().signal)).rejects.toThrow();
  });
  it.each(["fetch", "body"])("bounds a stalled %s even if abort is ignored", async (step) => {
    vi.useFakeTimers();
    const never = new Promise(() => {});
    const fetcher = vi
      .fn()
      .mockReturnValue(step === "fetch" ? never : Promise.resolve({ ok: true, json: () => never }));
    vi.stubGlobal("fetch", fetcher);
    const checked = expect(fetchCurrentBuild(new AbortController().signal)).rejects.toThrow(
      "Build check stopped",
    );
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_TIMEOUT_MS);
    await checked;
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("cancels an unmounted request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const controller = new AbortController();
    const checked = expect(fetchCurrentBuild(controller.signal)).rejects.toThrow(
      "Build check stopped",
    );
    controller.abort();
    await checked;
  });
  it("notifies once per verified revision across sessions, retaining only revisions", async () => {
    vi.resetModules();
    const first = await import("./buildInfo");
    expect(first.shouldNotifyBuild(release)).toBe(true);
    expect(first.shouldNotifyBuild(release)).toBe(false);
    expect(first.shouldNotifyBuild({ ...release, revision: "b".repeat(40) })).toBe(true);
    vi.resetModules();
    const next = await import("./buildInfo");
    expect(next.shouldNotifyBuild(release)).toBe(false);
    expect(JSON.parse(localStorage.getItem("jt.buildNotices.v1")!)).toEqual([
      "a".repeat(40),
      "b".repeat(40),
    ]);
    expect(localStorage.length).toBe(1);
  });
  it("ignores dev notices and survives corrupt or blocked storage", async () => {
    vi.resetModules();
    const { shouldNotifyBuild } = await import("./buildInfo");
    expect(shouldNotifyBuild({ ...release, revision: "dev", dev: true, commit_time: null })).toBe(
      false,
    );
    localStorage.setItem("jt.buildNotices.v1", "not json");
    expect(shouldNotifyBuild({ ...release, revision: "c".repeat(40) })).toBe(true);
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(shouldNotifyBuild({ ...release, revision: "d".repeat(40) })).toBe(true);
    expect(shouldNotifyBuild({ ...release, revision: "d".repeat(40) })).toBe(false);
  });
});
