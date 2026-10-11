import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  route: vi.fn(),
  network: vi.fn(),
  precache: vi.fn(),
  match: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock("workbox-routing", () => ({ registerRoute: mocks.route }));
vi.mock("workbox-precaching", () => ({
  precacheAndRoute: mocks.precache,
  matchPrecache: mocks.match,
  cleanupOutdatedCaches: mocks.cleanup,
}));
vi.mock("workbox-strategies", () => ({
  NetworkOnly: class {
    constructor(options: unknown) {
      mocks.network(options);
    }
  },
}));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("self", {
    location: { origin: "http://localhost:3456" },
    __WB_MANIFEST: ["index.html", "assets/app.js"],
  });
  await import("./sw");
});
afterEach(() => vi.unstubAllGlobals());

describe("PWA caching boundary", () => {
  it("fetches entry documents from the network and leaves API and external requests alone", () => {
    const match = mocks.route.mock.calls[0][0];
    expect(match({ url: new URL("http://localhost:3456/?question=opaque") })).toBe(true);
    expect(match({ url: new URL("http://localhost:3456/index.html") })).toBe(true);
    for (const path of [
      "/api/jobs",
      "/api/form-fill/answers",
      "/api/form-fill/questions",
      "/api/form-fill/captures",
      "/docs",
      "/openapi.json",
    ]) {
      expect(match({ url: new URL(path, "http://localhost:3456") })).toBe(false);
    }
    expect(match({ url: new URL("https://example.com/") })).toBe(false);
    expect(mocks.route.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.precache.mock.invocationCallOrder[0],
    );
  });

  it("falls back to the canonical shell without storing a navigation URL", async () => {
    const shell = new Response("App shell");
    mocks.match.mockResolvedValue(shell);
    const fallback = mocks.network.mock.calls[0][0].plugins[0].handlerDidError;
    expect(await fallback()).toBe(shell);
    expect(mocks.match).toHaveBeenCalledWith("/index.html");
    expect(mocks.precache).toHaveBeenCalledWith(["index.html", "assets/app.js"], {
      ignoreURLParametersMatching: [],
    });
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });
});
