// ── Scan loop + lifecycle ────────────────────────────────────────────────────
// Picks the active adapter, wires the message/storage listeners, and drives the
// MutationObserver scan loop that processes cards, runs the adapter's detail/capture
// hooks, and sweeps the "wall" surfaces. The only site-agnostic entry point.
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

    // Keyword rules run over every tagged card, not only the ones this pass found:
    // the policy is seeded from storage after the first cards are already on screen
    // and can be edited in the popup at any time, and both must reach the cards in
    // view without a page reload.
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

    void engine.refreshStates(cards.map((c) => c.dataset.jhId!)).then(() => {
      engine.renderAll();
      autoWallCards(adapter); // needs resolved states to know which aren't there yet
    });
  }

  // Auto-mark the cards findCards tagged `jhWall`, each of which is at one known
  // status. That status comes from the card's own `jhWallStatus` when the adapter
  // stamped one, else the surface-level `wallStatus()`. Only jhWall cards are swept,
  // not every job on the page: a rejection email also lists "jobs you may be
  // interested in", which are real jobs keeping their normal triage bar and must
  // never be auto-rejected. Gated on `isForwardMove` so it fires only while that
  // status is still ahead, and rides the same session dedup as other auto-emits.
  // captureCardFromAction runs first so the event lands on a real listing, not a stub.
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

    // Two timers, because waiting for the DOM to settle is not on its own enough.
    // `settleTimer` folds a burst of mutations into one scan; `ceilingTimer` is armed
    // once per burst and never pushed back, guaranteeing a scan within CEILING_MS of
    // the first request. A trailing debounce alone starves whenever mutations keep
    // arriving faster than it: a hidden tab clamps timers to ~1s and host pages render
    // on that same cadence, so each mutation cleared the pending scan before it ran and
    // the page kept its bars only after a manual reload.
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

    // A surface renders in stages — cards, top card, apply control and job description
    // can land seconds apart — and a hook whose anchor is still missing does nothing
    // until the next scan. So a route change starts a ladder of passes rather than one
    // timed guess: the pane often finishes after the page has otherwise gone quiet,
    // leaving no mutation to ride.
    const RESCAN_LADDER_MS = [0, 600, 1500, 3000, 6000];
    let ladderTimers: ReturnType<typeof setTimeout>[] = [];
    function rescanWhileRendering() {
      ladderTimers.forEach(clearTimeout);
      ladderTimers = RESCAN_LADDER_MS.map((ms) => setTimeout(() => scheduleScan(0), ms));
    }

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
      // A write landed in another tab or the popup, so this document's read-model is
      // stale: drop it and rescan. The scan refetches only the ids currently in the
      // DOM, so this is one batch call. Going through the debounce folds a burst of
      // writes elsewhere into a single refetch here.
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
    // A tab opened in the background — a job middle-clicked from a results list or a
    // web search — can render and go quiet before it is ever looked at, and some panes
    // render only once visible. Either way no mutation is left to trigger a scan.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) rescanWhileRendering();
    });
  }

  return { start };
}
