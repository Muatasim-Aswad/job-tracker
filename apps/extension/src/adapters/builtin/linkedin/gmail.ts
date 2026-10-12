import type { Adapter } from "../../types";
import { platformMeta } from "@job-tracker/shared/platforms";
import { LINKEDIN_PREFIX, linkedinRenderKey } from "./identity.js";
import { subtitlePlace, tagCardLocation } from "./location.js";

const LINKEDIN = platformMeta("linkedin")!;
let emailGroupSequence = 0;

// Gmail job links reuse LinkedIn render keys, resolved by the web adapter.

// Gmail selectors: messageScope bounds each email; dateCarriers hold received dates.
// jobLink covers title links and profile-match cards, including saferedirecturl wrappers.
// cardBody is the action-bar cell; discovery tags one-cell profile-match cards.
const SEL = {
  body: ".a3s",
  messageScope: '.gs, [data-message-id], [role="listitem"]',
  dateCarriers: "[title], [aria-label], [data-tooltip]",
  cardBody: 'td[valign="top"]:not([width="48"]), .jh-email-job-body',
  jobLink:
    'a[style*="font-size:16px"][href*="jobs/view/"],' +
    'a[style*="font-size:16px"][data-saferedirecturl*="jobs/view/"],' +
    'a[href*="jobs/view/"][href*="email_jobs_qualification_board"][href*="job_card_"],' +
    'a[data-saferedirecturl*="jobs/view/"][data-saferedirecturl*="email_jobs_qualification_board"][data-saferedirecturl*="job_card_"]',
  logo: "img[alt]",
} as const;

