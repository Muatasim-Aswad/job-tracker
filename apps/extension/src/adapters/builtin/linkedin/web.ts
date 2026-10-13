import type { Adapter } from "../../types";
import type { ListingRecord } from "../../../messages";
import {
  type BannerChip,
  autoEmit,
  bannerSignature,
  captureListingOnce,
  checkMatches,
  closeMatchPopover,
  detailText,
  elementToText,
  emit,
  injectDetailButtons,
  isCompanyBlocked,
  keywordFindings,
  markListingClosed,
  placeBanner,
  refreshStates,
  renderJob,
  stateOf,
  toggleHidden,
  toNaturalKey,
} from "../../../engine.js";
import { JobFunnel } from "@job-tracker/shared/funnel";
import { postedFromExact, postedFromRelative } from "../../posted.js";
import { platformMeta } from "@job-tracker/shared/platforms";
import { fmtSpan } from "@job-tracker/shared/time";
import { ICON } from "../../../icons.js";
import { LINKEDIN_PREFIX, linkedinJobId, linkedinRenderKey } from "./identity.js";
import { type Workplace, parseWorkplace, subtitlePlace, tagCardLocation } from "./location.js";

// This adapter owns LinkedIn DOM knowledge. identity.ts owns render keys shared with
// Gmail; the shared platform registry owns canonical posting URLs.
const LINKEDIN = platformMeta("linkedin")!;
const PREFIX = LINKEDIN_PREFIX; // "LI-"
const postingUrl = (platformId: string) => LINKEDIN.buildUrl!(platformId)!;

// Full capture for LinkedIn search, jobs-tracker, and detail views.

// Layout C names each card `job-card-component-ref-<id>`. One constant, because the
// selector that finds the card and the slice that reads its id must agree.
const RESULTS_CARD_KEY = "job-card-component-ref-";
const RESULTS_CARD_SEL = `[componentkey^="${RESULTS_CARD_KEY}"]`;

// Selectors by layout: A is the classic search side panel, B standalone SDUI,
// and C SDUI search-results. jobDetailsId/applyButtonId are IDs; the rest are selectors.
const SEL = {
  // Support both concurrent classic top-card classes. Anchor to the button cluster;
  // its overflow button is named by visible text rather than aria-label.
  topCard:
    ".job-details-jobs-unified-top-card, .job-details-jobs-unified-top-card__container--two-pane",
  topButtons: ".job-details-jobs-unified-top-card__top-buttons",
  locationLine: ".job-details-jobs-unified-top-card__tertiary-description-container",
  moreOptions: 'button[aria-label="More options"]',
  componentKey: "[componentkey]",
  // Job-description container (resolved across both layouts, in order)
  jobDetailsId: "job-details",
  aboutJob: '[componentkey^="JobDetails_AboutTheJob"]',
  expandableText: '[data-testid="expandable-text-box"]',
  // Fit-level chips (layout A) — banner anchor + captured chips
  fitChips: ".job-details-fit-level-preferences",
  fitChipButtons: ".job-details-fit-level-preferences button",
  // Applied-state detection
  appliedLink:
    '#jobs-apply-see-application-link, .jobs-s-apply__application-link[href*="stage=applied"]',
  appliedFeedback: '.jobs-s-apply [role="alert"], .jobs-s-apply__application-link',
  // Apply control → apply_type
  applyButtonId: "jobs-apply-button-id",
  applyControl: 'a[aria-label*="on company website" i], [aria-label*="Easy Apply" i]',
  externalIcon:
    '[data-test-icon^="link-external"], [id^="link-external"], use[href^="#link-external"]',
  // Identity (layout A classes; layout B falls back to document.title + hrefs)
  companyLink: ".job-details-jobs-unified-top-card__company-name a",
  jobTitle: ".job-details-jobs-unified-top-card__job-title",
  companyAnchor: 'a[href*="/company/"]',
  // Captured meta
  salary: "#SALARY",
  matchLevel: ".job-details-fit-level-card .tvm__text--positive",
  posterName: ".hirer-card__hirer-information .jobs-poster__name",
  posterLink: ".hirer-card__hirer-information a",
  // Layout C's search cards. The id lives in this key and nowhere else on the card,
  // which is also what makes the key the surface's identifying marker.
  resultsCard: RESULTS_CARD_SEL,
  // Search-list cards
  searchCard: "li[data-occludable-job-id]",
  searchCardLink: 'a[aria-label][href*="/jobs/view/"]',
  // Search-card footers may provide an exact day in <time datetime="YYYY-MM-DD">.
  cardPostedTime: "time[datetime]",
  lockupSubtitle: ".artdeco-entity-lockup__subtitle",
  lockupCaption: ".artdeco-entity-lockup__caption",
  cardFooterState: ".job-card-container__footer-job-state",
  dismiss: '[aria-label^="Dismiss"]',
  // Layout C cards are flex rows; mount the bar in their inner column.
  // Only C carries componentkey, keeping the two selector alternatives disjoint.
  cardBody: `[class*="job-card-container"] > div:first-child, ${RESULTS_CARD_SEL} > div`,
  // jobs-tracker wall cards
  trackerJobLink: 'a[href*="/jobs/view/"]',
  overflowMenu: 'button[aria-label="Overflow menu"]',
} as const;

