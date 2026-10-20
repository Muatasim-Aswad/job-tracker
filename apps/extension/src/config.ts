export const SERVER_URL_KEY = "serverUrl";
export const DEFAULT_SERVER_URL = normalizeServerUrl(
  import.meta.env.VITE_SERVER_URL || "http://localhost:3456",
);
export let SERVER_URL = DEFAULT_SERVER_URL;
export let API_BASE_URL = `${SERVER_URL}/api`;

let initialized: Promise<void> | undefined;
const listeners = new Set<() => void>();

// Unscoped requests retain the build-default destination used by older adapters.
export function serverScope(): { serverUrl?: string } {
  return SERVER_URL === DEFAULT_SERVER_URL ? {} : { serverUrl: SERVER_URL };
}

export function normalizeServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a complete http:// or https:// server address.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/*$/.test(url.pathname)
  ) {
    throw new Error(
      "Use an http:// or https:// server address without credentials, a path, query, or fragment.",
    );
  }
  return url.origin;
}

function applyServerUrl(value: unknown) {
  let next = DEFAULT_SERVER_URL;
  try {
    if (typeof value === "string" && value.trim()) next = normalizeServerUrl(value);
  } catch {
    /* Corrupt settings fall back to the build default. */
  }
  if (SERVER_URL === next) return;
  SERVER_URL = next;
  API_BASE_URL = `${next}/api`;
  listeners.forEach((listener) => listener());
}

export function onServerChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function initializeServerConfig(): Promise<void> {
  initialized ??= new Promise<void>((resolve) => {
    let changed = false;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[SERVER_URL_KEY]) return;
      changed = true;
      applyServerUrl(changes[SERVER_URL_KEY].newValue);
    });
    chrome.storage.local.get(SERVER_URL_KEY, (data) => {
      if (!changed) applyServerUrl(data[SERVER_URL_KEY]);
      resolve();
    });
  });
  return initialized;
}

export async function saveServerUrl(value: string): Promise<void> {
  const url = normalizeServerUrl(value);
  if (url === DEFAULT_SERVER_URL) await chrome.storage.local.remove(SERVER_URL_KEY);
  else await chrome.storage.local.set({ [SERVER_URL_KEY]: url });
  applyServerUrl(url);
}

export async function connectServer(value: string, save: boolean): Promise<string> {
  const url = normalizeServerUrl(value);
  const allowed = await chrome.permissions.request({ origins: [`${url}/*`] });
  if (!allowed) throw new Error("Server access was not granted. Your current server is unchanged.");
  await testServerConnection(url);
  if (save) await saveServerUrl(url);
  return url;
}

export async function testServerConnection(value: string): Promise<void> {
  const url = normalizeServerUrl(value);
  const response = await fetch(`${url}/api/health`, {
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Server returned HTTP ${response.status}.`);
  const health = await response.json();
  if (health?.ok !== true)
    throw new Error("This address did not return a Job Tracker health response.");
}
