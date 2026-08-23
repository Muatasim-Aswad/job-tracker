// Site-agnostic card/detail bars, controls, and visual state.
import type { Engine } from "./types.js";
import type { Adapter } from "../adapters/types";
import type { CompanyAppliedCount } from "@job-tracker/shared/api";
import type { JobState } from "../messages.js";
import { JobFunnel } from "@job-tracker/shared/funnel";
import { normalizeCompany } from "@job-tracker/shared/text";
import { SERVER_URL } from "../config.js";
import { getAdapters, toNaturalKey } from "../registry.js";
import { titleHighlights } from "./keywords.js";
import { ICON } from "../icons.js";

// Dashboard SPA origin, same as the API. Only used for "open this job in the
// dashboard" deep-links, which are plain navigations, never fetches.
const DASHBOARD_URL = SERVER_URL;

// List surfaces are for discovery. Once a posting has been selected for application
// or moved beyond that decision, the display preference may dim/remove its card.
// This is presentation-only and never changes the independent hidden flag.
export function isListDeemphasized(status: string): boolean {
  return status === "to_apply" || JobFunnel.isResolved(status);
}

export function createBars(engine: Engine) {
  function renderPageActions() {
    getAdapters()
      .find((adapter) => adapter.matches(location.hostname))
      ?.renderPageActions?.();
  }
  // Idempotent, and re-run for every card on each scan: the highlight must also come
  // off a card whose rule the user has just turned off.
  function flagCard(card: HTMLElement) {
    card.classList.toggle("jh-red", titleHighlights(card.dataset.jobTitle || ""));
  }

  // ── Hide mode (local UI preference, not job state) ─────────────────────────
  let hideMode = "remove";
  function loadHideMode(cb?: () => void) {
    chrome.storage.local.get("hideMode", (d) => {
      hideMode = (d.hideMode as string) || "remove";
      if (cb) cb();
    });
  }

  // Cache applied-job counts by normalized company for the session.
  const appliedCounts = new Map<string, number>(); // companyKey -> count
  const appliedCountPending = new Set<string>(); // companyKeys with a fetch in flight

  // Start a fetch on first access and return null while unresolved.
  function appliedCountFor(company: string | null | undefined): number | null {
    const key = normalizeCompany(company);
    if (!key) return null;
    const known = appliedCounts.get(key);
    if (known !== undefined) return known;
    if (!appliedCountPending.has(key)) {
      appliedCountPending.add(key);
      void engine.bridge({ type: "applied-count", company: company! }).then((resp) => {
        appliedCountPending.delete(key);
        if (!resp.ok) return; // stays unresolved — a later render retries
        appliedCounts.set(key, (resp.result as CompanyAppliedCount).count);
        renderAll(); // lands once per company per session
      });
    }
    return null;
  }

  // Keep the previous-applications badge aligned with the cached count.
  function updateAppliedBadge(bar: HTMLElement, company: string | null | undefined) {
    const count = appliedCountFor(company);
    let btn = bar.querySelector(".jh-btn-applied") as HTMLButtonElement | null;
    if (!count) {
      btn?.remove();
      return;
    }
    if (!btn) {
      btn = mkBtn("jh-btn-applied", "", "");
      const q = (company || "").trim();
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(`${DASHBOARD_URL}/?q=${encodeURIComponent(q)}`, "_blank", "noopener");
      });
      (bar.querySelector(".jh-group-insight") || bar).appendChild(btn);
    }
    const want = String(count);
    if (btn.dataset.jhCount !== want) {
      btn.dataset.jhCount = want;
      btn.innerHTML = `${ICON.history}<span>${count}</span>`;
      btn.title = `${count} previous application${count > 1 ? "s" : ""} to ${company} — open the dashboard filtered to this company`;
    }
  }

  // ── Controls ───────────────────────────────────────────────────────────────
  // Only known icon strings are inserted as markup; other content remains text.
  function mkBtn(cls: string, content: string, title: string) {
    const btn = document.createElement("button");
    btn.className = "jh-btn " + cls;
    setBtnContent(btn, content);
    btn.title = title;
    return btn;
  }

  function setBtnContent(btn: HTMLElement, content: string) {
    if (content.includes("<svg")) btn.innerHTML = content;
    else btn.textContent = content;
  }

  // Natural-key links survive job merges and never create missing jobs.
  function openDashboardJob(jobId: string) {
    const key = toNaturalKey(jobId);
    if (!key) return;
    const qs = new URLSearchParams({ platform: key.platform, platform_id: key.platform_id });
    window.open(`${DASHBOARD_URL}/?${qs}`, "_blank", "noopener");
  }

  function mkOpenButton(jobId: string) {
    const btn = mkBtn("jh-btn-open", ICON.open, "Open in dashboard");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDashboardJob(jobId);
    });
    return btn;
  }

  function updateControls(container: HTMLElement, st: JobState, hideShortcut?: string) {
    const btnHide = container.querySelector(".jh-btn-hide") as HTMLElement | null;
    if (btnHide) {
      // Rewrite icon markup only when state changes.
      const want = st.hidden ? "1" : "0";
      if (btnHide.dataset.jhHidden !== want) {
        btnHide.dataset.jhHidden = want;
        setBtnContent(btnHide, st.hidden ? ICON.eye : ICON.eyeOff);
        btnHide.title = `${st.hidden ? "Unhide" : "Hide"}${hideShortcut ? ` (${hideShortcut})` : ""}`;
      }
    }
    const btnStar = container.querySelector(".jh-btn-star") as HTMLElement | null;
    if (btnStar) {
      btnStar.classList.toggle("jh-on", st.starred); // .jh-on fills the star
      btnStar.title = st.starred ? "Remove star" : "Star";
    }
    const select = container.querySelector(".jh-status") as HTMLSelectElement | null;
    if (select) {
      engine.syncStatusSelect(select, st.status);
      engine.pinSelectTheme(select, JobFunnel.isResolved(st.status));
    }
  }

  // Hidden/blocked cards receive stronger treatment than selected/resolved cards.
  // Remove mode hides both tiers; jhForceMode can keep a surface visible.
  function renderCard(card: HTMLElement) {
    const id = card.dataset.jhId!;
    const st = engine.stateOf(id);
    card.classList.remove("jh-hidden", "jh-removed", "jh-resolved", "jh-interested");

    const mode = card.dataset.jhForceMode || hideMode;
    const deemphasized = isListDeemphasized(st.status);
    const blocked = engine.isCardBlocked(card);
    if (mode === "remove" && (blocked || st.hidden || deemphasized)) {
      card.classList.add("jh-removed");
    } else if (blocked || st.hidden) {
      card.classList.add("jh-hidden");
    } else if (deemphasized) {
      card.classList.add("jh-resolved");
    } else if (st.starred) {
      card.classList.add("jh-interested");
    }
    updateControls(card, st);
    const bar = card.querySelector(".jh-actions") as HTMLElement | null;
    if (bar) {
      updateAppliedBadge(bar, card.dataset.jobCompany);
      engine.decorateOffline(bar);
    }
  }

  function renderDetailBar(bar: HTMLElement) {
    const jobId = bar.dataset.jhJobId!;
    updateControls(bar, engine.stateOf(jobId), "Alt+H");
    // Identity may resolve after the bar is first injected.
    const company = engine.matchCompany(jobId);
    updateAppliedBadge(bar, company);
    updateDetailBlockButton(bar, company);
    engine.decorateOffline(bar);
  }

  // Hide the block action until company identity resolves.
  function updateDetailBlockButton(bar: HTMLElement, company: string | null | undefined) {
    const btn = bar.querySelector(".jh-btn-block") as HTMLButtonElement | null;
    if (!btn) return;
    const name = (company || "").trim();
    if (!name) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    btn.dataset.jhCompany = name;
    const key = toNaturalKey(bar.dataset.jhJobId || "");
    const blocked = engine.isCompanyBlocked(name, key?.platform || "*");
    btn.classList.toggle("jh-on", blocked);
    btn.title = blocked
      ? `${name} is blocked — click to unblock`
      : `Block “${name}” everywhere (stop capturing and showing it)`;
  }

  // Re-render every DOM surface for one job (list cards + detail bar).
  function renderJob(jobId: string) {
    const sel = CSS.escape(jobId);
    document
      .querySelectorAll(`[data-jh-id="${sel}"]`)
      .forEach((el) => renderCard(el as HTMLElement));
    const bar = document.querySelector(`.jh-detail-actions[data-jh-job-id="${sel}"]`);
    if (bar) renderDetailBar(bar as HTMLElement);
    renderPageActions();
  }

  function renderAll() {
    document.querySelectorAll("[data-jh-id]").forEach((el) => renderCard(el as HTMLElement));
    const bar = document.querySelector(".jh-detail-actions");
    if (bar) renderDetailBar(bar as HTMLElement);
    renderPageActions();
  }

  // One hidden-flag action shared by pointer controls and platform shortcuts, so
  // every surface reads the latest cached state before choosing hide or unhide.
  function toggleHidden(jobId: string) {
    return engine.emit(jobId, engine.stateOf(jobId).hidden ? "unhidden" : "hidden");
  }

  function flashError(jobId: string) {
    const sel = CSS.escape(jobId);
    const bars = [
      ...document.querySelectorAll(`[data-jh-id="${sel}"] .jh-actions`),
      ...document.querySelectorAll(`.jh-detail-actions[data-jh-job-id="${sel}"]`),
    ];
    bars.forEach((bar) => {
      bar.classList.add("jh-error");
      setTimeout(() => bar.classList.remove("jh-error"), 1500);
    });
  }

  // ── Detail page: action bar ──────────────────────────────────────────────────
  // Inject the detail-page action bar (status / star / hide) next to `anchor`. Site-
  // agnostic: each adapter's scanDetail supplies its own anchor and placement.
  function injectDetailButtons(
    jobId: string,
    anchor: Element | null,
    placement: InsertPosition = "beforebegin",
    extraClass = "",
  ) {
    if (document.querySelector(".jh-detail-actions")) return;
    if (!anchor) return;

    const bar = document.createElement("div");
    bar.className = "jh-actions jh-detail-actions" + (extraClass ? " " + extraClass : "");
    bar.dataset.jhJobId = jobId;

    const btnHide = mkBtn("jh-btn-hide", ICON.eyeOff, "Hide");
    btnHide.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void toggleHidden(jobId);
    });
    const btnStar = mkBtn("jh-btn-star", ICON.star, "Star");
    btnStar.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void engine.emit(jobId, engine.stateOf(jobId).starred ? "unstarred" : "starred");
    });

    // Block/unblock lives inline here, where a company fully resolves and there's
    // room; list cards keep it in the ⋯ menu. Hidden until a company resolves, then
    // renderDetailBar flips its state.
    const btnBlock = mkBtn("jh-btn-block", ICON.ban, "Block company");
    btnBlock.hidden = true;
    btnBlock.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void engine.toggleDetailBlock(jobId, btnBlock);
    });

    // Clusters, left→right: [insight 🔁 ⟲N] | status | [action star hide open block].
    // The detail bar is roomy — no ⋯ — so Open stays inline. The insight group starts
    // empty; renderMatchControl/updateAppliedBadge fill it on later scans.
    const insight = document.createElement("div");
    insight.className = "jh-group jh-group-insight";
    const action = document.createElement("div");
    action.className = "jh-group jh-group-action";
    action.append(btnStar, btnHide, mkOpenButton(jobId), btnBlock);

    bar.append(insight, engine.makeStatusSelect(jobId), action);
    anchor.insertAdjacentElement(placement, bar);
    renderDetailBar(bar);
  }

  // ── Card action bar ─────────────────────────────────────────────────────────
  function injectButtons(card: HTMLElement, adapter: Adapter) {
    if (card.querySelector(".jh-actions")) return;

    const id = card.dataset.jhId!;
    const bar = document.createElement("div");
    bar.className = "jh-actions";

    const btnStar = mkBtn("jh-btn-star", ICON.star, "Star");
    btnStar.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      engine.captureCardFromAction(card); // so the action doesn't land on a bare stub
      void engine.emit(id, engine.stateOf(id).starred ? "unstarred" : "starred");
    });

    const btnHide = mkBtn("jh-btn-hide", ICON.eyeOff, "Hide");
    btnHide.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      engine.captureCardFromAction(card);
      void toggleHidden(id);
    });

    // Clusters, left→right: [insight 🔁 ⟲N] | status | [action star hide open dismiss]
    // | ⋯. In the narrow list view (jhCompact) the less-used Open folds into the ⋯
    // menu rather than taking an inline slot.
    const compact = card.dataset.jhCompact === "1";
    const insight = document.createElement("div");
    insight.className = "jh-group jh-group-insight";
    const action = document.createElement("div");
    action.className = "jh-group jh-group-action";
    action.append(btnStar, btnHide);
    if (!compact) action.append(mkOpenButton(id));

    bar.append(insight, engine.makeStatusSelect(id, card), action);

    // 🗑️ Dismiss — the site's own native dismiss only (hides + tells the site + marks skipped)
    const nativeDismiss = adapter.nativeDismiss?.(card);
    if (nativeDismiss) {
      const btnDismiss = mkBtn("jh-btn-dismiss", ICON.x, "Dismiss from site");
      btnDismiss.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        engine.captureCardFromAction(card);
        dismissJob(id);
        nativeDismiss();
      });
      action.appendChild(btnDismiss);
    }

    // ⋯ overflow: rare actions (block company; Open when compact) kept off the hot
    // path — trailing, quiet.
    bar.appendChild(engine.mkOverflowButton(card));

    const anchor =
      (adapter.cardBodySelector && card.querySelector(adapter.cardBodySelector)) || card;
    anchor.appendChild(bar);
    renderCard(card);
  }

  // Dismiss = mark skipped ("decided not to apply"), which then dims the card via
  // `jh-resolved` — no separate hide flag. Only when skip is still a legit forward
  // move AND the job isn't already in the application funnel (skipping an applied job
  // is nonsensical; skipping a terminal one is a correction). If neither holds the
  // job's already resolved/dimmed, so our side no-ops and only the native dismiss fires.
  function dismissJob(jobId: string) {
    const status = engine.stateOf(jobId).status;
    if (!JobFunnel.APPLIED.has(status) && JobFunnel.isForwardMove(status, "skipped")) {
      void engine.emit(jobId, "skipped");
    }
  }

  return {
    flagCard,
    loadHideMode,
    mkBtn,
    openDashboardJob,
    renderJob,
    renderAll,
    flashError,
    toggleHidden,
    injectDetailButtons,
    injectButtons,
  };
}
