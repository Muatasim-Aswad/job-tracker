// Keyword-policy safety rules: fresh installs enable informational banners but no
// highlighting or persistent hiding, and every matcher honors scope and enablement.
import { describe, expect, it } from "vitest";

import {
  type KeywordPolicy,
  defaultPolicy,
  sanitizePolicy,
  titleHighlights,
  titleAutoHides,
  keywordFindings,
} from "./keywords";

// Turn one catalog signal on (optionally overriding its scope/action/terms),
// leaving the rest at their safe disabled defaults.
function enable(id: string, over: Partial<KeywordPolicy[number]> = {}): KeywordPolicy {
  return defaultPolicy().map((s) => (s.id === id ? { ...s, enabled: true, ...over } : s));
}

describe("safe defaults", () => {
  it("ships every persistent/negative title action disabled", () => {
    const byId = new Map(defaultPolicy().map((s) => [s.id, s]));
    expect(byId.get("outline-titles")!.enabled).toBe(false);
    expect(byId.get("auto-hide-titles")!.enabled).toBe(false);
  });

  it("neither highlights nor hides any card on a fresh policy", () => {
    const policy = defaultPolicy();
    expect(titleHighlights("Senior Software Engineer", policy)).toBe(false);
    expect(titleAutoHides("Senior Data Scientist", policy)).toBe(false);
  });

  it("shows the informational JD banners out of the box", () => {
    const policy = defaultPolicy();
    const found = keywordFindings("Senior role, 5+ years of experience, Dutch required.", policy);
    expect(found.length).toBeGreaterThan(0);
  });
});

describe("the live policy before storage lands", () => {
  // Must be the first thing this file asserts about the module singleton: nothing
  // here calls setActivePolicy, so this is the untouched startup state.
  it("matches nothing, so a scan racing the storage read paints no banner", () => {
    // Text every default banner signal would flag, to catch a non-inert seed.
    expect(keywordFindings("Senior role, 5+ years of experience, Dutch required.")).toEqual([]);
    expect(titleHighlights("Senior Software Engineer")).toBe(false);
    expect(titleAutoHides("Senior Data Scientist")).toBe(false);
  });
});

describe("titleHighlights", () => {
  const policy = enable("outline-titles");

  it("flags configured keywords on a word boundary", () => {
    expect(titleHighlights("Senior Software Engineer", policy)).toBe(true);
    expect(titleHighlights("Lead Senior Developer", policy)).toBe(true);
    // A word the signal isn't configured for by default doesn't trip it.
    expect(titleHighlights("Software Engineering Internship", policy)).toBe(false);
    // ...but editing the terms in is honoured.
    expect(
      titleHighlights(
        "Software Engineering Internship",
        enable("outline-titles", {
          terms: ["internship"],
        }),
      ),
    ).toBe(true);
  });

  it("does not flag a keyword embedded inside another word", () => {
    const seniorish = enable("outline-titles", { terms: ["senior", "stage"] });
    expect(titleHighlights("Backstage Coordinator", seniorish)).toBe(false); // 'stage' in 'Backstage'
    expect(titleHighlights("Full Stack Developer", policy)).toBe(false);
    expect(titleHighlights("Backend Engineer", policy)).toBe(false);
  });

  it("keeps whole-word boundaries for non-ASCII terms too", () => {
    const p = enable("outline-titles", { terms: ["år"] });
    expect(titleHighlights("Konsult, 3 år kontrakt", p)).toBe(true);
    expect(titleHighlights("Årsredovisning Specialist", p)).toBe(false); // 'år' inside a longer word
  });

  it("only fires for a signal whose scope covers the title", () => {
    expect(titleHighlights("Senior Engineer", enable("outline-titles"))).toBe(true);
    expect(
      titleHighlights("Senior Engineer", enable("outline-titles", { scope: "description" })),
    ).toBe(false);
    expect(titleHighlights("Senior Engineer", enable("outline-titles", { scope: "both" }))).toBe(
      true,
    );
  });
});

