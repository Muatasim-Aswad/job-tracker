// Banner composition and cache invalidation: a policy edit — or more of a progressively
// rendered pane arriving — must invalidate a rendered banner as surely as moving to
// another job does, or the user's newly added words and the rest of the page's flags
// stay unseen until a reload.
import { afterEach, describe, expect, it } from "vitest";

import { bannerCurrent, bannerFingerprint, elementToText, placeBanner } from "./dom";
import { defaultPolicy, keywordFindings, setActivePolicy } from "./keywords";

function anchoredBanner() {
  document.body.innerHTML = '<div id="anchor"></div>';
  placeBanner({ chips: [{ text: "17d", tone: "warn" }] }, document.querySelector("#anchor"));
  return document.querySelector(".jh-detail-banner") as HTMLElement | null;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("elementToText", () => {
  it("keeps adjacent blocks separate so they cannot form a numeric keyword", () => {
    document.body.innerHTML = '<div id="description"><p>3</p><p>years</p></div>';
    const text = elementToText(document.querySelector("#description"));

    expect(text).toBe("3\nyears");
    expect(
      keywordFindings(text!, defaultPolicy()).filter(
        (finding) => finding.ruleId === "experience-years",
      ),
    ).toEqual([]);
  });
});

describe("bannerCurrent", () => {
  it("keeps a banner that still matches this job and this policy", () => {
    expect(anchoredBanner()).not.toBeNull();
    expect(bannerCurrent()).toBe(true);
    expect(document.querySelector(".jh-detail-banner")).not.toBeNull();
  });

  it("drops a banner built under a superseded policy, so an edit repaints it", () => {
    anchoredBanner();
    const before = bannerFingerprint();

    setActivePolicy(defaultPolicy()); // what loadKeywordPolicy does when storage changes
    expect(bannerFingerprint()).not.toBe(before);
    expect(bannerCurrent()).toBe(false);
    // Cleared, not left stale — the caller rebuilds from the new policy.
    expect(document.querySelector(".jh-detail-banner")).toBeNull();
  });

  it("reports nothing current when no banner is up", () => {
    document.body.innerHTML = "";
    expect(bannerCurrent()).toBe(false);
  });

  // A detail pane renders in stages, so the same job can yield more warnings a scan
  // later — the applicant count, the posting age, or a JD that had not loaded yet.
  it("drops a banner built from less than the pane now shows", () => {
    anchoredBanner(); // built from the posting-age chip alone
    expect(bannerCurrent({ chips: [{ text: "17d", tone: "warn" }] })).toBe(true);
    expect(bannerCurrent({ chips: [{ text: "17d", tone: "warn" }, { text: "25 clicks" }] })).toBe(
      false,
    );
    expect(document.querySelector(".jh-detail-banner")).toBeNull();
  });
});

describe("placeBanner", () => {
  const boxes = () =>
    [...document.querySelectorAll(".jh-detail-banner > *")].map((b) => b.className);

  it("stacks its parts quietest first, whichever of them the job has", () => {
    document.body.innerHTML = '<div id="anchor"></div>';
    placeBanner(
      {
        chips: [{ text: "17d", tone: "warn" }],
        findings: keywordFindings("A senior role.", defaultPolicy()),
        alerts: ["blocked company"],
      },
      document.querySelector("#anchor"),
    );

    expect(boxes()).toEqual(["jh-banner-stats", "jh-banner-findings", "jh-banner-alert"]);
  });

  // ⚠ marks a thing that is wrong. Facts and asked-for keyword matches are neither.
  it("raises ⚠ for an alert and nothing else", () => {
    document.body.innerHTML = '<div id="anchor"></div>';
    const findings = keywordFindings("A senior role, 5+ years.", defaultPolicy());
    placeBanner(
      { chips: [{ text: "40d", tone: "faded" }], findings },
      document.querySelector("#anchor"),
    );
    expect(document.querySelector(".jh-banner-icon")).toBeNull();

    document.body.innerHTML = '<div id="anchor"></div>';
    placeBanner({ alerts: ["blocked company"] }, document.querySelector("#anchor"));

    expect(boxes()).toEqual(["jh-banner-alert"]);
    expect(document.querySelector(".jh-banner-icon")!.textContent).toBe("⚠");
    expect(document.querySelector(".jh-banner-alert")!.textContent).toContain("blocked company");
  });

  it("adds nothing when the job has nothing to say", () => {
    document.body.innerHTML = '<div id="anchor"></div>';
    placeBanner({ chips: [], findings: [], alerts: [] }, document.querySelector("#anchor"));
    expect(document.querySelector(".jh-detail-banner")).toBeNull();
  });
});
