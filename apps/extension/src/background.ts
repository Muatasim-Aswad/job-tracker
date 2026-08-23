// Service-worker API proxy. Content scripts relay typed requests here to avoid host
// page CSP restrictions on localhost access.
import { API_BASE_URL } from "./config.js";
import type { BridgeRequest, ReachabilityPush, StatesChangedPush } from "./messages.js";
import { linkedinJobId } from "./adapters/builtin/linkedin/identity.js";

// ── Connectivity badge ───────────────────────────────────────────────────────
// The toolbar badge reports server reachability. HTTP 4xx responses still prove that
// the server is reachable and remain request-level errors.
let serverReachable = true;

function markServerReachable(reachable: boolean) {
  if (reachable === serverReachable) return; // steady state — touch the badge only on change
  serverReachable = reachable;
  void chrome.action.setBadgeText({ text: reachable ? "" : "!" });
  void chrome.action.setBadgeBackgroundColor({ color: "#e53e3e" });
  void chrome.action.setTitle({
    title: reachable
      ? "Job Tracker"
      : "Job Tracker — can't reach the server; changes aren't being saved",
  });
  // Tell the surfaces that show a steady offline state (dimmed bars, popup notice)
  // so they don't wait for their own next failing call to find out.
  broadcastReachability(reachable);
}

function broadcastReachability(reachable: boolean) {
  const msg: ReachabilityPush = { type: "reachabilityChanged", reachable };
  sendToContentTabs(msg);
  // A live popup listens on runtime messaging; a closed one has no receiver.
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// Ignore tabs without a live content-script receiver.
function sendToContentTabs(msg: object, excludeTabId?: number) {
  chrome.tabs.query({ url: contentScripts.flatMap((script) => script.matches ?? []) }, (tabs) => {
    if (chrome.runtime.lastError) return; // no matching tabs / query raced a teardown
    for (const tab of tabs) {
      if (tab.id !== undefined && tab.id !== excludeTabId) {
        chrome.tabs.sendMessage(tab.id, msg, () => void chrome.runtime.lastError);
      }
    }
  });
}

// ── Cross-tab state invalidation ─────────────────────────────────────────────
// Successful writes invalidate other tabs' per-document read models. The origin tab
// already receives authoritative state in the response.
const MUTATING = new Set<BridgeRequest["type"]>([
  "listing",
  "event",
  "false-match",
  "link-job",
  "block-company",
  "unblock-company",
  "form-fill-resolve",
  "form-fill-capture",
  "notify-change",
]);

function broadcastStatesChanged(excludeTabId?: number) {
  const msg: StatesChangedPush = { type: "statesChanged" };
  sendToContentTabs(msg, excludeTabId);
}

// Network failures and 5xx responses mark the server unreachable; 2xx and 4xx clear
// the badge. Callers still handle request success separately.
async function reportingFetch(path: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (e) {
    markServerReachable(false);
    throw e;
  }
  markServerReachable(res.status < 500);
  return res;
}

async function post(path: string, body: unknown) {
  const res = await reportingFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  });
  if (!res.ok) {
    throw new Error(`${path} failed with ${res.status}`);
  }
  // 204 (e.g. /listings/false-match) carries no body — don't try to parse it.
  if (res.status === 204) return null;
  return res.json();
}

async function getJson(path: string) {
  const res = await reportingFetch(path);
  if (!res.ok) {
    throw new Error(`${path} failed with ${res.status}`);
  }
  return res.json();
}

async function del(path: string) {
  const res = await reportingFetch(path, { method: "DELETE", keepalive: true });
  if (!res.ok) {
    throw new Error(`${path} failed with ${res.status}`);
  }
  return null; // 204, no body
}

async function getStateBatch(msg: { platform: string; platform_ids: string[] }) {
  const qs = new URLSearchParams({ platform: msg.platform });
  for (const id of msg.platform_ids) {
    qs.append("platform_ids", id);
  }
  return getJson(`/jobs/states?${qs}`);
}

