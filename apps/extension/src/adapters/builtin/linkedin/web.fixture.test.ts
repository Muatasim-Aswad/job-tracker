// Fixture tests keep selector drift from silently stopping capture.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { linkedinAdapter } from "./web";
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
    expect(chipTexts()).toEqual(["stale (17 days ago)"]);

    document.querySelector(".job-details-jobs-unified-top-card")!.appendChild(applicants);
    linkedinAdapter.scanDetail!();

    expect(chipTexts()).toEqual(["25 applicants", "stale (17 days ago)"]);
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

  // Layout C — the search-results pane. This asserts the trap itself: the fixture
  // matches layout B's description selector, so anything that resolves the JD by
  // trying that selector would treat this page as B.
  it("does not resolve the search-results layout as the standalone one", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-detail.html");
    document.title = "Example Senior Backend Engineer | Example Labs | LinkedIn";
    window.history.pushState({}, "", "/jobs/search-results/?currentJobId=100005");
    installFakeChrome();

    // The premise: layout B's job-description selector matches this page.
    expect(document.querySelector('[componentkey^="JobDetails_AboutTheJob"]')).not.toBeNull();

    linkedinAdapter.scanDetail!();

    // Yet no head is built, because the layout is recognized as C and reports no
    // description — rather than being read as B and yielding an empty one.
    expect(document.querySelector(".jh-detail-head")).toBeNull();
  });

  // Cards and detail share one document here, so a page-wide "More options" query
  // would anchor the bar to a card. Layout C offers no detail anchor at all yet, and
  // must not fall back to the card's button.
  it("anchors no detail bar to a search-results card", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-detail.html");
    document.title = "Example Senior Backend Engineer | Example Labs | LinkedIn";
    window.history.pushState({}, "", "/jobs/search-results/?currentJobId=100005");
    installFakeChrome();

    linkedinAdapter.scanDetail!();

    expect(document.querySelector(".jh-detail-actions")).toBeNull();
  });

  // Capture is gated on a description, so an unserved layout stores nothing at all
  // rather than a title-only stub.
  it("captures nothing from the search-results layout", () => {
    document.body.innerHTML = loadFixture("linkedin-search-results-detail.html");
    document.title = "Example Senior Backend Engineer | Example Labs | LinkedIn";
    window.history.pushState({}, "", "/jobs/search-results/?currentJobId=100005");
    const { sendMessage } = installFakeChrome();

    linkedinAdapter.capture!();

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