// Every list-card container. Page-wide scrapes of the open job must skip these.
const CARD_SCOPES = `${SEL.searchCard}, ${SEL.resultsCard}`;

// ── Identifier / URL ─────────────────────────────────────────────────────────
// The current LinkedIn detail-view job, from the standalone path OR the list-page
// side panel's `currentJobId` query param (so `seen` fires for both).
function currentDetailId(): string | null {
  const key = linkedinRenderKey(location.pathname);
  if (key) return key;
  const q = new URLSearchParams(location.search).get("currentJobId");
  return q ? PREFIX + q : null;
}

// Detail shortcuts are deliberate view actions, not site-wide hotkeys. A current
// LinkedIn id and its matching injected detail bar must both exist before the
// adapter consumes a chord. Editable controls keep Alt+letter for the host/browser.
function isEditableShortcutTarget(event: KeyboardEvent): boolean {
  return event
    .composedPath()
    .some(
      (target) =>
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable),
    );
}

function currentShortcutJobId(): string | null {
  const jobId = currentDetailId();
  const bar = document.querySelector<HTMLElement>(".jh-detail-actions[data-jh-job-id]");
  return jobId && bar?.dataset.jhJobId === jobId ? jobId : null;
}

// ── Detail DOM resolution (three layouts) ────────────────────────────────────
// Choose one layout from exclusive markers. B and C share AboutTheJob, so
// independent resolver detection would let B incorrectly claim C.
type Layout = "A" | "B" | "C";

// Classic #job-details takes priority over card-list markers shared with SDUI search.
function detectLayout(): Layout {
  if (document.getElementById(SEL.jobDetailsId)) return "A";
  if (document.querySelector(SEL.resultsCard)) return "C";
  return "B";
}

interface DetailIdentity {
  title: string | null;
  company: string | null;
  companyUrl: string | null;
}

// All detail consumers use this contract, keeping layout-specific DOM reads in one place.
interface DetailLayout {
  /** Where the detail action bar mounts; null when the layout offers no anchor. */
  anchor(): Element | null;
  /** The job-description container; null when the layout exposes none. */
  jd(): HTMLElement | null;
  /** Title, company and company url for the open job. */
  identity(): DetailIdentity;
  /** Put the head in this layout's quick-scan slot, up by the top card. */
  placeHead(head: HTMLElement, detail: HTMLElement): void;
}

// Only standalone views may use a page-wide overflow query; search pages also contain card buttons.
function pathScopedAnchor(): Element | null {
  return linkedinJobId(location.pathname) ? document.querySelector(SEL.moreOptions) : null;
}

// Identity for the SDUI layouts, which expose no stable classes for it.
// document.title is "Title | Company | LinkedIn"; split from the end so a title
// containing " | " still yields the right company.
function titleIdentity(): DetailIdentity {
  const segs = document.title.split(" | ");
  if (segs[segs.length - 1] === "LinkedIn") segs.pop();
  let company = segs.length >= 2 ? segs.pop()!.trim() : null;
  const title = segs.length ? segs.join(" | ").trim() : null;
  const companyA = document.querySelector(SEL.companyAnchor) as HTMLAnchorElement | null;
  if (!company) company = companyA?.textContent?.trim() || null;
  return { title, company, companyUrl: companyA?.href || null };
}

// SDUI descriptions render lazily; return the container even while empty so capture
// and the head retry. expandable-text-box is a fallback because span/p parsing can empty it.
function sduiJd(): HTMLElement | null {
  return (
    (document.querySelector(SEL.aboutJob) as HTMLElement | null) ||
    (document.querySelector(SEL.expandableText) as HTMLElement | null)
  );
}

// Mount inside the top card's content column; display:contents rows expose no inset to copy.
// Use the stable overflow button's grandparent, bounded by the card, or fall back.
function sduiPlaceHead(head: HTMLElement, detail: HTMLElement) {
  const topCard = standaloneTopCard();
  if (!topCard) {
    jdAdjacent(head, detail);
    return;
  }
  const column = detailAnchor()?.parentElement?.parentElement;
  (column && topCard.contains(column) ? column : topCard).appendChild(head);
}

