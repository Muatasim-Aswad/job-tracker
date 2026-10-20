import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Changed = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
let changed: Changed;
let stored: Record<string, unknown>;
const requestAccess = vi.fn(async () => true);
const setStorage = vi.fn(async (data: Record<string, unknown>) => {
  Object.assign(stored, data);
});

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_SERVER_URL", "http://localhost:3456");
  stored = {};
  requestAccess.mockReset().mockResolvedValue(true);
  setStorage.mockClear();
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: (_key: string, callback: (data: object) => void) => callback({ ...stored }),
        set: setStorage,
        remove: vi.fn(async (key: string) => {
          delete stored[key];
        }),
      },
      onChanged: {
        addListener: (listener: Changed) => {
          changed = listener;
        },
      },
    },
    permissions: { request: requestAccess },
    runtime: { sendMessage: vi.fn(), lastError: undefined },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("server configuration", () => {
  it("uses the build default until a saved override is loaded, and restores the default", async () => {
    vi.stubEnv("VITE_SERVER_URL", "https://default.example.test");
    const config = await import("./config");
    stored.serverUrl = "https://saved.example.test/";
    await config.initializeServerConfig();
    expect(config.SERVER_URL).toBe("https://saved.example.test");
    const listener = vi.fn();
    config.onServerChanged(listener);
    changed({ serverUrl: { newValue: "https://next.example.test" } }, "local");
    expect(config.API_BASE_URL).toBe("https://next.example.test/api");
    expect(listener).toHaveBeenCalledOnce();
    await config.saveServerUrl(config.DEFAULT_SERVER_URL);
    expect(config.SERVER_URL).toBe("https://default.example.test");
    expect(stored).not.toHaveProperty("serverUrl");
  });

  it.each([
    "file:///tmp",
    "https://user:password@example.test",
    "https://example.test/api",
    "https://example.test?key=secret",
    "not a url",
  ])("rejects invalid server address %s before requesting access", async (url) => {
    const config = await import("./config");
    await expect(config.connectServer(url, true)).rejects.toThrow();
    expect(requestAccess).not.toHaveBeenCalled();
  });

  it("keeps the active server when access is denied or the health response is invalid", async () => {
    const config = await import("./config");
    await config.initializeServerConfig();
    requestAccess.mockResolvedValueOnce(false);
    await expect(config.connectServer("https://next.example.test", true)).rejects.toThrow(
      "not granted",
    );
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}"));
    await expect(config.connectServer("https://next.example.test", true)).rejects.toThrow(
      "health response",
    );
    expect(config.SERVER_URL).toBe(config.DEFAULT_SERVER_URL);
    expect(setStorage).not.toHaveBeenCalled();
  });

  it("tests without switching, then saves only a reachable server", async () => {
    const config = await import("./config");
    await config.initializeServerConfig();
    await config.connectServer("https://next.example.test/", false);
    expect(config.SERVER_URL).toBe(config.DEFAULT_SERVER_URL);
    await config.connectServer("https://next.example.test/", true);
    expect(config.SERVER_URL).toBe("https://next.example.test");
    expect(requestAccess).toHaveBeenCalledWith({
      origins: ["https://next.example.test/*"],
    });
    expect(stored.serverUrl).toBe("https://next.example.test");
  });

  it("discards a bridge response from the previous server", async () => {
    const config = await import("./config");
    const { createBridge } = await import("./engine/bridge");
    await config.initializeServerConfig();
    let reply!: (value: unknown) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
      _message: unknown,
      callback: (value: unknown) => void,
    ) => {
      reply = callback;
    }) as never);
    const { bridge } = createBridge({} as never);
    const pending = bridge({ type: "state-batch", platform: "linkedin", platform_ids: ["1"] });
    changed({ serverUrl: { newValue: "https://next.example.test" } }, "local");
    reply({ ok: true, result: [{ platform_id: "1", status: "applied" }] });
    expect(await pending).toMatchObject({ ok: false });
  });
});
