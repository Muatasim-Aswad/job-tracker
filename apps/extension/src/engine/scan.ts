// Site-agnostic lifecycle: choose the adapter, observe mutations, process cards,
// and invoke detail/capture hooks and wall sweeps.
import { onServerChanged } from "../config.js";
import type { Engine } from "./types.js";
import type { Adapter } from "../adapters/types";
import type { ReachabilityState } from "../messages.js";
import { JobFunnel } from "@job-tracker/shared/funnel";
import { getAdapters, toNaturalKey } from "../registry.js";
import { titleAutoHides } from "./keywords.js";
import { KEYWORD_POLICY_KEY, loadKeywordPolicy } from "./settings.js";

export function createScan(engine: Engine) {
  // ── Process all cards ────────────────────────────────────────────────────
  function processCards(adapter: Adapter) {
    adapter.findCards(document).forEach((card) => {
      engine.injectButtons(card, adapter);
      // The site's own "Applied" badge → auto-mark applied (server-guarded, deduped)
      if (adapter.isAppliedCard?.(card)) void engine.autoEmit(card.dataset.jhId!, "applied");
    });

    // Reapply rules to every tagged card: storage may load or change after discovery.
    const cards = [...document.querySelectorAll("[data-jh-id]")] as HTMLElement[];
    cards.forEach((card) => {
      engine.flagCard(card);
      // A title opening with a `hide` term is feed noise, so fire the same `hidden`
      // event the manual Hide button emits (bars.ts): it persists server-side and
      // renders like a manual hide.
      const key = toNaturalKey(card.dataset.jhId || "");
      if (key?.platform === "linkedin" && titleAutoHides(card.dataset.jobTitle || "")) {
        void engine.autoEmit(card.dataset.jhId!, "hidden");
      }
    });

    void engine.refreshStates(cards.map((c) => c.dataset.jhId!)).then((statesAvailable) => {
      engine.renderAll();
      autoWallCards(adapter); // needs resolved states to know which aren't there yet
      adapter.renderPageActions?.(statesAvailable);
    });
  }

  // Sweep only jhWall cards, preferring per-card status over wallStatus.
  // Recommendations in outcome emails must never inherit the email's status.
  // Capture first to avoid stubs; forward-move checks and session dedup guard events.
  function autoWallCards(adapter: Adapter) {
    const surfaceStatus = adapter.wallStatus?.();
    document.querySelectorAll("[data-jh-id][data-jh-wall]").forEach((card) => {
      const status = (card as HTMLElement).dataset.jhWallStatus || surfaceStatus;
      if (!status) return;
      const id = (card as HTMLElement).dataset.jhId!;
      if (!JobFunnel.isForwardMove(engine.stateOf(id).status, status)) return;
      engine.captureCardFromAction(card as HTMLElement);
      // Pass the real event time if the adapter stamped one (e.g. Gmail's received
      // date), so the rejection is dated when it happened rather than now.
      void engine.autoEmit(id, status, (card as HTMLElement).dataset.jhTs);
    });
  }

  // ── Start: message/storage listeners + the scan loop ────────────────────────
  function start() {
    const adapter = getAdapters().find((a) => a.matches(location.hostname));
    if (!adapter) return;

    const scan = () => {
      // Some sites are injected wholesale (see the linkedin adapter), so act only
      // once the URL is on a surface this adapter targets.
      if (adapter.activeOn && !adapter.activeOn(location.pathname)) return;
      processCards(adapter);
      adapter.scanDetail?.();
      adapter.capture?.();
    };

    // Trailing debounce settles bursts; a fixed ceiling prevents starvation when
    // host mutations and background-tab timer clamping share the same cadence.
    const SETTLE_MS = 200;
    const CEILING_MS = 1000;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let ceilingTimer: ReturnType<typeof setTimeout> | undefined;
    function scheduleScan(delay = SETTLE_MS) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(runScan, delay);
      ceilingTimer ??= setTimeout(runScan, Math.max(delay, CEILING_MS));
    }
    function runScan() {
      clearTimeout(settleTimer);
      clearTimeout(ceilingTimer);
      settleTimer = ceilingTimer = undefined;
      scan();
    }

    // Route changes start a scan ladder because lazy anchors may arrive after
    // the page goes quiet, without another mutation to trigger a pass.
    const RESCAN_LADDER_MS = [0, 600, 1500, 3000, 6000];
    let ladderTimers: ReturnType<typeof setTimeout>[] = [];
    function rescanWhileRendering() {
      ladderTimers.forEach(clearTimeout);
      ladderTimers = RESCAN_LADDER_MS.map((ms) => setTimeout(() => scheduleScan(0), ms));
    }

    onServerChanged(() => {
      engine.resetReadModel();
      engine.resetCapture();
      engine.resetMatches();
      engine.resetBlocklist();
      engine.resetBars();
      engine.setOffline(false);
      engine.renderAll();
      void engine.syncBlocklist();
      engine.captureCards([...document.querySelectorAll<HTMLElement>("[data-jh-id]")]);
      rescanWhileRendering();
    });

    // Platform shortcuts share the adapter's DOM identity rules. Capture lets a
    // claimed chord stop before the host page also interprets it.
    if (adapter.onKeyDown) {
      window.addEventListener("keydown", (event) => adapter.onKeyDown?.(event), true);
    }

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === "modeChanged") engine.loadHideMode(engine.renderAll);
      // The popup asks the active surface for a date to suggest when recording a
      // status by hand. A synchronous DOM read, so respond in place; null when the
      // adapter exposes none or nothing is open.
      if (msg.type === "getEventDate") sendResponse({ ts: adapter.openEventDate?.() ?? null });
      // A reachability flip from the background, so the bars dim or recover without
      // waiting for this page's own next call.
      if (msg.type === "reachabilityChanged") engine.setOffline(!msg.reachable);
      // Cross-tab writes invalidate cached state. Debounce refetches visible IDs in one batch.
      if (msg.type === "statesChanged") {
        engine.invalidateStates();
        scheduleScan(0);
      }
    });
    // chrome.storage holds the UI prefs (hideMode) and the keyword policy; job state
    // is the API's. A policy edit in the popup lands here, so reload, repaint, and
    // rescan to apply a newly enabled highlight/auto-hide to the cards on screen.
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.hideMode) engine.loadHideMode(engine.renderAll);
      if (changes[KEYWORD_POLICY_KEY]) {
        loadKeywordPolicy(() => {
          engine.renderAll();
          scheduleScan(0);
        });
      }
    });

    // A first document renders as progressively as an in-app route change, so it gets
    // the same ladder rather than a single pass.
    engine.loadHideMode(rescanWhileRendering);
    // Seed the keyword policy from storage — inert until then, so nothing is marked
    // or hidden prematurely — then repaint and rescan to apply it to this page.
    loadKeywordPolicy(() => {
      engine.renderAll();
      scheduleScan(0);
    });
    void engine.syncBlocklist(); // seed the company blocklist; re-renders once it lands
    // Paint the offline state up front, so bars start dimmed on a page loaded while
    // the server is already down instead of waiting for a flip that only fires on a
    // future transition.
    void engine.bridge({ type: "reachability" }).then((resp) => {
      if (resp.ok) engine.setOffline(!(resp.result as ReachabilityState).reachable);
    });

    // documentElement, not body: a full-document SPA swap replaces <body>, and an
    // observer left on the detached one never reports again.
    const observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Detect SPA URL changes (LinkedIn job-to-job, Gmail email-to-email).
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        rescanWhileRendering();
      }
    }, 300);
    window.addEventListener("popstate", rescanWhileRendering);
    // Visibility triggers a scan because background pages may finish rendering
    // without leaving a mutation, or defer their panes until visible.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) rescanWhileRendering();
    });
  }

  return { start };
}