// Every layout can fall back to placement immediately before the resolved description.
function jdAdjacent(head: HTMLElement, detail: HTMLElement) {
  const anchor = (detail.id ? detail : detail.parentElement) || detail;
  anchor.parentNode!.insertBefore(head, anchor);
}

const LAYOUTS: Record<Layout, DetailLayout> = {
  // A — the list/search side panel. Everything is addressable by class. The anchor
  // stays scoped to the detail top card because every list card in the same document
  // has its own "More options"; a page-wide query hits one of those and puts the bar
  // on a card.
  A: {
    anchor: () => {
      const topCard = document.querySelector(SEL.topCard);
      return (
        topCard?.querySelector(SEL.topButtons) ??
        topCard?.querySelector(SEL.moreOptions) ??
        pathScopedAnchor()
      );
    },
    jd: () => document.getElementById(SEL.jobDetailsId),
    identity: () => {
      const companyA = document.querySelector(SEL.companyLink) as HTMLAnchorElement | null;
      return {
        title: detailText(SEL.jobTitle),
        company: companyA?.textContent?.trim() || null,
        companyUrl: companyA?.href || null,
      };
    },
    // Before the fit-level chips, under the title.
    placeHead: (head, detail) => {
      const fitChips = document.querySelector(SEL.fitChips);
      if (fitChips) fitChips.parentNode!.insertBefore(head, fitChips);
      else jdAdjacent(head, detail);
    },
  },

  // B — the standalone /jobs/view/ SDUI page. No cards, so the page-wide anchor is
  // safe here.
  B: {
    anchor: pathScopedAnchor,
    jd: sduiJd,
    identity: titleIdentity,
    placeHead: sduiPlaceHead,
  },

  // C shares B's description layout but must select the overflow button outside every card.
  C: {
    anchor: () =>
      [...document.querySelectorAll(SEL.moreOptions)].find((b) => !b.closest(SEL.resultsCard)) ??
      null,
    jd: sduiJd,
    identity: titleIdentity,
    placeHead: sduiPlaceHead,
  },
};

// Resolved per call, never cached: LinkedIn swaps between these layouts by SPA
// navigation, with no document load to invalidate a cached answer.
const detailLayout = () => LAYOUTS[detectLayout()];
const detailAnchor = () => detailLayout().anchor();
const detailElement = () => detailLayout().jd();
const detailIdentity = () => detailLayout().identity();

// These signals belong to the open job's top card, never recommendations or the JD.
function scanJobSignals(detail: HTMLElement | null) {
  let applicants: number | null = null; // parsed integer count, when a number is shown
  let applyClicksShown = false; // "N people clicked apply" present (may be 100+)
  let postedAge: string | null = null; // e.g. "17 days ago"
  const topCard = detailTopCard();
  topCard?.querySelectorAll("p, span").forEach((el) => {
    if (el === detail || detail?.contains(el) || el.closest(CARD_SCOPES + ", .jh-detail-head")) {
      return;
    }
    const t = el.textContent!.trim();
    if (!applyClicksShown && /clicked apply/i.test(t)) {
      applyClicksShown = true;
      const numM = t.match(/(\d[\d,]*)\s+people/i);
      if (numM) applicants = Number(numM[1].replace(/,/g, ""));
    }
    // The phrase can be prefixed with "Reposted" or share a node with badges and
    // applicants. Keep only its age evidence for the shared date parser.
    postedAge ??= postingAge(t);
  });
  return { applicants, applyClicksShown, postedAge, location: topCardLocation(topCard) };
}

function detailTopCard(): Element | null {
  return (
    document.querySelector(SEL.topCard) ??
    standaloneTopCard() ??
    detailAnchor()?.parentElement ??
    null
  );
}

function postingAge(text: string): string | null {
  return (
    text.match(
      /\b(?:(?:reposted|posted)\s+)?(?:\d+\+?|an?)\s+(?:minute|hour|day|week|month|year)s?\s+ago\b|\bjust now\b/i,
    )?.[0] ?? null
  );
}

function locationPart(text: string): string | null {
  const value = text.replace(/\s+/g, " ").trim();
  if (
    !value ||
    postingAge(value) ||
    /\b(?:applicants?|clicked apply|promoted|responses? managed|actively recruiting)\b/i.test(
      value,
    ) ||
    /^(?:full-time|part-time|contract|internship|easy apply|apply|save)$/i.test(value) ||
    parseWorkplace(value)
  ) {
    return null;
  }
  return value;
}

