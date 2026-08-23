// Fixture tests keep selector drift from silently stopping capture.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { linkedinAdapter } from "./web";
import { stateOf } from "../../../engine";
import { setAdapters } from "../../../registry";
import { installFakeChrome } from "../../../test-support/fakeChrome";
import { installCssEscape } from "../../../test-support/cssEscape";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const loadFixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

beforeEach(() => {
  setAdapters([linkedinAdapter]);
  installCssEscape();
});

describe("linkedin adapter — search list findCards", () => {
  it("tags a card with its NaturalKey and scraped title/company", () => {
    document.body.innerHTML = loadFixture("linkedin-search-card.html");

    const cards = linkedinAdapter.findCards(document);

    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card.dataset.jhId).toBe("LI-100001");
    expect(card.dataset.jobTitle).toBe("Example Backend Engineer at Example Labs");
    expect(card.dataset.jobCompany).toBe("Example Labs · Example City, Exampleland (Hybrid)");
    expect(card.dataset.jhCompact).toBe("1");
    expect(card.dataset.jobUrl).toBe(
      "https://www.linkedin.com/jobs/view/100001/?refId=example&trackingId=example",
    );

    expect(linkedinAdapter.naturalKey!(card.dataset.jhId!)).toEqual({
      platform: "linkedin",
      platform_id: "100001",
    });
  });
});

describe("linkedin adapter — detail head", () => {
  const chipTexts = () =>
    [...document.querySelectorAll(".jh-detail-head .jh-banner-chip")].map((c) => c.textContent);

  // The top card's analytics render independently of the job description, so a scan
  // can reach the head before the applicant count is on the page. The head has to
  // pick it up on a later pass; keying the rebuild on the URL alone left the count
  // missing for the whole visit.
  it("adds a chip whose signal renders after the first pass", () => {
    document.body.innerHTML = loadFixture("linkedin-detail.html");
    window.history.pushState({}, "", "/jobs/view/100001/");
    installFakeChrome();
    const applicants = [...document.querySelectorAll("span")].find((el) =>
      el.textContent!.includes("clicked apply"),
    )!;
    applicants.remove();

    linkedinAdapter.scanDetail!();
    expect(chipTexts()).toEqual(["17d"]);

    document
      .querySelector(".job-details-jobs-unified-top-card__container--two-pane")!
      .appendChild(applicants);
    linkedinAdapter.scanDetail!();

    expect(chipTexts()).toEqual(["17d", "25 clicks"]);
  });

  // The chip's own text is the fact; the tint only ranks it. Reading the unit is what
  // separates the two — a plain leading number calls a 16-hour-old posting 16 days old.
  it.each([
    ["16 hours ago", "16h", "jh-banner-chip--good"],
    ["17 days ago", "17d", "jh-banner-chip--warn"],
    // Days, not "2 months ago": a calendar month's length would move the expectation.
    ["40 days ago", "40d", "jh-banner-chip--faded"],
  ])("tints a posting of %s by its real age", (age, text, tone) => {
    document.body.innerHTML = loadFixture("linkedin-detail.html");
    window.history.pushState({}, "", "/jobs/view/100001/");
    installFakeChrome();
    const posted = [...document.querySelectorAll("span")].find(
      (el) => el.textContent!.trim() === "17 days ago",
    )!;
    posted.textContent = age;

    linkedinAdapter.scanDetail!();

    const chip = document.querySelector(".jh-detail-head .jh-banner-chip")!;
    expect(chip.textContent).toBe(text);
    expect(chip.classList.contains(tone)).toBe(true);
    expect((chip as HTMLElement).title).toBe("Posted " + age);
  });

  // An ordinary job raises no ⚠ at all. Box stacking across all three kinds is covered
  // in dom.test.ts, where a policy is loaded; this fixture's storage never lands one,
  // so it yields no keyword findings.
  it("shows a quiet stats strip and no ⚠ on an ordinary job", () => {
    document.body.innerHTML = loadFixture("linkedin-detail.html");
    window.history.pushState({}, "", "/jobs/view/100001/");
    installFakeChrome();

    linkedinAdapter.scanDetail!();

    const boxes = [...document.querySelectorAll(".jh-detail-banner > *")].map((b) => b.className);
    expect(boxes).toEqual(["jh-banner-stats"]);
    expect(document.querySelector(".jh-banner-icon")).toBeNull();
  });

  it("tints the apply-click count only at LinkedIn's cap", () => {
    document.body.innerHTML = loadFixture("linkedin-detail.html");
    window.history.pushState({}, "", "/jobs/view/100001/");
    installFakeChrome();
    const clicks = [...document.querySelectorAll("span")].find((el) =>
      el.textContent!.includes("clicked apply"),
    )!;
    const lastChip = () => [...document.querySelectorAll(".jh-banner-chip")].at(-1)!;

    linkedinAdapter.scanDetail!();
    // Below the cap the number is role-dependent: stated, not ranked.
    expect(lastChip().textContent).toBe("25 clicks");
    expect(lastChip().className).toBe("jh-banner-chip");

    clicks.textContent = "Over 100 people clicked apply for this job";
    linkedinAdapter.scanDetail!();

    expect(lastChip().textContent).toBe("100 clicks");
    expect(lastChip().classList.contains("jh-banner-chip--warn")).toBe(true);
  });

  // The same sign that closes the job automatically. Reading it twice from one
  // predicate is what keeps the alert from claiming a state the funnel disagrees with.
  it("raises LinkedIn's closed sign as an alert", () => {
    document.body.innerHTML = loadFixture("linkedin-detail.html");
    window.history.pushState({}, "", "/jobs/view/100001/");
    installFakeChrome();

    linkedinAdapter.scanDetail!();
    expect(document.querySelector(".jh-banner-alert")).toBeNull();

    const sign = document.createElement("p");
    sign.textContent = "No longer accepting applications";
    document.querySelector(".job-details-jobs-unified-top-card__container--two-pane")!.append(sign);
    linkedinAdapter.scanDetail!();

    const alert = document.querySelector(".jh-banner-alert")!;
    expect(alert.textContent).toContain("closed to applications");
    expect(alert.querySelector(".jh-banner-icon")!.textContent).toBe("⚠");
  });

  it("leaves an unchanged head in place, so a copy confirmation survives a scan", () => {
    document.body.innerHTML = loadFixture("linkedin-detail.html");
    window.history.pushState({}, "", "/jobs/view/100001/");
    installFakeChrome();

    linkedinAdapter.scanDetail!();
    const head = document.querySelector(".jh-detail-head");
    linkedinAdapter.scanDetail!();

    expect(document.querySelector(".jh-detail-head")).toBe(head);
  });
});

