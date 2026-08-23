// Gmail cards use LinkedIn's resolver for their LI-prefixed identifiers.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { gmailAdapter } from "./gmail";
import { linkedinAdapter } from "./web";
import { installFakeChrome } from "../../../test-support/fakeChrome";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const loadFixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

describe("gmail adapter — findCards", () => {
  it("tags the rejection subject as a wall card, dated from the message time", () => {
    document.body.innerHTML = loadFixture("gmail-inbox.html");

    const cards = gmailAdapter.findCards(document);
    const rejection = cards.find((c) => c.dataset.jhId === "LI-100002")!;

    expect(rejection).toBeDefined();
    expect(rejection.dataset.jobTitle).toBe("Example Backend Engineer");
    expect(rejection.dataset.jobCompany).toBe("Example Labs");
    expect(rejection.dataset.jhWall).toBe("1");
    expect(rejection.dataset.jhWallStatus).toBe("rejected");
    expect(rejection.dataset.jhForceMode).toBe("dim");
    expect(rejection.dataset.jhTs).toBe("2026-03-02T09:15:00.000Z");

    expect(linkedinAdapter.naturalKey!(rejection.dataset.jhId!)).toEqual({
      platform: "linkedin",
      platform_id: "100002",
    });
  });

  it("leaves a 'similar jobs' recommendation off the wall", () => {
    document.body.innerHTML = loadFixture("gmail-inbox.html");

    const cards = gmailAdapter.findCards(document);
    const recommendation = cards.find((c) => c.dataset.jhId === "LI-100003")!;

    expect(recommendation).toBeDefined();
    expect(recommendation.dataset.jobTitle).toBe("Example Platform Engineer");
    expect(recommendation.dataset.jobCompany).toBe("Sample Works");
    expect(recommendation.dataset.jhWall).toBeUndefined();
    expect(recommendation.dataset.jhForceMode).toBeUndefined();
  });

  // LinkedIn's own mails link postings by slug URL, so a card is tagged only when the
  // id is read from behind the slug.
  it("tags a card whose link carries the slug url", () => {
    document.body.innerHTML = `<table class="gs"><tr>
      <td width="48"><img alt="Example Employer" /></td>
      <td><div class="a3s">
        <p><a href="https://www.linkedin.com/comm/jobs/view/junior-cloud-devops-engineer-at-example-employer-4444945220/?trk=email_job_alert_digest_01" style="font-size:16px">Junior Cloud DevOps Engineer</a></p>
        <p>Example Employer · Utrecht, NL</p>
      </div></td>
    </tr></table>`;

    const cards = gmailAdapter.findCards(document);
    const card = cards.find((c) => c.dataset.jhId === "LI-4444945220")!;

    expect(card).toBeDefined();
    expect(card.dataset.jobTitle).toBe("Junior Cloud DevOps Engineer");
    expect(linkedinAdapter.naturalKey!(card.dataset.jhId!)).toEqual({
      platform: "linkedin",
      platform_id: "4444945220",
    });
  });

  it("does not wall an applied_job link when the email isn't a rejection", () => {
    // An applied-job link is not a rejection without the rejection template token.
    document.body.innerHTML = `<table class="gs"><tr>
      <td width="48"><img alt="Demo Company" /></td>
      <td><div class="a3s">
        <p><a href="https://www.linkedin.com/comm/jobs/view/333333/?trk=email_jobs_ejpu-jobs-tracker_applied_job" style="font-size:16px">Data Engineer</a></p>
        <p>Demo Company · Rotterdam, NL</p>
        <p><a href="https://www.linkedin.com/help?trk=eml-email_jobs_application_viewed_01-help-0">Help</a></p>
      </div></td>
    </tr></table>`;

    const cards = gmailAdapter.findCards(document);
    const card = cards.find((c) => c.dataset.jhId === "LI-333333")!;

    expect(card).toBeDefined();
    expect(card.dataset.jhWall).toBeUndefined();
    expect(card.dataset.jhWallStatus).toBeUndefined();
  });

  it("counts only unaffected jobs in a LinkedIn alert", () => {
    document.body.innerHTML = loadFixture("gmail-inbox.html");
    const cards = gmailAdapter.findCards(document);
    const first = cards.find((card) => card.dataset.jhId === "LI-200001")!;
    const second = cards.find((card) => card.dataset.jhId === "LI-200002")!;
    first.classList.add("jh-hidden");
    second.classList.add("jh-interested"); // starred is still an unaffected/new card
    const button = screenAlertButton();

    gmailAdapter.renderPageActions!(true);

    expect(button.textContent).toBe("Open new jobs (1)");
    expect(button.disabled).toBe(false);

    second.classList.add("jh-resolved");
    gmailAdapter.renderPageActions!();
    expect(button.textContent).toBe("Open new jobs (0)");
    expect(button.disabled).toBe(true);
  });

  it("adds the bulk action to a LinkedIn viewed-jobs reminder", () => {
    document.body.innerHTML = `<table class="gs"><tr>
      <td width="48"><img alt="Reminder Company" /></td>
      <td><div class="a3s">
        <p><a href="https://www.linkedin.com/comm/jobs/view/300001/?trk=eml-email_jobs_viewed_job_reminder_01-job_card-0-job_posting" style="font-size:16px">Reminder Job</a></p>
        <p>Reminder Company · Amsterdam, NL</p>
      </div></td>
    </tr></table>`;

    const cards = gmailAdapter.findCards(document);
    gmailAdapter.renderPageActions!(true);

    expect(cards).toHaveLength(1);
    expect(screenAlertButton().textContent).toBe("Open new jobs (1)");
  });

  it("supports LinkedIn profile-match recommendation cards", () => {
    document.body.innerHTML = `<table class="gs"><tr>
      <td width="48"><img alt="LinkedIn" /></td>
      <td><div class="a3s">
        <a href="https://www.linkedin.com/help?trk=eml-email_jobs_qualification_board-help">Profile matches</a>
        <table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/300002/?trk=eml-email_jobs_qualification_board-JOBS_POSTING_SECTION_1-0-job_card_0_jobid_300002">
          <table><tr><td><img alt="Profile Match Co" /><span>Profile Match Engineer</span><p>Profile Match Co · Utrecht, NL (Hybrid)</p></td></tr></table>
        </a></td></tr></table>
      </div></td>
    </tr></table>`;

    const cards = gmailAdapter.findCards(document);
    gmailAdapter.renderPageActions!(true);

    expect(cards).toHaveLength(1);
    expect(cards[0].dataset.jhId).toBe("LI-300002");
    expect(cards[0].dataset.jobTitle).toBe("Profile Match Engineer");
    expect(cards[0].dataset.jobCompany).toBe("Profile Match Co");
    expect(cards[0].querySelector(gmailAdapter.cardBodySelector!)).not.toBeNull();
    expect(screenAlertButton().textContent).toBe("Open new jobs (1)");
  });

  it("asks the worker to open deduplicated canonical LinkedIn tabs", () => {
    document.body.innerHTML = loadFixture("gmail-inbox.html");
    const { sendMessage } = installFakeChrome();
    const cards = gmailAdapter.findCards(document);
    const first = cards.find((card) => card.dataset.jhId === "LI-200001")!;
    const second = cards.find((card) => card.dataset.jhId === "LI-200002")!;
    second.dataset.jhId = first.dataset.jhId;
    gmailAdapter.renderPageActions!(true);
    const button = screenAlertButton();

    button.click();

    expect(button.textContent).toBe("Open new jobs (1)");
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: "open-job-tabs",
        urls: ["https://www.linkedin.com/jobs/view/200001/"],
      },
      expect.any(Function),
    );
  });

  it("does not add the bulk action to a rejection email", () => {
    document.body.innerHTML = loadFixture("gmail-inbox.html");
    gmailAdapter.findCards(document);
    const rejectionBody = [...document.querySelectorAll<HTMLElement>(".a3s")].find((body) =>
      body.innerHTML.includes("email_jobs_application_rejected_01"),
    )!;

    expect(rejectionBody.querySelector(".jh-btn-open-alert")).toBeNull();
  });
});

function screenAlertButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(".jh-btn-open-alert");
  if (!button) throw new Error("alert button not found");
  return button;
}