// Classic pages name the location row. SDUI renders it as a paragraph, either
// joined to the age or immediately after the title, with promotion badges on a
// separate row. Neither path needs an age to be present.
function topCardLocation(topCard: Element | null): string | null {
  if (!topCard) return null;
  const namedLine = topCard.querySelector(SEL.locationLine);
  const title = detailIdentity().title;
  const titleEl =
    topCard.querySelector(SEL.jobTitle + ", h1, h2") ??
    [...topCard.querySelectorAll('a[href*="/jobs/view/"], p')].find(
      (el) => el.textContent!.trim() === title,
    );
  const rows = namedLine ? [namedLine] : [...topCard.querySelectorAll("p")];
  for (const row of rows) {
    if (
      row.closest(CARD_SCOPES + ", .jh-detail-head") ||
      row.querySelector("a, button") ||
      (titleEl && row.contains(titleEl))
    ) {
      continue;
    }
    const text = row.textContent!;
    const followsTitle =
      titleEl && Boolean(titleEl.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!namedLine && !text.includes("·") && !followsTitle) continue;
    for (const part of text.split("·")) {
      const place = locationPart(part);
      if (place) return place;
    }
  }
  return null;
}

// Workplace is a chip of its own on the detail page: a fit-level button in layout A,
// a span or link inside the SDUI top card. Scoped to those, because the search page's
// filter bar can carry the same words.
function detailWorkplace(): Workplace | null {
  const scopes = [
    document.querySelector(SEL.fitChips),
    document.querySelector(SEL.topCard),
    standaloneTopCard(),
  ];
  for (const scope of scopes) {
    for (const el of scope?.querySelectorAll("span, button, a") ?? []) {
      const workplace = parseWorkplace(el.textContent!);
      if (workplace) return workplace;
    }
  }
  return null;
}

// A same-document search card can pin an exact day for the open detail; otherwise
// posting age stays an estimate. Optional evidence — promoted and occluded cards
// may expose no date.
function listCardPostedDay(platformId: string): string | null {
  const card = document.querySelector(`li[data-occludable-job-id="${platformId}"]`);
  const time = card?.querySelector(SEL.cardPostedTime);
  return time?.getAttribute("datetime")?.trim() || null;
}

// Fresh enough that competition has not built up, against clearly cooled. Whole days,
// so the tint cannot disagree with the "3d" the chip shows.
const AGE_FRESH_DAYS = 7;
const AGE_COOLED_DAYS = 21;
const DAY_MS = 86_400_000;
// Where LinkedIn stops counting and renders "100+" instead of a number.
const APPLY_CLICK_CAP = 100;

// Use the shared age parser so hours cannot read as days. Unparseable text stays untinted.
function ageChip(postedAge: string): BannerChip {
  const title = "Posted " + postedAge;
  const { at } = postedFromRelative(postedAge, new Date().toISOString());
  if (!at) return { text: postedAge, title };
  const days = (Date.now() - new Date(at).getTime()) / DAY_MS;
  const tone = days <= AGE_FRESH_DAYS ? "good" : days <= AGE_COOLED_DAYS ? "warn" : "faded";
  return { text: fmtSpan(at), tone, title };
}

// ── Detail head (warnings banner + copy button) ──────────────────────────────
// The top-card head shares placement and deduplication for warnings and Copy Job Description.
// Both wait for the description; a clean posting shows only the copy button.
function renderDetailHead(detail: HTMLElement) {
  // elementToText, not raw textContent, so block boundaries are newlined — the banner
  // clips each keyword's context to its own line and can't run into the next paragraph.
  const text = elementToText(detail);
  if (!text) return; // no JD → neither banner nor copy button

  // Keyword findings, header analytics, and the block flag. All may be empty;
  // placeBanner then adds nothing and the head is just the copy button.
  const findings = keywordFindings(text);
  const chips: BannerChip[] = [];
  const alerts: string[] = [];
  // The two things here that are wrong rather than merely worth knowing. Closed sorts
  // first: it decides whether the rest is worth reading at all.
  if (listingClosed()) alerts.push("closed to applications");
  // Explain why a blocked listing is not captured.
  const { company } = detailIdentity();
  if (isCompanyBlocked(company, "linkedin")) alerts.push("blocked company");
  // Always show stated header analytics; omission must mean missing evidence, not a threshold.
  const { applicants, applyClicksShown, postedAge } = scanJobSignals(detail);
  if (postedAge) chips.push(ageChip(postedAge));
  if (applyClicksShown) {
    // LinkedIn counts openings of the apply flow, not submitted applications.
    // Tint only at the counting cap; the tooltip carries the full label.
    const saturated = applicants == null || applicants >= APPLY_CLICK_CAP;
    const count = applicants ?? APPLY_CLICK_CAP + "+";
    chips.push({
      text: count + " clicks",
      title: saturated
        ? `Applications have saturated — LinkedIn stops counting at ${APPLY_CLICK_CAP}`
        : `${count} people clicked apply`,
      ...(saturated ? { tone: "warn" as const } : {}),
    });
  }

  // Include scraped content in deduplication because analytics and descriptions arrive separately.
  // Preserve transient Copied feedback when the scrape is unchanged.
  const content = { chips, findings, alerts };
  const signature = bannerSignature(content);
  const existing = document.querySelector(".jh-detail-head") as HTMLElement | null;
  if (existing) {
    if (existing.dataset.jhSignature === signature) return;
    existing.remove();
  }
  const head = document.createElement("div");
  head.className = "jh-detail-head";
  head.dataset.jhSignature = signature;
  placeBanner(content, head, { position: "append" });

  head.appendChild(makeCopyButton());

  // Each layout supplies a top-card slot, with the description as fallback.
  detailLayout().placeHead(head, detail);
}