// The posted_at derivation is anchored to the capture instant, so the clock is
// frozen: "17 days ago" captured at 2026-07-20T12:00:00Z is a fixed instant.
const CAPTURED_AT = "2026-07-20T12:00:00.000Z";

describe("linkedin adapter — detail capture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CAPTURED_AT));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scrapes the open posting into the expected ListingRecord", () => {
    document.body.innerHTML = loadFixture("linkedin-detail.html");
    window.history.pushState({}, "", "/jobs/view/100001/");
    const { sendMessage } = installFakeChrome();

    linkedinAdapter.capture!();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [message] = sendMessage.mock.calls[0]!;
    expect(message).toEqual({
      type: "listing",
      payload: {
        platform: "linkedin",
        platform_id: "100001",
        url: "https://www.linkedin.com/jobs/view/100001/",
        title: "Example Backend Engineer",
        company: "Example Labs",
        apply_type: "easy_apply",
        meta: {
          company_url: "https://www.linkedin.com/company/example-labs/",
          posted_at: "2026-07-03T12:00:00.000Z",
          posted_precision: "estimated",
          posted_age: "17 days ago",
          applicants: 25,
          salary: null,
          match_level: null,
          chips: ["Remote", "Full-time"],
          poster: null,
          poster_url: null,
          description:
            "We build developer tools used by thousands of engineers.\n" +
            "Requirements: 5+ years of experience with TypeScript and distributed systems.",
        },
      },
    });
  });

  it.each([
    [
      "LinkedIn's safety redirect",
      "https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fjobs.example.com%2Fbackend%3Fsource%3Dlinkedin",
    ],
    ["a direct link", "https://jobs.example.com/backend?source=linkedin"],
  ])("captures the destination from %s", (_kind, href) => {
    document.body.innerHTML = loadFixture("linkedin-detail.html");
    document.getElementById("jobs-apply-button-id")!.outerHTML =
      `<a aria-label="Apply on company website" href="${href}">Apply</a>`;
    window.history.pushState({}, "", "/jobs/view/100001/");
    const { sendMessage } = installFakeChrome();

    linkedinAdapter.capture!();

    const [message] = sendMessage.mock.calls[0]!;
    expect(message).toMatchObject({
      type: "listing",
      payload: {
        apply_type: "external",
        meta: {
          apply_url: "https://jobs.example.com/backend?source=linkedin",
        },
      },
    });
  });

  // A slug URL must yield the identical record, canonical url included: the trailing
  // id alone identifies the posting.
  it("captures the same posting when opened by its slug url", () => {
    document.body.innerHTML = loadFixture("linkedin-detail.html");
    window.history.pushState({}, "", "/jobs/view/example-backend-engineer-at-example-labs-100001/");
    const { sendMessage } = installFakeChrome();

    linkedinAdapter.capture!();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [message] = sendMessage.mock.calls[0]!;
    expect((message as { payload: Record<string, unknown> }).payload).toMatchObject({
      platform: "linkedin",
      platform_id: "100001",
      url: "https://www.linkedin.com/jobs/view/100001/",
      title: "Example Backend Engineer",
    });
  });

  // A same-document search card supplies exact date evidence that takes precedence
  // over the detail card's relative age.
  it("prefers the list card's absolute date over the relative age", () => {
    document.body.innerHTML =
      loadFixture("linkedin-search-card.html") + loadFixture("linkedin-detail.html");
    window.history.pushState({}, "", "/jobs/view/100001/");
    const { sendMessage } = installFakeChrome();

    linkedinAdapter.capture!();

    const [message] = sendMessage.mock.calls[0]!;
    expect((message as { payload: { meta: Record<string, unknown> } }).payload.meta).toMatchObject({
      posted_at: "2026-07-19T00:00:00.000Z",
      posted_precision: "exact",
      posted_age: "17 days ago",
    });
  });

  // Missing age evidence must not produce an invented date.
  it("emits a null posted_at when the page shows no age", () => {
    document.body.innerHTML = loadFixture("linkedin-detail.html");
    [...document.querySelectorAll("span")].find((el) => el.textContent === "17 days ago")!.remove();
    window.history.pushState({}, "", "/jobs/view/100001/");
    const { sendMessage } = installFakeChrome();

    linkedinAdapter.capture!();

    const [message] = sendMessage.mock.calls[0]!;
    expect((message as { payload: { meta: Record<string, unknown> } }).payload.meta).toMatchObject({
      posted_at: null,
      posted_precision: null,
      posted_age: null,
    });
  });
});