async function getMatches(msg: {
  platform: string;
  platform_id: string;
  title: string;
  company: string;
}) {
  const qs = new URLSearchParams({
    platform: msg.platform,
    platform_id: msg.platform_id,
    title: msg.title,
    company: msg.company,
  });
  return getJson(`/jobs/matches?${qs}`);
}

// Session storage survives MV3 worker suspension but is cleared with the browser
// session. It records only tab ids created by the Gmail bulk action, so a closed
// listing can never dismiss a tab the user opened themselves.
const BULK_JOB_TAB_IDS_KEY = "bulkJobTabIds";

async function bulkJobTabIds() {
  const stored = await chrome.storage.session.get(BULK_JOB_TAB_IDS_KEY);
  const ids = stored[BULK_JOB_TAB_IDS_KEY];
  return new Set<number>(
    Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id)) : [],
  );
}

async function rememberBulkJobTab(tabId: number) {
  const ids = await bulkJobTabIds();
  ids.add(tabId);
  await chrome.storage.session.set({ [BULK_JOB_TAB_IDS_KEY]: [...ids] });
}

async function forgetBulkJobTab(tabId: number) {
  const ids = await bulkJobTabIds();
  if (!ids.delete(tabId)) return;
  await chrome.storage.session.set({ [BULK_JOB_TAB_IDS_KEY]: [...ids] });
}

// Content scripts supply canonical posting URLs, but keep the worker boundary
// narrow: this bulk action may open only HTTPS LinkedIn job-detail pages. Compare
// listing ids with live LinkedIn tabs so tracking parameters, slug URLs, repeated
// recommendations, and separate emails cannot create duplicates.
async function openJobTabs(urls: string[]) {
  const requested = new Map<string, string>();
  for (const raw of urls) {
    try {
      const url = new URL(raw);
      const valid =
        url.protocol === "https:" &&
        url.hostname === "www.linkedin.com" &&
        /^\/jobs\/view\/\d+\/?$/.test(url.pathname);
      const jobId = valid ? linkedinJobId(url.pathname) : null;
      if (jobId && !requested.has(jobId)) requested.set(jobId, url.href);
    } catch {
      // Ignore malformed and non-LinkedIn inputs without widening the boundary.
    }
  }

  const openTabs = await chrome.tabs.query({
    url: ["https://www.linkedin.com/jobs/view/*", "https://www.linkedin.com/comm/jobs/view/*"],
  });
  const openJobIds = new Set(
    openTabs.flatMap((tab) => {
      const jobId = tab.url ? linkedinJobId(tab.url) : null;
      return jobId ? [jobId] : [];
    }),
  );

  for (const [jobId, url] of requested) {
    if (openJobIds.has(jobId)) continue;
    const tab = await chrome.tabs.create({ url, active: false });
    if (tab.id !== undefined) await rememberBulkJobTab(tab.id);
    openJobIds.add(jobId);
  }
  return null;
}

async function closeBulkJobTab(tabId?: number) {
  if (tabId === undefined || !(await bulkJobTabIds()).has(tabId)) return null;
  try {
    await chrome.tabs.remove(tabId);
  } finally {
    await forgetBulkJobTab(tabId);
  }
  return null;
}