describe("titleAutoHides (the persistent opt-in action)", () => {
  it("never hides while the hide signal is disabled — the safe default", () => {
    expect(titleAutoHides("Senior Data Scientist", defaultPolicy())).toBe(false);
  });

  it("hides only when enabled AND the title opens with the keyword", () => {
    const policy = enable("auto-hide-titles");
    expect(titleAutoHides("Senior Data Scientist", policy)).toBe(true);
    expect(titleAutoHides("   Senior Analyst", policy)).toBe(true); // leading whitespace tolerated
  });

  it("does not hide when the keyword is mid-title", () => {
    const policy = enable("auto-hide-titles");
    expect(titleAutoHides("Engineer, works with a senior team", policy)).toBe(false);
    expect(titleAutoHides("Software Engineer", policy)).toBe(false);
    // A term the hide signal isn't configured for is not an auto-hide keyword.
    expect(titleAutoHides("Internship — Backend", policy)).toBe(false);
  });
});

describe("keywordFindings", () => {
  it("returns every years match with its context, not just the first", () => {
    const policy = enable("experience-years");
    const text =
      "With over 160 years of experience as a family company.\n" +
      "Typically reflects 1-2 years of relevant experience.";
    const years = keywordFindings(text, policy).filter((f) => f.ruleId === "experience-years");
    expect(years.map((f) => f.label)).toEqual(["160 years", "1-2 years"]);
    // Each finding carries the disambiguating context around its own match.
    expect(years[0].before + years[0].match + years[0].after).toContain("family company");
    expect(years[1].before + years[1].match + years[1].after).toContain("relevant experience");
  });

  it("matches editable year units, including Dutch “jaar”", () => {
    const policy = enable("experience-years");
    const found = keywordFindings("Minimaal 3 jaar ervaring vereist.", policy);
    expect(found.map((f) => f.label)).toEqual(["3 jaar"]);
  });

  it.each([
    ["3-5 years", "3-5 years"],
    ["3 - 5 years", "3-5 years"],
    ["3–5 years", "3-5 years"],
    ["3—5 years", "3-5 years"],
    ["3/5 years", "3-5 years"],
    ["3 to 5 years", "3-5 years"],
    ["3to5 years", "3-5 years"],
    ["2 tot 5 jaar", "2-5 jaar"],
    ["2tot5 jaar", "2-5 jaar"],
    ["1.5 years", "1.5 years"],
    ["1,5 jaar", "1,5 jaar"],
    ["5+ years", "5+ years"],
    ["3-5+ years", "3-5+ years"],
  ])("keeps the full numeric experience value in %s", (text, label) => {
    const found = keywordFindings(text, enable("experience-years"));
    expect(found.map((f) => f.label)).toEqual([label]);
    expect(found[0]?.match).toBe(text);
  });

  it("does not invent ranges from arbitrary separators or across lines", () => {
    const policy = enable("experience-years");
    expect(keywordFindings("3 or 5 years", policy).map((f) => f.label)).toEqual(["5 years"]);
    expect(keywordFindings("3\nyears", policy)).toEqual([]);
  });

  it("matches user terms in any script — ASCII \\b would silently miss these", () => {
    const swedish = enable("experience-years", { terms: ["år"] });
    expect(keywordFindings("Minst 5 år erfarenhet.", swedish).map((f) => f.label)).toEqual([
      "5 år",
    ]);
    const turkish = enable("experience-years", { terms: ["yıl"] });
    expect(keywordFindings("En az 3 yıl deneyim.", turkish).map((f) => f.label)).toEqual(["3 yıl"]);
    const greek = enable("language", { terms: ["ελληνικά"] });
    expect(keywordFindings("Απαιτούνται ελληνικά.", greek)).toHaveLength(1);
  });

  it("flags both seniority and internship wording from the one merged signal", () => {
    const policy = enable("custom-words");
    const labels = keywordFindings("A senior role; an internship is also open.", policy).map(
      (f) => f.label,
    );
    expect(labels).toContain("senior");
    expect(labels).toContain("internship");
  });

  it("reads the amount back with the currency term, on whichever side it sits", () => {
    const policy = enable("pay");
    const text = "Salary €2.800 gross per month.\nBonus of 1.500 euro on top.";
    const labels = keywordFindings(text, policy).map((f) => f.label);
    expect(labels).toEqual(["€2.800", "1.500 euro"]);
  });

  it("does not attach a currency amount from another line", () => {
    const policy = enable("pay");
    expect(keywordFindings("Budget 2.800\neuro paid.", policy).map((f) => f.label)).toEqual([
      "euro",
    ]);
    expect(keywordFindings("Salary €\n2.800 per month.", policy).map((f) => f.label)).toEqual([
      "€",
    ]);
  });

  it("flags a currency term with no amount next to it", () => {
    const policy = enable("pay");
    const [pay] = keywordFindings("Paid in euro, amount to be discussed.", policy);
    expect(pay.label).toBe("euro");
  });

  it("keeps a currency sign matching flush against its figure, unlike a word term", () => {
    // "€" takes no word boundary — one would fail on the digit right after it — while
    // "euro" still must not match inside a longer word.
    const policy = enable("pay");
    expect(keywordFindings("Range: €3.000–€4.000.", policy).map((f) => f.label)).toEqual([
      "€3.000–€4.000",
    ]);
    expect(keywordFindings("Eurofins is hiring.", policy)).toEqual([]);
  });

  it("reads a restated salary range as one figure", () => {
    // Signed on both ends and closed by the currency word, this line otherwise yields
    // three findings — "€4500", "€6000", "euro" — each quoting the same line.
    const policy = enable("pay");
    const text = "Een salaris tussen de €4500-€6000 euro bruto op basis van 36 uur";
    const found = keywordFindings(text, policy);
    expect(found.map((f) => f.label)).toEqual(["€4500-€6000 euro"]);
    expect(found[0].match).toBe("€4500-€6000 euro");
  });

  it("joins a money phrase over spacing and a written range word", () => {
    const policy = enable("pay");
    expect(
      keywordFindings("Salaris €4500 tot €6000 per maand.", policy).map((f) => f.label),
    ).toEqual(["€4500 tot €6000"]);
  });

  it("still separates two figures that a word stands between", () => {
    // A base and a bonus are different numbers to read, so they stay two findings.
    const policy = enable("pay");
    expect(keywordFindings("€4500 base plus €500 bonus.", policy).map((f) => f.label)).toEqual([
      "€4500",
      "€500",
    ]);
  });

  it("takes a shorthand amount but stops at a sentence period", () => {
    const policy = enable("pay");
    expect(keywordFindings("Up to 60k euro.", policy)[0].label).toBe("60k euro");
    expect(keywordFindings("We pay €2.800.", policy)[0].label).toBe("€2.800");
  });

  it("clips context to the keyword's own line, never across a newline", () => {
    const policy = enable("language");
    const text = "Requirements:\nDutch is required.\nWe move fast.";
    const [dutch] = keywordFindings(text, policy).filter((f) => f.ruleId === "language");
    expect(dutch.match.toLowerCase()).toBe("dutch");
    expect(dutch.before).not.toContain("Requirements");
    expect(dutch.after).not.toContain("move fast");
  });

  it("dedups identical repeated snippets and caps a single keyword", () => {
    const policy = enable("custom-words");
    const text = Array(6).fill("A senior engineer role.").join("\n");
    const senior = keywordFindings(text, policy).filter((f) => f.label === "senior");
    // Identical lines collapse to one; distinct lines would each be kept (up to the cap).
    expect(senior.length).toBe(1);
    expect(senior[0].match.toLowerCase()).toBe("senior");
  });

  it("caps one keyword's repeats so a different term from the same signal survives", () => {
    const policy = enable("custom-words");
    const text = [
      "A senior engineer role.",
      "Our senior team is growing.",
      "You report to a senior manager.",
      "Another senior opening too.",
      "A senior mentor is on hand.",
      "An internship is also open.",
    ].join("\n");
    const found = keywordFindings(text, policy);
    // "senior" stops at its own cap even though the signal's budget isn't spent,
    // leaving room for "internship" further down the description.
    expect(found.filter((f) => f.label === "senior")).toHaveLength(3);
    expect(found.map((f) => f.label)).toContain("internship");
  });

  it("lets the catch-all vocabulary signal past the per-signal cap, bounded by the total", () => {
    const policy = enable("custom-words");
    // Eight distinct terms, one per line — more than PER_RULE_CAP's 5.
    const text = [
      "A senior architect.",
      "A medior developer.",
      "A junior analyst.",
      "A lead designer.",
      "A principal engineer.",
      "A staff writer.",
      "An intern joins us.",
      "A trainee starts too.",
    ].join("\n");
    const labels = keywordFindings(text, policy).map((f) => f.label);
    expect(labels).toHaveLength(8);
    expect(labels).toContain("trainee"); // the last term in the text, past the budget
  });

  it("still bounds the uncapped signal at the overall cap", () => {
    const policy = enable("custom-words", { terms: ["role"] });
    // 20 distinct lines, so only the per-keyword and total caps can stop it.
    const text = Array.from({ length: 20 }, (_, i) => `A role number ${i}.`).join("\n");
    expect(keywordFindings(text, policy).length).toBeLessThanOrEqual(15);
  });

  it("does not exempt the vocabulary signal while another banner signal sorts after it", () => {
    // Reordered so `language` sorts after custom-words: the exemption must switch off,
    // or the seniority hits crowd the Dutch requirement out of the banner.
    const byId = new Map(defaultPolicy().map((s) => [s.id, s]));
    const policy = [byId.get("custom-words")!, byId.get("language")!];
    const text = [
      "A senior architect.",
      "A medior developer.",
      "A junior analyst.",
      "A lead designer.",
      "A principal engineer.",
      "A staff writer.",
      "An intern joins us.",
      "Dutch is required.",
    ].join("\n");
    const found = keywordFindings(text, policy);
    expect(found.filter((f) => f.ruleId === "custom-words")).toHaveLength(5);
    expect(found.map((f) => f.ruleId)).toContain("language");
  });

  it("only fires for a banner signal whose scope covers the description", () => {
    const text = "A senior engineer role.";
    expect(keywordFindings(text, enable("custom-words")).length).toBeGreaterThan(0); // default: description
    expect(keywordFindings(text, enable("custom-words", { scope: "title" }))).toEqual([]);
    expect(keywordFindings(text, enable("custom-words", { scope: "both" })).length).toBeGreaterThan(
      0,
    );
  });

  it("returns nothing for JD text with no flagged keywords", () => {
    expect(keywordFindings("A pleasant role building web apps.", enable("custom-words"))).toEqual(
      [],
    );
  });
});