// The three job layouts must stay disjoint. Layout C carries the very componentkey
// that identifies layout B's job description, so a resolver that feature-detects its
// own way through the layouts reads C as B and fails downstream, on empty content,
// instead of at the point the page is recognized.
describe("linkedin adapter — layout resolution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CAPTURED_AT));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Layout B — the standalone SDUI page. No stable classes, so identity comes from
  // document.title and the description from the AboutTheJob componentkey.
  it("captures the standalone SDUI layout through its title and componentkey", () => {
    document.body.innerHTML = loadFixture("linkedin-detail-sdui.html");
    document.title = "Example Senior Engineer | Example Labs | LinkedIn";
    window.history.pushState({}, "", "/jobs/view/100004/");
    const { sendMessage } = installFakeChrome();

    linkedinAdapter.capture!();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [message] = sendMessage.mock.calls[0]!;
    expect(message).toMatchObject({
      type: "listing",
      payload: {
        platform_id: "100004",
        title: "Example Senior Engineer",
        company: "Example Labs",
        apply_type: "easy_apply",
        meta: {
          company_url: "https://www.linkedin.com/company/example-labs/",
          posted_age: "5 days ago",
          description:
            "We build developer tools used by thousands of engineers.\n\n" +
            "Requirements: 5+ years of experience with TypeScript and distributed systems.",
        },
      },
    });
  });

  it("gives the standalone SDUI layout a detail head", () => {
    document.body.innerHTML = loadFixture("linkedin-detail-sdui.html");
    document.title = "Example Senior Engineer | Example Labs | LinkedIn";
    window.history.pushState({}, "", "/jobs/view/100004/");
    installFakeChrome();

    linkedinAdapter.scanDetail!();

    expect(document.querySelector(".jh-detail-head .jh-banner-copy")).not.toBeNull();
  });

  // Layout C — the search-results pane. It shares B's description container, so the
  // layouts are told apart by their own markers, not by which selectors happen to
  // resolve; what differs is the anchor, which C alone must keep clear of its cards.
  it("captures the search-results layout", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-detail.html");
    document.title = "Example Senior Backend Engineer | Example Labs | LinkedIn";
    window.history.pushState({}, "", "/jobs/search-results/?currentJobId=100005");
    const { sendMessage } = installFakeChrome();

    linkedinAdapter.capture!();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [message] = sendMessage.mock.calls[0]!;
    expect(message).toMatchObject({
      type: "listing",
      payload: {
        platform_id: "100005",
        url: "https://www.linkedin.com/jobs/view/100005/",
        title: "Example Senior Backend Engineer",
        company: "Example Labs",
        meta: {
          description:
            "We build developer tools used by thousands of engineers.\n\n" +
            "Requirements: 5+ years of experience with TypeScript and distributed systems.",
        },
      },
    });
  });

  it("gives the search-results layout a detail head", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-detail.html");
    document.title = "Example Senior Backend Engineer | Example Labs | LinkedIn";
    window.history.pushState({}, "", "/jobs/search-results/?currentJobId=100005");
    installFakeChrome();

    linkedinAdapter.scanDetail!();

    expect(document.querySelector(".jh-detail-head .jh-banner-copy")).not.toBeNull();
  });

  // Cards and detail share one document here, so a page-wide "More options" query
  // anchors the bar inside a card. The detail button is the one outside every card.
  it("anchors the detail bar outside the search-results cards", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-detail.html");
    document.title = "Example Senior Backend Engineer | Example Labs | LinkedIn";
    window.history.pushState({}, "", "/jobs/search-results/?currentJobId=100005");
    installFakeChrome();

    linkedinAdapter.scanDetail!();

    const bar = document.querySelector(".jh-detail-actions");
    expect(bar).not.toBeNull();
    expect(bar!.closest('[componentkey^="job-card-component-ref-"]')).toBeNull();
    expect(bar!.closest('[data-testid="lazy-column"]')).not.toBeNull();
  });

  // The pane serves an empty skeleton for a long time before its description lands.
  // Capture must wait for it rather than store a title-only stub — a stub is what
  // every job on this surface became while the layout reported no description at all.
  it("stores nothing until the search-results description arrives", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-detail-loading.html");
    document.title = "Example Senior Backend Engineer | Example Labs | LinkedIn";
    window.history.pushState({}, "", "/jobs/search-results/?currentJobId=100005");
    const { sendMessage } = installFakeChrome();

    // The container resolves; it is simply still empty.
    expect(document.querySelector('[componentkey^="JobDetails_AboutTheJob"]')).not.toBeNull();

    linkedinAdapter.capture!();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(document.querySelector(".jh-detail-head")).toBeNull();

    // The description lands on a later scan, and that scan captures.
    document.querySelector('[componentkey^="JobDetails_AboutTheJob"] > div')!.innerHTML =
      "<p>We build developer tools used by thousands of engineers.</p>";
    linkedinAdapter.capture!();

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
// Layout C's list. No card carries an anchor, so identity and the posting url both
// come from the componentkey.
describe("linkedin adapter — search-results cards", () => {
  it("tags each card once, from its componentkey", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-card.html");

    const cards = linkedinAdapter.findCards(document);

    // Four elements carry a card key — an outer and an inner per job — and tagging
    // both would give every job two action bars.
    expect(document.querySelectorAll('[componentkey^="job-card-component-ref-"]')).toHaveLength(4);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.dataset.jhId)).toEqual(["LI-100002", "LI-100003"]);
    expect(cards.map((c) => c.dataset.jobTitle)).toEqual([
      "Example Backend Engineer",
      "Example Platform Engineer",
    ]);
    expect(cards.map((c) => c.dataset.jobCompany)).toEqual(["Example Labs", "Example Labs"]);
    // No anchor exists on this surface; the canonical url is rebuilt from the id.
    expect(cards[0]!.querySelectorAll("a")).toHaveLength(0);
    expect(cards[0]!.dataset.jobUrl).toBe("https://www.linkedin.com/jobs/view/100002/");
    expect(cards[0]!.dataset.jhCompact).toBe("1");
  });

  it("is idempotent across scans", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-card.html");

    expect(linkedinAdapter.findCards(document)).toHaveLength(2);
    expect(linkedinAdapter.findCards(document)).toHaveLength(0);
  });

  // The state line is a bare <p> sharing its slot with "Viewed" and "Saved", so the
  // match is on exact text — a substring test would also hit a job titled
  // "Applied AI Engineer" and mark an untouched posting as applied.
  it("reads the applied state without matching a title containing it", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-card.html");
    const [plain, applied] = linkedinAdapter.findCards(document);

    expect(linkedinAdapter.isAppliedCard!(applied!)).toBe(true);
    expect(linkedinAdapter.isAppliedCard!(plain!)).toBe(false);

    plain!.querySelector("p")!.textContent = "Applied AI Engineer";
    expect(linkedinAdapter.isAppliedCard!(plain!)).toBe(false);
  });

  // LinkedIn's own dismiss control is labelled per job here, not by a stable class.
  it("drives the site's own dismiss control", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-card.html");
    const [card] = linkedinAdapter.findCards(document);
    const btn = card!.querySelector('[aria-label^="Dismiss"]') as HTMLElement;
    const clicked = vi.fn();
    btn.addEventListener("click", clicked);

    linkedinAdapter.nativeDismiss!(card!)!();

    expect(clicked).toHaveBeenCalledTimes(1);
  });

  // The classic list must keep its own strategy: both surfaces answer to /jobs paths.
  it("leaves the classic search list to the layout-A strategy", () => {
    document.body.innerHTML = loadFixture("linkedin-search-card.html");

    const cards = linkedinAdapter.findCards(document);

    expect(cards).toHaveLength(1);
    expect(cards[0]!.dataset.jhId).toBe("LI-100001");
    expect(cards[0]!.tagName).toBe("LI");
  });
});

