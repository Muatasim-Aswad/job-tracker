import { afterEach, describe, expect, it, vi } from "vitest";

interface NavigationListener {
  callback: (details: { tabId: number; frameId: number }) => Promise<void>;
  filter: chrome.webNavigation.WebNavigationEventFilter;
}

type RuntimeListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean;

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
      tabs: { query: vi.fn(), onRemoved: { addListener: vi.fn() } },
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

describe("Gmail alert tab opening", () => {
  it("opens only canonical jobs and closes only their recorded tabs", async () => {
    let onMessage!: RuntimeListener;
    let onRemoved!: (tabId: number) => void;
    let storedIds: number[] = [];
    const create = vi
      .fn<() => Promise<chrome.tabs.Tab>>()
      .mockResolvedValueOnce({ id: 21 } as chrome.tabs.Tab)
      .mockResolvedValueOnce({ id: 23 } as chrome.tabs.Tab);
    const remove = vi.fn(async () => {});
    const query = vi.fn(async () => [
      {
        id: 11,
        url: "https://www.linkedin.com/jobs/view/200001/?tracking=existing",
      } as chrome.tabs.Tab,
      {
        id: 12,
        url: "https://www.linkedin.com/jobs/view/existing-role-200004/",
      } as chrome.tabs.Tab,
    ]);
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
        getManifest: () => ({ content_scripts: [] }),
        onMessage: { addListener: vi.fn((listener: RuntimeListener) => (onMessage = listener)) },
        sendMessage: vi.fn(async () => {}),
        lastError: undefined,
      },
      scripting: { executeScript: vi.fn() },
      storage: {
        session: {
          get: vi.fn(async () => ({ bulkJobTabIds: [...storedIds] })),
          set: vi.fn(async ({ bulkJobTabIds }: { bulkJobTabIds: number[] }) => {
            storedIds = [...bulkJobTabIds];
          }),
        },
      },
      tabs: {
        create,
        remove,
        query,
        onRemoved: {
          addListener: vi.fn((listener: (tabId: number) => void) => (onRemoved = listener)),
        },
      },
      webNavigation: {
        onCommitted: { addListener: vi.fn() },
        onHistoryStateUpdated: { addListener: vi.fn() },
      },
    });
    await import("./background");
    const sendResponse = vi.fn();

    expect(
      onMessage(
        {
          type: "open-job-tabs",
          urls: [
            "https://www.linkedin.com/jobs/view/200001/",
            "https://www.linkedin.com/jobs/view/200001/",
            "https://example.com/jobs/view/200002/",
            "javascript:alert(1)",
            "https://www.linkedin.com/jobs/view/200003/",
            "https://www.linkedin.com/jobs/view/200004/",
            "https://www.linkedin.com/jobs/view/200005/",
          ],
        },
        {} as chrome.runtime.MessageSender,
        sendResponse,
      ),
    ).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: null }));
    expect(query).toHaveBeenCalledWith({
      url: ["https://www.linkedin.com/jobs/view/*", "https://www.linkedin.com/comm/jobs/view/*"],
    });
    expect(create.mock.calls).toEqual([
      [{ url: "https://www.linkedin.com/jobs/view/200003/", active: false }],
      [{ url: "https://www.linkedin.com/jobs/view/200005/", active: false }],
    ]);
    expect(storedIds).toEqual([21, 23]);

    const closeResponse = vi.fn();
    expect(
      onMessage(
        { type: "close-bulk-job-tab" },
        { tab: { id: 21 } } as chrome.runtime.MessageSender,
        closeResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(closeResponse).toHaveBeenCalledWith({ ok: true, result: null }));
    expect(remove).toHaveBeenCalledWith(21);
    expect(storedIds).toEqual([23]);

    const manualResponse = vi.fn();
    onMessage(
      { type: "close-bulk-job-tab" },
      { tab: { id: 11 } } as chrome.runtime.MessageSender,
      manualResponse,
    );
    await vi.waitFor(() => expect(manualResponse).toHaveBeenCalledWith({ ok: true, result: null }));
    expect(remove).toHaveBeenCalledOnce();

    onRemoved(23);
    await vi.waitFor(() => expect(storedIds).toEqual([]));
  });
});