function handle(msg: BridgeRequest, sender?: chrome.runtime.MessageSender) {
  switch (msg.type) {
    case "listing":
      return post("/listings", msg.payload);
    case "event":
      return post("/events", msg.payload);
    case "state-batch":
      return getStateBatch(msg);
    case "matches":
      return getMatches(msg);
    case "false-match":
      return post("/listings/false-match", {
        platform: msg.platform,
        platform_id: msg.platform_id,
        other_job_id: msg.other_job_id,
      });
    case "link-job":
      return post("/listings/link-job", {
        platform: msg.platform,
        platform_id: msg.platform_id,
        other_job_id: msg.other_job_id,
      });
    case "applied-count":
      return getJson(`/jobs/applied-count?${new URLSearchParams({ company: msg.company })}`);
    case "blocklist":
      return getJson("/blocked-companies");
    case "block-company":
      return post("/blocked-companies", { company: msg.company, platform: msg.platform });
    case "unblock-company":
      return del(
        `/blocked-companies/${encodeURIComponent(msg.company_key)}?${new URLSearchParams({ platform: msg.platform })}`,
      );
    case "form-fill-resolve":
      return post("/form-fill/resolutions", msg.payload);
    case "form-fill-capture":
      return post("/form-fill/captures", msg.payload);
    case "reachability":
      // From the cached flag, no fetch. The poll below keeps it fresh, and a stale
      // "reachable: true" self-corrects on the asker's own next call.
      return Promise.resolve({ reachable: serverReachable });
    case "open-job-tabs":
      return openJobTabs(msg.urls);
    case "close-bulk-job-tab":
      return closeBulkJobTab(sender?.tab?.id);
    case "notify-change":
      // The write already happened on the caller's own origin. Membership in
      // MUTATING is the point — the broadcast below does the work.
      return Promise.resolve(null);
    default:
      return Promise.resolve(null);
  }
}

// Browser UI outlives an idle MV3 worker; reset it with the in-memory default.
void chrome.action.setBadgeText({ text: "" });

// ── Health poll ──────────────────────────────────────────────────────────────
// Poll at Chrome's 30-second MV3 minimum so idle sessions still report outages.
void chrome.alarms.create("health-poll", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "health-poll") reportingFetch("/health").catch(() => {});
});
// Initialize reachability immediately instead of waiting for the first alarm.
reportingFetch("/health").catch(() => {});

// ── Post-navigation re-injection ─────────────────────────────────────────────
// Some SPA navigations replace a document without declarative reinjection. Register
// every manifest entry separately so the top-frame engine and the all-frame Easy
// Apply scanner retain their own match and frame boundaries.
const contentScripts = chrome.runtime.getManifest().content_scripts ?? [];
type ManifestContentScript = (typeof contentScripts)[number];

async function reinjectContentScript(
  script: ManifestContentScript,
  tabId: number,
  frameId: number,
) {
  const files = script.js ?? [];
  if ((!script.all_frames && frameId !== 0) || !files.length) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files,
    });
  } catch {
    // Frame gone, a restricted URL, or a racing navigation. The content.ts sentinel
    // makes a later successful retry idempotent, so a miss here is harmless.
  }
}

// onCommitted catches swapped-in / activated documents; onHistoryStateUpdated
// catches same-document route changes. Each entry's boot sentinel deduplicates it.
for (const script of contentScripts) {
  const navFilter: chrome.webNavigation.WebNavigationEventFilter = { url: [] };
  for (const match of script.matches ?? []) {
    try {
      navFilter.url!.push({ hostEquals: new URL(match).hostname });
    } catch {
      // Ignore malformed optional adapter patterns rather than widening injection.
    }
  }
  if (!navFilter.url?.length) continue;
  chrome.webNavigation.onCommitted.addListener(
    (details) => reinjectContentScript(script, details.tabId, details.frameId),
    navFilter,
  );
  chrome.webNavigation.onHistoryStateUpdated.addListener(
    (details) => reinjectContentScript(script, details.tabId, details.frameId),
    navFilter,
  );
}

chrome.runtime.onMessage.addListener((msg: BridgeRequest, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;

  handle(msg, sender)
    .then((result) => {
      // Only a write that landed invalidates anyone; a rejected call changed
      // nothing. `sender.tab` is undefined for the popup, correctly leaving every
      // tab in the fan-out.
      if (MUTATING.has(msg.type)) broadcastStatesChanged(sender.tab?.id);
      sendResponse({ ok: true, result });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: String(error.message || error) });
    });

  return true;
});

// Manual closes and navigation races also retire the temporary ownership marker.
chrome.tabs.onRemoved.addListener((tabId) => {
  void forgetBulkJobTab(tabId);
});