// Where the card's action bar mounts. Layout C's card element is itself a flex row,
// so a bar appended to it lands beside the content rather than under it and takes
// half the card's width from the title and company.
describe("linkedin adapter — card bar anchor", () => {
  it("resolves a search-results card's bar anchor inside the card", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-card.html");
    const [card] = linkedinAdapter.findCards(document);

    const body = card!.querySelector(linkedinAdapter.cardBodySelector!);

    expect(body).not.toBeNull();
    expect(body).not.toBe(card);
    expect(body!.parentElement).toBe(card);
  });

  // The two alternatives in the selector must stay mutually exclusive: only layout
  // C's cards carry a componentkey, so the classic card keeps its own resolution.
  it("does not reach into a classic search card", () => {
    document.body.innerHTML = loadFixture("linkedin-search-card.html");
    const [card] = linkedinAdapter.findCards(document);

    expect(card!.querySelector(`[componentkey^="job-card-component-ref-"] > div`)).toBeNull();
  });
});

// The side panel's detail bar had no test, and LinkedIn's rename of the top card
// removed it from the layout without any check noticing.
describe("linkedin adapter — side-panel detail bar", () => {
  it("anchors the detail bar in the top card", () => {
    document.body.innerHTML = loadFixture("linkedin-detail.html");
    window.history.pushState({}, "", "/jobs/search/?currentJobId=100001");
    installFakeChrome();

    linkedinAdapter.scanDetail!();

    const bar = document.querySelector(".jh-detail-actions");
    expect(bar).not.toBeNull();
    expect(bar!.closest(".job-details-jobs-unified-top-card__container--two-pane")).not.toBeNull();
    expect((bar!.querySelector(".jh-btn-hide") as HTMLButtonElement).title).toBe("Hide (Alt+H)");
  });

  // The side panel renders cards and detail in one document, so a page-wide query
  // for a card's control must never win the anchor.
  it("does not anchor the detail bar to a list card", () => {
    document.body.innerHTML =
      loadFixture("linkedin-search-card.html") + loadFixture("linkedin-detail.html");
    window.history.pushState({}, "", "/jobs/search/?currentJobId=100001");
    installFakeChrome();

    linkedinAdapter.scanDetail!();

    const bar = document.querySelector(".jh-detail-actions");
    expect(bar).not.toBeNull();
    expect(bar!.closest("li[data-occludable-job-id]")).toBeNull();
  });
});