// Read received time from header attributes, requiring a year or H:MM to reject
// unrelated tooltips. Shared by rejection sweeps and popup date suggestions.
function messageDate(body: HTMLElement): string | null {
  let scope: HTMLElement = body;
  let node: HTMLElement | null = body;
  for (let i = 0; node && i < 8; node = node.parentElement, i++) {
    if (node.matches(SEL.messageScope)) {
      scope = node;
      break;
    }
  }
  for (const el of [...scope.querySelectorAll(SEL.dateCarriers)]) {
    const raw =
      el.getAttribute("title") ||
      el.getAttribute("aria-label") ||
      el.getAttribute("data-tooltip") ||
      "";
    if (!/\d{4}|\d{1,2}:\d{2}/.test(raw)) continue; // needs a year or a clock time
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  return null;
}

// Provider tracking URLs classify messages without translated body text or user labels.
// Match the rejection template stem, ignoring its numeric version; other application
// updates must never count as rejections.
function emailWallStatus(body: HTMLElement): string | null {
  if (/email_jobs_application_rejected(?:_\d+)?\b/i.test(body.innerHTML)) return "rejected";
  return null;
}

// Alert digests, viewed-job reminders, and profile-match recommendations carry
// stable provider-owned template tokens in their tracking URLs. All are discovery
// lists, unlike rejection mails whose similar-job cards share some card markup.
function supportsBulkOpen(body: HTMLElement): boolean {
  return /email_(?:job_alert(?:_digest)?|jobs_(?:viewed_job_reminder|qualification_board))(?:_\d+)?\b/i.test(
    body.innerHTML,
  );
}

function alertCards(group: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-jh-email-group="${group}"]`)].filter(
    (card) =>
      ["jh-hidden", "jh-removed", "jh-resolved"].every(
        (className) => !card.classList.contains(className),
      ),
  );
}

function alertUrls(group: string): string[] {
  return [
    ...new Set(
      alertCards(group).flatMap((card) => {
        const renderKey = card.dataset.jhId || "";
        if (!renderKey.startsWith(LINKEDIN_PREFIX)) return [];
        const url = LINKEDIN.buildUrl?.(renderKey.slice(LINKEDIN_PREFIX.length));
        return url ? [url] : [];
      }),
    ),
  ];
}

function renderAlertButton(button: HTMLButtonElement) {
  const ready = button.dataset.jhStatesReady === "1";
  const count = ready ? alertUrls(button.dataset.jhEmailGroup || "").length : 0;
  button.textContent = `Open new jobs (${count})`;
  button.disabled = !ready || count === 0 || button.dataset.jhOpening === "1";
}

function injectAlertButton(body: HTMLElement, group: string) {
  const actions = document.createElement("div");
  actions.className = "jh-actions jh-email-alert-actions";
  const button = document.createElement("button");
  button.className = "jh-btn jh-btn-open-alert";
  button.dataset.jhEmailGroup = group;
  button.dataset.jhStatesReady = "0";
  button.title = "Open the unaffected jobs in background tabs";
  renderAlertButton(button);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const urls = alertUrls(group);
    if (!urls.length) return;
    button.dataset.jhOpening = "1";
    renderAlertButton(button);
    chrome.runtime.sendMessage({ type: "open-job-tabs", urls }, (response) => {
      button.dataset.jhOpening = "0";
      button.classList.toggle("jh-error", !!chrome.runtime.lastError || !response?.ok);
      renderAlertButton(button);
    });
  });
  actions.appendChild(button);
  body.insertAdjacentElement("afterbegin", actions);
}

// Gmail — LinkedIn job-list / rejection emails rendered in the inbox. DOM-only
// (no detail capture), so it imports no engine helpers.
export const gmailAdapter: Adapter = {
  matches: (h) => h === "mail.google.com",
  cardBodySelector: SEL.cardBody,
  // Suggest the open message's received time for manual status recording; list views return null.
  openEventDate() {
    const body = document.querySelector(SEL.body) as HTMLElement | null;
    return body ? messageDate(body) : null;
  },
  renderPageActions(statesAvailable) {
    document.querySelectorAll<HTMLButtonElement>(".jh-btn-open-alert").forEach((button) => {
      if (statesAvailable !== undefined) {
        button.dataset.jhStatesReady = statesAvailable ? "1" : "0";
      }
      renderAlertButton(button);
    });
  },
  findCards(doc) {
    const cards: HTMLElement[] = [];

    function findJobRow(link: Element, qualificationBoard: boolean): HTMLElement | null {
      if (qualificationBoard) {
        const row = link.closest("tr") as HTMLElement | null;
        const cells = row ? [...row.children].filter((child) => child.tagName === "TD") : [];
        return cells.length === 1 ? row : null;
      }
      let node = link.parentElement;
      while (node && node.tagName !== "BODY") {
        if (node.tagName === "TR") {
          const tds = [...node.children].filter((c) => c.tagName === "TD");
          if (tds.length === 2 && tds[0].getAttribute("width") === "48") return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    function findJobCard(jobRow: HTMLElement): HTMLElement {
      let node = jobRow.parentElement;
      while (node && node.tagName !== "BODY") {
        if (node.tagName === "TR") {
          const firstTd = [...node.children].find((c) => c.tagName === "TD");
          if (firstTd && (firstTd.getAttribute("style") || "").includes("padding-top")) return node;
        }
        node = node.parentElement;
      }
      return jobRow;
    }

    doc.querySelectorAll(`${SEL.body}:not([data-jh-scanned])`).forEach((body) => {
      (body as HTMLElement).dataset.jhScanned = "1";
      const bulkOpen = supportsBulkOpen(body as HTMLElement);
      const emailGroup = bulkOpen ? String(++emailGroupSequence) : "";
      const emailCards: HTMLElement[] = [];
      const ts = messageDate(body as HTMLElement); // once per email; applied below
      const wallStatus = emailWallStatus(body as HTMLElement); // the email's own type, once
      body.querySelectorAll(SEL.jobLink).forEach((link) => {
        const src =
          (link.getAttribute("href") || "") + (link.getAttribute("data-saferedirecturl") || "");
        const renderKey = linkedinRenderKey(src);
        if (!renderKey) return;
        const qualificationBoard = /email_jobs_qualification_board/i.test(src);

        const jobRow = findJobRow(link, qualificationBoard);
        if (!jobRow) return;

        const card = qualificationBoard ? jobRow : findJobCard(jobRow);
        if (!card || card.dataset.jhId) return;
        if (qualificationBoard) {
          card.querySelector(":scope > td:only-child")?.classList.add("jh-email-job-body");
        }

        card.dataset.jhId = renderKey;
        if (bulkOpen) card.dataset.jhEmailGroup = emailGroup;
        card.dataset.jobUrl = link.getAttribute("href") || "";
        // Subtitle line is "Company · Location (Workplace)"; fall back to the
        // company logo's alt text.
        const subtitle = [...card.querySelectorAll("p")]
          .map((p) => p.textContent!.trim())
          .find((t) => t.includes("·"));
        card.dataset.jobTitle = (
          subtitle ? link.textContent!.replace(subtitle, "") : link.textContent
        )!.trim();
        card.dataset.jobCompany = subtitle
          ? subtitle.split("·")[0].trim()
          : card.querySelector(SEL.logo)?.getAttribute("alt")?.trim() || "";
        tagCardLocation(card, subtitlePlace(subtitle));
        // Reject only cards whose email template and applied_job link both identify a rejection.
        // Recommendation cards keep normal triage; force dim only on the rejected job so it stays readable.
        if (wallStatus && /applied_job/.test(src)) {
          card.dataset.jhWall = "1";
          card.dataset.jhWallStatus = wallStatus;
          card.dataset.jhForceMode = "dim";
          if (ts) card.dataset.jhTs = ts; // the sweep reads jhTs
        }
        cards.push(card);
        emailCards.push(card);
      });
      if (bulkOpen && emailCards.length) injectAlertButton(body as HTMLElement, emailGroup);
    });

    return cards;
  },
};