// Re-read the live detail at click time so SPA updates reach the clipboard.
// Report clipboard failure distinctly from success.
const COPY_LABEL = "Copy Job Description";
function makeCopyButton(): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "jh-banner-copy";
  btn.title = "Copy the job title, company, link and description";
  btn.innerHTML = `${ICON.copy}<span class="jh-banner-copy-label">${COPY_LABEL}</span>`;
  const label = btn.querySelector(".jh-banner-copy-label") as HTMLElement;
  let resetTimer: number | undefined;
  // Keep confirmation visible for keyboard clicks and after hover ends; the resting button is icon-only.
  const flash = (msg: string) => {
    label.textContent = msg;
    btn.classList.add("jh-copy-flashing");
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      label.textContent = COPY_LABEL;
      btn.classList.remove("jh-copy-flashing");
    }, 1500);
  };
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = buildCopyText();
    if (!text) {
      flash("Nothing to copy");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => flash("Copied ✓"),
      () => flash("Copy failed"),
    );
  });
  return btn;
}

// The clipboard payload, from the live detail pane. Null when the JD is gone, so the
// button reports "Nothing to copy" rather than putting a bare header out.
function buildCopyText(): string | null {
  const jd = elementToText(detailElement());
  if (!jd) return null;
  const { title, company } = detailIdentity();
  const key = toNaturalKey(currentDetailId() || "");
  const url = key ? postingUrl(key.platform_id) : location.href;
  const header = [title, company].filter(Boolean).join(" — ");
  return [...(header ? [header] : []), url, "", jd].join("\n");
}

// SDUI classes are unstable. Find the top card via its stable overflow button,
// bounded by the nearest componentkey panel; unexpected trees return null for fallback.
function standaloneTopCard(): Element | null {
  const mo = detailAnchor();
  const panel = mo?.closest(SEL.componentKey) ?? null;
  if (!mo || !panel) return null;
  let el: Element = mo;
  while (el.parentElement && el.parentElement !== panel) el = el.parentElement;
  return el.parentElement === panel ? el : null;
}

// ── Auto-detects (applied / closed) ──────────────────────────────────────────
function detectApplied(jobId: string) {
  const hasLegacyStatus =
    [...document.querySelectorAll("h2")].some(
      (el) => el.textContent?.trim().toLowerCase() === "application status",
    ) &&
    [...document.querySelectorAll("p")].some((el) =>
      /^(Applied\b|Application submitted)/i.test(el.textContent!.trim()),
    );

  // List/search detail pane uses a success feedback block + "See application" link,
  // and often does not render the legacy "Application status" heading.
  const hasAppliedLink = Boolean(document.querySelector(SEL.appliedLink));
  const hasAppliedFeedback = [...document.querySelectorAll(SEL.appliedFeedback)].some((el) =>
    /\b(Applied\b|Application submitted)\b/i.test(el.textContent!.trim()),
  );

  if (hasLegacyStatus || hasAppliedLink || hasAppliedFeedback) void autoEmit(jobId, "applied");
}

// Closure detection and the head alert share this predicate so their states agree.
function listingClosed() {
  return [...document.querySelectorAll("p")].some(
    (el) => el.textContent!.trim() === "No longer accepting applications",
  );
}

