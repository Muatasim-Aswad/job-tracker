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
      storage: {
        local: { get: (_key: string, cb: (data: object) => void) => cb({}) },
        onChanged: { addListener: vi.fn() },
      },
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

async function setupBulkTabs() {
  let storageChanged!: (changes: Record<string, { newValue: unknown }>, area: string) => void;
  let onMessage!: RuntimeListener;
  let onRemoved!: (tabId: number) => void;
  let storedIds: number[] = [];
  let nextId = 21;
  const liveTabs: chrome.tabs.Tab[] = [
    {
      id: 11,
      url: "https://www.linkedin.com/jobs/view/200001/?tracking=existing",
    } as chrome.tabs.Tab,
    {
      id: 12,
      url: "https://www.linkedin.com/jobs/view/existing-role-200004/",
    } as chrome.tabs.Tab,
  ];
  const query = vi.fn(async () => [...liveTabs]);
  const create = vi.fn(async ({ url }: { url: string }) => {
    const tab = { id: nextId, url } as chrome.tabs.Tab;
    nextId += 2;
    liveTabs.push(tab);
    return tab;
  });
  const remove = vi.fn(async (id: number) => {
    const index = liveTabs.findIndex((tab) => tab.id === id);
    if (index >= 0) liveTabs.splice(index, 1);
    onRemoved(id);
  });
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
      local: { get: (_key: string, cb: (data: object) => void) => cb({}) },
      onChanged: {
        addListener: (listener: typeof storageChanged) => {
          storageChanged = listener;
        },
      },
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
  const send = (message: unknown, tabId?: number) =>
    new Promise<unknown>((resolve) => {
      onMessage(message, { tab: { id: tabId } } as chrome.runtime.MessageSender, resolve);
    });
  return {
    onMessage,
    onRemoved,
    create,
    remove,
    query,
    send,
    ids: () => storedIds,
    changeServer: (url: string) => storageChanged({ serverUrl: { newValue: url } }, "local"),
  };
}

it("routes scoped requests to the saved server and rejects old default-server writes", async () => {
  const { send, changeServer } = await setupBulkTabs();
  const config = await import("./config");
  await config.initializeServerConfig();
  const fetchRequest = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("[]"),
  );
  vi.stubGlobal("fetch", fetchRequest);
  changeServer("https://other.example.test");
  fetchRequest.mockClear();
  const stale = await send({
    type: "listing",
    payload: { platform: "linkedin", platform_id: "1" },
  });
  expect(stale).toMatchObject({ ok: false, error: "Server changed; retry this action." });
  const response = await send({
    type: "state-batch",
    serverUrl: "https://other.example.test",
    platform: "linkedin",
    platform_ids: ["1"],
  });
  expect(response).toEqual({ ok: true, result: [] });
  expect(fetchRequest.mock.calls.map(([url]) => url)).not.toContain(
    `${config.DEFAULT_SERVER_URL}/api/listings`,
  );
  expect(fetchRequest).toHaveBeenCalledWith(
    "https://other.example.test/api/jobs/states?platform=linkedin&platform_ids=1",
    undefined,
  );
});

describe("Gmail alert tab opening", () => {
  it("opens only canonical jobs and closes only their recorded tabs", async () => {
    const { onMessage, onRemoved, create, remove, query, ids } = await setupBulkTabs();
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
    expect(ids()).toEqual([21, 23]);

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
    expect(ids()).toEqual([23]);

    const manualResponse = vi.fn();
    onMessage(
      { type: "close-bulk-job-tab" },
      { tab: { id: 11 } } as chrome.runtime.MessageSender,
      manualResponse,
    );
    await vi.waitFor(() => expect(manualResponse).toHaveBeenCalledWith({ ok: true, result: null }));
    expect(remove).toHaveBeenCalledOnce();

    onRemoved(23);
    await vi.waitFor(() => expect(ids()).toEqual([]));
  });
  it("deduplicates simultaneous requests and retains every created tab", async () => {
    const { send, create, ids } = await setupBulkTabs();
    const responses = await Promise.all([
      send({ type: "open-job-tabs", urls: ["https://www.linkedin.com/jobs/view/200003/"] }),
      send({
        type: "open-job-tabs",
        urls: [
          "https://www.linkedin.com/jobs/view/200003/",
          "https://www.linkedin.com/jobs/view/200005/",
        ],
      }),
    ]);
    expect(responses).toEqual([
      { ok: true, result: null },
      { ok: true, result: null },
    ]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual([21, 23]);
  });

  it("preserves new ownership while a previously opened tab is removed", async () => {
    const { send, onRemoved, ids } = await setupBulkTabs();
    await send({ type: "open-job-tabs", urls: ["https://www.linkedin.com/jobs/view/200003/"] });
    const opening = send({
      type: "open-job-tabs",
      urls: ["https://www.linkedin.com/jobs/view/200005/"],
    });
    onRemoved(21);
    await opening;
    await vi.waitFor(() => expect(ids()).toEqual([23]));
  });

  it("continues processing after a failed open and protects manual tabs", async () => {
    const { send, create, remove, ids } = await setupBulkTabs();
    create.mockRejectedValueOnce(new Error("synthetic tab failure"));
    const failed = await send({
      type: "open-job-tabs",
      urls: ["https://www.linkedin.com/jobs/view/200003/"],
    });
    expect(failed).toEqual({ ok: false, error: "synthetic tab failure" });
    await send({ type: "open-job-tabs", urls: ["https://www.linkedin.com/jobs/view/200003/"] });
    await Promise.all([
      send({ type: "close-bulk-job-tab" }, 21),
      send({ type: "close-bulk-job-tab" }, 11),
    ]);
    expect(remove).toHaveBeenCalledExactlyOnceWith(21);
    expect(ids()).toEqual([]);
  });
});