describe("linkedin adapter — detail shortcut", () => {
  function setup(jobId: string) {
    document.body.innerHTML = `<div class="jh-detail-actions" data-jh-job-id="LI-${jobId}"></div>`;
    window.history.pushState({}, "", `/jobs/view/${jobId}/`);
    const chrome = installFakeChrome();
    chrome.onMessage.addListener((message: unknown) => {
      const request = message as {
        type?: string;
        payload?: { events?: Array<{ event: string }> };
      };
      if (request.type !== "event") return undefined;
      const event = request.payload?.events?.[0]?.event;
      return {
        ok: true,
        result: { status: "seen", hidden: event === "hidden", starred: false },
      };
    });
    return chrome;
  }

  function altH(overrides: KeyboardEventInit = {}) {
    return new KeyboardEvent("keydown", {
      key: "h",
      altKey: true,
      cancelable: true,
      ...overrides,
    });
  }

  it("hides and unhides the current detail job with Alt+H", async () => {
    const { sendMessage } = setup("990001");
    const hide = altH();

    linkedinAdapter.onKeyDown!(hide);

    expect(hide.defaultPrevented).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "event",
        payload: expect.objectContaining({ events: [{ event: "hidden" }] }),
      }),
      expect.any(Function),
    );
    await vi.waitFor(() => expect(stateOf("LI-990001").hidden).toBe(true));

    sendMessage.mockClear();
    linkedinAdapter.onKeyDown!(altH());

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "event",
        payload: expect.objectContaining({ events: [{ event: "unhidden" }] }),
      }),
      expect.any(Function),
    );
  });

  it("does not claim Alt+H while the user is editing", () => {
    const { sendMessage } = setup("990002");
    const input = document.body.appendChild(document.createElement("input"));
    const event = altH();
    Object.defineProperty(event, "composedPath", { value: () => [input, document.body] });

    linkedinAdapter.onKeyDown!(event);

    expect(event.defaultPrevented).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does nothing without the matching current detail bar", () => {
    const { sendMessage } = setup("990003");
    document.querySelector(".jh-detail-actions")?.remove();
    const event = altH();

    linkedinAdapter.onKeyDown!(event);

    expect(event.defaultPrevented).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// The open job's age is scraped page-wide, and on the search-results layout the card
// column precedes the detail pane. Without scoping, the first card's age wins and
// every capture is dated by whichever job sits at the top of the list.
describe("linkedin adapter — posting age scope", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CAPTURED_AT));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores a list card's age when dating the open job", () => {
    document.body.innerHTML =
      loadFixture("linkedin-search-results-card.html") +
      loadFixture("linkedin-search-results-detail.html");
    document.title = "Example Senior Backend Engineer | Example Labs | LinkedIn";
    window.history.pushState({}, "", "/jobs/search-results/?currentJobId=100005");
    const { sendMessage } = installFakeChrome();

    // The cards carry their own, older ages, ahead of the detail pane in the document.
    expect(document.body.textContent).toContain("2 weeks ago");
    expect(document.body.textContent).toContain("3 months ago");

    linkedinAdapter.capture!();

    const [message] = sendMessage.mock.calls[0]!;
    expect((message as { payload: { meta: Record<string, unknown> } }).payload.meta).toMatchObject({
      posted_age: "22 hours ago",
    });
  });
});