describe("sanitizePolicy", () => {
  it("resolves a missing or corrupt value to the safe defaults", () => {
    expect(sanitizePolicy(undefined)).toEqual(defaultPolicy());
    expect(sanitizePolicy("garbage")).toEqual(defaultPolicy());
    expect(sanitizePolicy([{ nonsense: true }])).toEqual(defaultPolicy());
  });

  it("keeps valid stored fields but repairs invalid ones", () => {
    const stored = [
      { id: "custom-words", enabled: true, scope: "both", action: "banner", terms: ["staff"] },
      { id: "auto-hide-titles", enabled: "yes", scope: "sideways", action: "banner", terms: 7 },
    ];
    const policy = sanitizePolicy(stored);
    const seniority = policy.find((s) => s.id === "custom-words")!;
    expect(seniority).toMatchObject({ enabled: true, scope: "both", terms: ["staff"] });
    // Invalid enabled/scope/terms fall back to that signal's safe default.
    const hide = policy.find((s) => s.id === "auto-hide-titles")!;
    expect(hide).toMatchObject({ enabled: false, scope: "title", terms: ["senior"] });
  });

  it("drops unknown ids and yields exactly one entry per catalog signal", () => {
    const policy = sanitizePolicy([{ id: "ghost", enabled: true }]);
    expect(policy).toEqual(defaultPolicy());
  });

  it("trims and de-duplicates editable terms", () => {
    const policy = sanitizePolicy([
      {
        id: "language",
        enabled: true,
        scope: "description",
        action: "banner",
        terms: [" Dutch ", "Dutch", "", 5],
      },
    ]);
    expect(policy.find((s) => s.id === "language")!.terms).toEqual(["Dutch"]);
  });
});
