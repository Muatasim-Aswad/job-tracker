// Detail-view duplicate suggestions. The server picks same-company candidates by
// normalized title or application destination, drops mutual exclusions, and attaches
// the evidence each row shows.
import type { Engine } from "./types.js";
import type { JobMatch } from "@job-tracker/shared/api";
import { JobFunnel } from "@job-tracker/shared/funnel";
import { evidenceRows, similarityPercent, timingText } from "@job-tracker/shared/matches";
import { normalizeTitle } from "@job-tracker/shared/text";
import { SERVER_URL } from "../config.js";
import { toNaturalKey } from "../registry.js";
import { ICON } from "../icons.js";

const DASHBOARD_URL = SERVER_URL;

export function createMatches(engine: Engine) {
  const matchState = new Map<string, JobMatch[]>(); // jobId -> candidate jobs
  const matchIdentity = new Map<string, { title: string | null; company: string | null }>();
  const queryEpoch = new Map<string, number>(); // jobId -> most recently issued query
  let openPopoverJobId: string | null = null;

  // Only the latest issued query may update a job's matches; capture can trigger
  // a scored refresh while an earlier unscored request remains in flight.
  async function queryMatches(jobId: string): Promise<boolean> {
    const key = toNaturalKey(jobId);
    const identity = matchIdentity.get(jobId);
    if (!key || !identity?.title || !identity.company) return false;
    const epoch = (queryEpoch.get(jobId) ?? 0) + 1;
    queryEpoch.set(jobId, epoch);
    const resp = await engine.bridge({
      type: "matches",
      platform: key.platform,
      platform_id: key.platform_id,
      title: identity.title,
      company: identity.company,
    });
    if (!resp.ok || queryEpoch.get(jobId) !== epoch) return false;
    matchState.set(jobId, resp.result as JobMatch[]);
    return true;
  }

  // Cache empty and non-empty results; incomplete identity retries on a later scan.
  async function checkMatches(jobId: string, title: string | null, company: string | null) {
    const key = toNaturalKey(jobId);
    if (!key || !title || !company) return;
    if (!matchState.has(jobId)) {
      matchIdentity.set(jobId, { title, company });
      if (!(await queryMatches(jobId))) return; // leave uncached so a later scan retries
    }
    renderMatchControl(jobId);
  }

  // Refresh after listing capture or merge changes candidate evidence.
  // Before identity is established, the next ordinary scan performs the lookup.
  async function refreshMatches(jobId: string) {
    if (!matchIdentity.has(jobId)) return;
    if (!(await queryMatches(jobId))) return;
    renderOpenMatchUi(jobId);
  }

  // Repaint the badge and, when this job's popover is open, its rows.
  function renderOpenMatchUi(jobId: string) {
    const badge = renderMatchControl(jobId);
    if (openPopoverJobId !== jobId) return;
    if (badge) buildPopover(jobId, badge);
    else closeMatchPopover(jobId);
  }

  function detailBarFor(jobId: string): HTMLElement | null {
    const sel = CSS.escape(jobId);
    return document.querySelector(`.jh-detail-actions[data-jh-job-id="${sel}"]`);
  }

  // Leave an open popover intact while idempotently updating its badge.
  function renderMatchControl(jobId: string): HTMLButtonElement | null {
    const bar = detailBarFor(jobId);
    if (!bar) return null; // bar not injected yet (no anchor) — a later scan retries
    const matches = matchState.get(jobId) || [];
    let btn = bar.querySelector(".jh-btn-match") as HTMLButtonElement | null;
    if (!matches.length) {
      btn?.remove();
      closeMatchPopover(jobId);
      return null;
    }
    if (!btn) {
      btn = engine.mkBtn("jh-btn-match", "", "");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMatchPopover(jobId, btn!);
      });
      const insight = bar.querySelector(".jh-group-insight") || bar;
      insight.insertBefore(btn, insight.firstChild);
    }
    // Avoid reparsing SVG markup on every scan.
    const count = String(matches.length);
    if (btn.dataset.jhCount !== count) {
      btn.dataset.jhCount = count;
      btn.innerHTML = `${ICON.repeat}<span class="jh-match-count">${count}</span>`;
      btn.title = `${matches.length} possible duplicate${matches.length > 1 ? "s" : ""} — you may have already seen this job`;
    }
    return btn;
  }

  function toggleMatchPopover(jobId: string, btn: HTMLElement) {
    if (openPopoverJobId === jobId) {
      closeMatchPopover();
      return;
    }
    closeMatchPopover();
    buildPopover(jobId, btn);
    openPopoverJobId = jobId;
    // Capture phase observes clicks in both injected and host UI.
    document.addEventListener("click", onPopoverOutsideClick, true);
    document.addEventListener("keydown", onPopoverKey, true);
  }

  function closeMatchPopover(jobId?: string) {
    if (jobId && openPopoverJobId !== jobId) return;
    document.querySelector(".jh-match-popover")?.remove();
    openPopoverJobId = null;
    document.removeEventListener("click", onPopoverOutsideClick, true);
    document.removeEventListener("keydown", onPopoverKey, true);
  }

  function onPopoverOutsideClick(e: MouseEvent) {
    const t = e.target as Element | null;
    if (t?.closest(".jh-match-popover") || t?.closest(".jh-btn-match")) return;
    closeMatchPopover();
  }

  function onPopoverKey(e: KeyboardEvent) {
    if (e.key === "Escape") closeMatchPopover();
  }

  function buildPopover(jobId: string, btn: HTMLElement) {
    document.querySelector(".jh-match-popover")?.remove();
    const matches = matchState.get(jobId) || [];
    const pop = document.createElement("div");
    pop.className = "jh-match-popover";
    const head = document.createElement("div");
    head.className = "jh-match-head";
    head.textContent = "Possible duplicates of this job";
    pop.appendChild(head);
    matches.forEach((m) => pop.appendChild(matchRow(jobId, m)));
    document.body.appendChild(pop);
    // Float on body and clamp to the viewport to avoid host layout clipping.
    const r = btn.getBoundingClientRect();
    const width = 320;
    pop.style.top = `${Math.round(r.bottom + 6)}px`;
    pop.style.left = `${Math.max(8, Math.min(Math.round(r.left), window.innerWidth - width - 8))}px`;
  }

  function matchRow(jobId: string, m: JobMatch): HTMLElement {
    const row = document.createElement("div");
    row.className = "jh-match-row";

    // Lead with description overlap, the strongest signal beyond title and company.
    const pct = document.createElement("div");
    pct.className = "jh-match-pct";
    const p = similarityPercent(m.similarity);
    if (p !== null) {
      pct.textContent = `${p}%`;
      pct.classList.add(
        p >= 70 ? "jh-match-pct--high" : p >= 40 ? "jh-match-pct--mid" : "jh-match-pct--low",
      );
      pct.title = `${p}% job-description overlap with the posting you're viewing`;
    } else {
      pct.textContent = "–";
      pct.classList.add("jh-match-pct--none");
      pct.title = "No description captured yet to compare";
    }

    // Status and posting count lead: a title-matched row's title equals the one on
    // screen, so it appears only when an application-destination match reworded it.
    const info = document.createElement("div");
    info.className = "jh-match-info";
    const primary = document.createElement("div");
    primary.className = "jh-match-primary";
    primary.textContent =
      JobFunnel.labelOf(m.status) + (m.listing_count > 1 ? ` · ${m.listing_count} postings` : "");
    info.appendChild(primary);
    const viewedTitle = matchIdentity.get(jobId)?.title;
    if (m.title && normalizeTitle(m.title) !== normalizeTitle(viewedTitle)) {
      const title = document.createElement("div");
      title.className = "jh-match-title";
      title.textContent = m.title;
      title.title = m.title;
      info.appendChild(title);
    }
    const sub = document.createElement("div");
    sub.className = "jh-match-sub";
    sub.textContent = matchSubtitle(m);
    info.appendChild(sub);
    const evidence = evidenceBlock(m);
    if (evidence) info.appendChild(evidence);

    // The top line gives the chip and subtitle the row's full width, so the action
    // buttons can't crush them to "Softwa…"; actions get their own line.
    const main = document.createElement("div");
    main.className = "jh-match-main";
    main.append(pct, info);

    const actions = document.createElement("div");
    actions.className = "jh-match-actions";

    // A real dashboard deep-link by stable job id. An <a>, so the browser colors it
    // visited for free once opened; the class is a belt-and-braces cue.
    const view = document.createElement("a");
    view.className = "jh-match-view";
    view.textContent = "view";
    view.href = `${DASHBOARD_URL}/?job=${encodeURIComponent(m.job_id)}`;
    view.target = "_blank";
    view.rel = "noopener";
    view.addEventListener("click", (e) => {
      e.stopPropagation();
      view.classList.add("jh-clicked");
    });

    const link = document.createElement("button");
    link.className = "jh-match-btn jh-match-link";
    link.textContent = "link";
    link.title = "Same job — fold this posting into it";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void linkToMatch(jobId, m, link);
    });

    const not = document.createElement("button");
    not.className = "jh-match-btn jh-match-not";
    not.textContent = "not a match";
    not.title = "Different job — stop suggesting this one";
    not.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void dismissMatch(jobId, m, not);
    });

    actions.append(view, link, not);
    row.append(main, actions);
    return row;
  }

  function matchSubtitle(m: JobMatch): string {
    const parts: string[] = [];
    if (m.created_at) parts.push("seen " + m.created_at.slice(0, 10));
    if (m.closed_at) parts.push("closed " + m.closed_at.slice(0, 10));
    const timing = timingText(m.timing);
    if (timing) parts.push(timing.toLowerCase());
    return parts.join(" · ");
  }

  // Agreeing checks share one line; each differing check gets its own with both values.
  function evidenceBlock(m: JobMatch): HTMLElement | null {
    const rows = evidenceRows(m.insights);
    if (!rows.length) return null;
    const box = document.createElement("div");
    box.className = "jh-match-evidence";
    const same = rows.filter((r) => r.same).map((r) => r.label);
    if (same.length) {
      const line = document.createElement("div");
      line.className = "jh-match-same";
      line.textContent = `✓ Same ${same.join(" · ")}`;
      box.appendChild(line);
    }
    for (const r of rows) {
      if (r.same) continue;
      const line = document.createElement("div");
      line.className = "jh-match-diff";
      line.textContent = `✗ ${r.label}: ${r.current} vs ${r.candidate}`;
      line.title = `${r.label}\nThis posting: ${r.current}\nCandidate: ${r.candidate}`;
      box.appendChild(line);
    }
    return box;
  }

  // The server chooses the merge survivor. Refresh remaining candidates and keep
  // the popover open because other suggestions may still apply.
  async function linkToMatch(jobId: string, m: JobMatch, btn: HTMLButtonElement) {
    const key = toNaturalKey(jobId);
    if (!key) return;
    btn.disabled = true;
    const resp = await engine.bridge({
      type: "link-job",
      platform: key.platform,
      platform_id: key.platform_id,
      other_job_id: m.job_id,
    });
    if (!resp.ok) {
      btn.disabled = false;
      engine.flashError(jobId);
      return;
    }
    // The posting may now resolve to a different survivor job, so force a reread for
    // the bar's status and refetch the remaining duplicates.
    void engine.refreshStates([jobId], { force: true }).then(() => engine.renderJob(jobId));
    // The merge reshaped job topology, so re-query rather than editing the cached set:
    // the authoritative answer drops the just-merged candidate and anything else the
    // server now excludes.
    void refreshMatches(jobId);
  }

  // "NOT the same job" — record the mutual exclusion so neither is suggested for the
  // other again, then drop it from the popover (closing the badge if it was the last).
  async function dismissMatch(jobId: string, m: JobMatch, btn: HTMLButtonElement) {
    const key = toNaturalKey(jobId);
    if (!key) return;
    btn.disabled = true;
    const resp = await engine.bridge({
      type: "false-match",
      platform: key.platform,
      platform_id: key.platform_id,
      other_job_id: m.job_id,
    });
    if (!resp.ok) {
      btn.disabled = false;
      engine.flashError(jobId);
      return;
    }
    matchState.set(
      jobId,
      (matchState.get(jobId) || []).filter((x) => x.job_id !== m.job_id),
    );
    renderOpenMatchUi(jobId); // updates the count, drops the row, closes an emptied popover
  }

  return {
    checkMatches,
    refreshMatches,
    closeMatchPopover,
    matchCompany: (jobId: string) => matchIdentity.get(jobId)?.company,
  };
}