// The top card provides no inset of its own — its content column does — so a head
// appended beside that column sits flush against the pane's left edge while every
// LinkedIn row is indented.
describe("linkedin adapter — detail head placement", () => {
  it("puts the head in the column that aligns the title, not beside it", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-detail.html");
    document.title = "Example Senior Backend Engineer | Example Labs | LinkedIn";
    window.history.pushState({}, "", "/jobs/search-results/?currentJobId=100005");
    installFakeChrome();

    linkedinAdapter.scanDetail!();

    const head = document.querySelector(".jh-detail-head")!;
    const titleLink = document.querySelector('a[href*="/jobs/view/100005/"]')!;
    // Same column as the rows LinkedIn aligns, rather than a sibling of the column.
    expect(head.parentElement).toBe(titleLink.closest("div")!.parentElement);
    expect(head.parentElement).not.toBe(document.querySelector('[data-testid="lazy-column"]'));
  });

  // No inline spacing is applied: alignment must come from the container, because
  // the rows that carry the inset are display:contents and expose no usable margin.
  it("adds no inline margin of its own", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-detail.html");
    document.title = "Example Senior Backend Engineer | Example Labs | LinkedIn";
    window.history.pushState({}, "", "/jobs/search-results/?currentJobId=100005");
    installFakeChrome();

    linkedinAdapter.scanDetail!();

    const head = document.querySelector(".jh-detail-head") as HTMLElement;
    expect(head.style.marginLeft).toBe("");
    expect(head.style.marginRight).toBe("");
  });
});