// A removed posting has no detail anchor or description, so LinkedIn's paired error
// copy is the only durable signal. Keep the two exact siblings coupled: the generic
// heading alone also appears for transient page failures that must remain retryable.
function listingUnavailable() {
  const main = document.querySelector("main");
  if (!main) return false;
  return [...main.querySelectorAll("h1, h2")].some(
    (heading) =>
      heading.textContent?.trim() === "Unable to load the page" &&
      [...(heading.parentElement?.children ?? [])].some(
        (sibling) =>
          sibling.tagName === "P" &&
          sibling.textContent?.trim() ===
            "Job id provided may not be valid or the job posting has been removed.",
      ),
  );
}

async function closeTrackedUnavailableListing(jobId: string) {
  // The closure write is an upsert, while anyone can type a nonexistent LinkedIn id.
  // Resolve it first so an error page cannot create a titleless tracker record.
  const statesAvailable = await refreshStates([jobId]);
  if (!statesAvailable || stateOf(jobId).status === "untracked") return;
  await markListingClosed(jobId);
}

function detectClosed(jobId: string) {
  if (listingClosed()) markListingClosed(jobId).catch(() => {});
}

// ── Listing capture ──────────────────────────────────────────────────────────
// Both layouts expose the current job's apply type through the apply control.
// Inconclusive results stay unknown rather than polluting analytics.
function applyControl(): Element | null {
  return document.getElementById(SEL.applyButtonId) || document.querySelector(SEL.applyControl);
}

function detectApplyType(): string {
  const btn = applyControl();
  if (!btn) return "unknown";
  const label = (btn.getAttribute("aria-label") || "") + " " + (btn.textContent || "");
  if (/easy apply/i.test(label)) return "easy_apply";
  if (/on company website/i.test(label) || btn.querySelector(SEL.externalIcon)) {
    return "external";
  }
  return "unknown";
}

function isLinkedInHost(hostname: string): boolean {
  return hostname === "linkedin.com" || hostname.endsWith(".linkedin.com");
}

// External apply links may be direct or wrapped in LinkedIn's safety redirect. Keep
// the destination, not the short-lived wrapper, and reject non-web protocols.
function detectApplyUrl(): string | null {
  const control = applyControl();
  if (!control || detectApplyType() !== "external") return null;
  const anchor = control.matches("a[href]")
    ? (control as HTMLAnchorElement)
    : control.querySelector<HTMLAnchorElement>("a[href]");
  if (!anchor) return null;

  try {
    const href = new URL(anchor.href, location.href);
    const redirectTarget = isLinkedInHost(href.hostname) ? href.searchParams.get("url") : null;
    const destination = redirectTarget ? new URL(redirectTarget) : href;
    if (!["http:", "https:"].includes(destination.protocol)) return null;
    return isLinkedInHost(destination.hostname) ? null : destination.href;
  } catch {
    return null;
  }
}

// Uncertain or absent platform facts belong in metadata; natural identity stays in core columns.
function captureDetail(jobId: string): ListingRecord | null {
  const key = toNaturalKey(jobId);
  if (!key) return null;
  const detail = detailElement();
  const { title, company, companyUrl } = detailIdentity();

  const { applicants, postedAge, location } = scanJobSignals(detail);

  // Prefer the card's absolute date; otherwise anchor the relative age to capture
  // time and retain the original text as evidence.
  const capturedAt = new Date().toISOString();
  const cardDay = listCardPostedDay(key.platform_id);
  const posted = cardDay ? postedFromExact(cardDay) : postedFromRelative(postedAge, capturedAt);
  const applyUrl = detectApplyUrl();

  return {
    ...key,
    url: postingUrl(key.platform_id),
    title,
    company,
    apply_type: detectApplyType(),
    meta: {
      company_url: companyUrl,
      ...(applyUrl ? { apply_url: applyUrl } : {}),
      posted_at: posted.at,
      posted_precision: posted.precision,
      posted_age: postedAge,
      applicants,
      location,
      workplace: detailWorkplace(),
      salary: detailText(SEL.salary),
      match_level: detailText(SEL.matchLevel),
      chips: [...document.querySelectorAll(SEL.fitChipButtons)]
        .map((b) => b.textContent!.trim())
        .filter(Boolean),
      poster: detailText(SEL.posterName),
      poster_url:
        (document.querySelector(SEL.posterLink) as HTMLAnchorElement | null)?.href || null,
      description: elementToText(detail),
    },
  };
}

