import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreferencesStore } from "./preferences-store";
import { preferencesFixture } from "./test-support/preferences";

beforeEach(() => {
  vi.stubGlobal("chrome", {
    get storage() {
      throw new Error("Shared settings must not read browser storage");
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

describe("server settings", () => {
  it("loads backend settings without reading or importing browser settings", async () => {
    const state = preferencesFixture();
    const fetchApi = vi.fn(async () => json(state));
    const publish = vi.fn();
    const store = createPreferencesStore(fetchApi, publish);
    expect(await store.get()).toEqual(state);
    expect(fetchApi).toHaveBeenCalledExactlyOnceWith(
      "/settings",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(publish).toHaveBeenCalledExactlyOnceWith(state);
    expect(await store.get()).toEqual(state);
    expect(fetchApi).toHaveBeenCalledTimes(1);
  });

  it("deduplicates simultaneous reads and publishes changes only once", async () => {
    const fetchApi = vi.fn(async () => json(preferencesFixture()));
    const publish = vi.fn();
    const store = createPreferencesStore(fetchApi, publish);
    await Promise.all([store.get(), store.get()]);
    expect(fetchApi).toHaveBeenCalledTimes(1);
    await store.get(true);
    expect(fetchApi).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("retries failed reads without caching a fabricated default", async () => {
    const fetchApi = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(json(preferencesFixture()));
    const publish = vi.fn();
    const store = createPreferencesStore(fetchApi, publish);
    await expect(store.get()).rejects.toThrow("offline");
    expect(publish).not.toHaveBeenCalled();
    expect(await store.get()).toEqual(preferencesFixture());
  });

  it("discards responses after a server switch", async () => {
    let release!: (response: Response) => void;
    const fetchApi = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const publish = vi.fn();
    const store = createPreferencesStore(fetchApi, publish);
    const request = store.get();
    store.reset();
    release(json(preferencesFixture()));
    await expect(request).rejects.toThrow("Server changed");
    expect(publish).not.toHaveBeenCalled();
  });

  it("retains the current snapshot on rejected saves and surfaces revision conflicts", async () => {
    const fetchApi = vi
      .fn()
      .mockResolvedValueOnce(json(preferencesFixture()))
      .mockResolvedValueOnce(json({}, 409));
    const publish = vi.fn();
    const store = createPreferencesStore(fetchApi, publish);
    const state = await store.get();
    await expect(store.update({ hide_mode: "dim" }, state.revision)).rejects.toThrow(
      "changed elsewhere",
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await store.get()).toEqual(state);
  });
});
