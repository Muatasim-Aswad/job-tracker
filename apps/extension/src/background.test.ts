import { afterEach, describe, expect, it, vi } from "vitest";

interface NavigationListener {
  callback: (details: { tabId: number; frameId: number }) => Promise<void>;
  filter: chrome.webNavigation.WebNavigationEventFilter;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("content-script navigation recovery", () => {
  it("reinjects the Easy Apply entry in top documents and application frames", async () => {
    const committed: NavigationListener[] = [];
    const historyUpdated: NavigationListener[] = [];
    const executeScript = vi.fn(async () => []);
    const addNavigationListener = (target: NavigationListener[]) =>
      vi.fn(
        (
          callback: NavigationListener["callback"],
          filter: chrome.webNavigation.WebNavigationEventFilter,
        ) => target.push({ callback, filter }),
      );
    const contentScripts = [
      {
        matches: ["https://www.linkedin.com/*", "https://mail.google.com/*"],
        js: ["top-content.js"],
      },
      {
        matches: ["https://www.linkedin.com/*"],
        js: ["easy-apply-content.js"],
        all_frames: true,
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    vi.stubGlobal("chrome", {
      action: {
        setBadgeText: vi.fn(async () => {}),
        setBadgeBackgroundColor: vi.fn(async () => {}),
        setTitle: vi.fn(async () => {}),
      },
      alarms: {
        create: vi.fn(async () => {}),
        onAlarm: { addListener: vi.fn() },
      },
      runtime: {
        getManifest: () => ({ content_scripts: contentScripts }),
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(async () => {}),
        lastError: undefined,
      },
      scripting: { executeScript },
      tabs: { query: vi.fn() },
      webNavigation: {
        onCommitted: { addListener: addNavigationListener(committed) },
        onHistoryStateUpdated: { addListener: addNavigationListener(historyUpdated) },
      },
    });

    await import("./background");

    expect(committed).toHaveLength(2);
    expect(historyUpdated).toHaveLength(2);
    expect(committed.map((entry) => entry.filter.url)).toEqual([
      [{ hostEquals: "www.linkedin.com" }, { hostEquals: "mail.google.com" }],
      [{ hostEquals: "www.linkedin.com" }],
    ]);

    await Promise.all(committed.map((entry) => entry.callback({ tabId: 9, frameId: 0 })));
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 9, frameIds: [0] },
      files: ["top-content.js"],
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 9, frameIds: [0] },
      files: ["easy-apply-content.js"],
    });

    executeScript.mockClear();
    await Promise.all(committed.map((entry) => entry.callback({ tabId: 9, frameId: 3 })));
    expect(executeScript).toHaveBeenCalledOnce();
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 9, frameIds: [3] },
      files: ["easy-apply-content.js"],
    });
  });
});