// Applied-wall dates have only relative ages. Anchor them to now at day precision
// so imports retain approximate event timing; missing or unusable evidence returns null.
const AGE_MS: Record<string, number> = {
  s: 1e3,
  m: 6e4,
  min: 6e4,
  h: 36e5,
  hr: 36e5,
  d: 864e5,
  w: 6048e5,
  mo: 2592e6,
  y: 31536e6,
  yr: 31536e6,
};
function appliedAgeToIso(cardText: string): string | null {
  // Anchored on "Applied" so a sibling "(Posted 4w ago)" can't be mistaken for it.
  // `mo`/`yr`/`hr`/`min` are matched before the single-letter units.
  const m = cardText.match(/Applied\s+(\d+)\s*(mo|yr|hr|min|[smhdwy])\b/i);
  if (!m) return null;
  const ms = AGE_MS[m[2].toLowerCase()];
  if (!ms) return null;
  return new Date(Date.now() - Number(m[1]) * ms).toISOString();
}

// ── The adapter ──────────────────────────────────────────────────────────────
export const linkedinAdapter: Adapter = {
  matches: (h) => h === "www.linkedin.com",
  // LinkedIn ids are "LI-<numeric>". Gmail's LinkedIn-email cards reuse this prefix,
  // so this resolves those too (Gmail has no natural key of its own).
  naturalKey: (id) =>
    id.startsWith(PREFIX) ? { platform: "linkedin", platform_id: id.slice(PREFIX.length) } : null,
  // Whole-site injection supports feed-to-jobs SPA transitions; activeOn limits actual scans.
  activeOn: (path) => path.startsWith("/jobs") || path.startsWith("/comm/jobs"),
  onKeyDown(event) {
    const key = event.key.toLowerCase();
    if (
      event.defaultPrevented ||
      event.repeat ||
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (key !== "h" && key !== "t") ||
      isEditableShortcutTarget(event)
    )
      return;
    const jobId = currentShortcutJobId();
    if (!jobId) return;
    if (key === "t" && !JobFunnel.canSet(stateOf(jobId).status, "to_apply")) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === "h") void toggleHidden(jobId);
    else void emit(jobId, "to_apply");
  },
  cardBodySelector: SEL.cardBody,
  scanDetail() {
    const jobId = currentDetailId();

    // Clean up bar (and any open match popover) from the previous job on SPA nav
    const existingBar = document.querySelector(".jh-detail-actions") as HTMLElement | null;
    if (existingBar && existingBar.dataset.jhJobId !== jobId) {
      existingBar.remove();
      closeMatchPopover();
    }

    // This is positive evidence that an existing listing disappeared, but it is not
    // a viewed job detail. Close only a known listing and skip `seen`, actions, and
    // match lookup for this scan.
    if (jobId && listingUnavailable()) {
      void closeTrackedUnavailableListing(jobId).catch(() => {});
      return;
    }

    // Buttons, auto-detects, and `seen` don't wait on the job description loading.
    if (jobId) {
      injectDetailButtons(jobId, detailAnchor());
      detectApplied(jobId);
      detectClosed(jobId);
      void autoEmit(jobId, "seen"); // opening the complete view = seen (monotonic, deduped)
      void refreshStates([jobId]).then(() => renderJob(jobId));
      // Repost guard: flag sibling jobs sharing this posting's title+company, so a
      // reposted listing isn't mistaken for a brand-new job (and re-applied to).
      const { title, company } = detailIdentity();
      void checkMatches(jobId, title, company);
    }

    // The head waits for a resolved description across all three layouts.
    const detail = detailElement();
    if (!detail) return;
    renderDetailHead(detail);
  },
  capture() {
    if (listingUnavailable()) return;
    captureListingOnce(currentDetailId(), captureDetail);
  },
  isAppliedCard(card) {
    // Layout C states this in a bare <p> with no class, sharing its slot with
    // "Viewed" and "Saved". Match the exact text: a substring test over the card also
    // hits a job titled "Applied AI Engineer", marking an untouched job as applied.
    if (detectLayout() === "C") {
      return [...card.querySelectorAll("p")].some((p) => p.textContent!.trim() === "Applied");
    }
    const state = card.querySelector(SEL.cardFooterState);
    return state?.textContent?.trim() === "Applied";
  },
  nativeDismiss(card) {
    const btn = card.querySelector(SEL.dismiss) as HTMLElement | null;
    return btn ? () => btn.click() : null;
  },
  // Every job on the jobs-tracker's ?stage=applied has been applied to. The other
  // stages (Saved / In Progress / Archived) don't map cleanly onto the funnel, so
  // only this one is a wall.
  wallStatus: () =>
    location.pathname.startsWith("/jobs-tracker") &&
    new URLSearchParams(location.search).get("stage") === "applied"
      ? "applied"
      : null,
  findCards(doc) {
    // The jobs-tracker is SDUI with hashed classes and no stable per-card attribute,
    // so the only durable hook is the /jobs/view/{id}/ anchor wrapping each card.
    // Every job here is applied, so `jhWall` marks it for the autoWallCards sweep,
    // and forcing "dim" keeps resolved cards from vanishing in "remove" mode.
    if (location.pathname.startsWith("/jobs-tracker")) {
      const cards: HTMLElement[] = [];
      doc.querySelectorAll(SEL.trackerJobLink).forEach((a) => {
        const renderKey = linkedinRenderKey(a.getAttribute("href") || "");
        if (!renderKey) return;
        // The card is the nearest ancestor also holding the row's "Overflow menu",
        // where LinkedIn's own actions live, so our bar renders alongside them rather
        // than clipped inside the thin <a>. The depth bound stops a rail anchor from
        // climbing to the whole-list container; fall back to the wrapper if none.
        let card: HTMLElement | null = null;
        for (let node = a.parentElement, i = 0; node && i < 6; node = node.parentElement, i++) {
          if (node.querySelector(SEL.overflowMenu)) {
            card = node;
            break;
          }
        }
        card = card || (a.parentElement as HTMLElement) || (a as unknown as HTMLElement);
        // Per-element, not per-id: the list renders a job more than once (left rail +
        // main pane) and each tile needs its own bar, since renderJob fans out by id.
        // The guard skips a copy already tagged this session.
        if (card.dataset.jhId) return;
        // Card lines in the anchor: P1 is the title, the "Company · Location
        // (Workplace)" line gives company and location.
        const ps = [...a.querySelectorAll("p")].map((p) => p.textContent!.trim());
        const subtitle = ps.find((t) => t.includes("·"));
        card.dataset.jhId = renderKey;
        card.dataset.jobUrl = (a as HTMLAnchorElement).href;
        card.dataset.jobTitle = ps[0] || "";
        card.dataset.jobCompany = subtitle ? subtitle.split("·")[0].trim() : "";
        tagCardLocation(card, subtitlePlace(subtitle));
        card.dataset.jhForceMode = "dim";
        card.dataset.jhWall = "1";
        // Date the auto-`applied` sweep from the row's "Applied N ago" age so a bulk
        // import isn't clustered at now(). autoWallCards reads jhTs.
        const ts = appliedAgeToIso(card.innerText);
        if (ts) card.dataset.jhTs = ts;
        cards.push(card);
      });
      return cards;
    }

    // Layout C's cards carry no anchor — clicking one rewrites `currentJobId` — so
    // the id comes from the componentkey, the only place it appears, and the url is
    // rebuilt from it. Title, company and location are positional, no class or aria
    // naming them.
    if (detectLayout() === "C") {
      const cards: HTMLElement[] = [];
      doc.querySelectorAll(SEL.resultsCard).forEach((el) => {
        const card = el as HTMLElement;
        // Only the outer duplicate wrapper has role=button; tagging both would inject two bars.
        if (card.getAttribute("role") !== "button" || card.dataset.jhId) return;
        const id = card.getAttribute("componentkey")!.slice(RESULTS_CARD_KEY.length);
        if (!id) return;
        const [title, company, place] = [...card.querySelectorAll("p")].map((p) =>
          p.textContent!.trim(),
        );
        card.dataset.jhId = PREFIX + id;
        card.dataset.jobUrl = postingUrl(id);
        card.dataset.jobTitle = title || "";
        card.dataset.jobCompany = company || "";
        tagCardLocation(card, place);
        // As tight as the classic search list, so the bar folds Open into the ⋯ menu.
        card.dataset.jhCompact = "1";
        cards.push(card);
      });
      return cards;
    }

    const cards: HTMLElement[] = [];
    doc.querySelectorAll(SEL.searchCard).forEach((li) => {
      const el = li as HTMLElement;
      if (el.dataset.jhId) return;
      const id = el.dataset.occludableJobId;
      const a = el.querySelector(SEL.searchCardLink) as HTMLAnchorElement | null;
      if (!a) return;
      el.dataset.jhId = PREFIX + id;
      el.dataset.jobUrl = a.href;
      el.dataset.jobTitle = a.getAttribute("aria-label") || "";
      el.dataset.jobCompany = el.querySelector(SEL.lockupSubtitle)?.textContent?.trim() || "";
      tagCardLocation(el, el.querySelector(SEL.lockupCaption)?.textContent);
      // Compact search cards fold Open into the overflow menu; wall and detail bars keep it inline.
      el.dataset.jhCompact = "1";
      cards.push(el);
    });
    return cards;
  },
};
