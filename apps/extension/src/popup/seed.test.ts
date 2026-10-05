import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeedResult, seedFromTab as SeedFromTab } from "./seed";

// seed.ts reads chrome.runtime.getManifest() at module load (SUPPORTED_BASES), so the
// stub must exist BEFORE the dynamic import. We mirror the real content-script hosts.
let seedFromTab: typeof SeedFromTab;

beforeEach(async () => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      getManifest: () => ({
        content_scripts: [{ matches: ["https://www.linkedin.com/*", "https://mail.google.com/*"] }],
      }),
    },
  };
  vi.resetModules();
  ({ seedFromTab } = await import("./seed"));
});
afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

const tab = (url: string, title = ""): chrome.tabs.Tab => ({ url, title }) as chrome.tabs.Tab;
const seed = (url: string, title?: string): SeedResult => seedFromTab(tab(url, title));

const gmailTitle = (subject: string) => `${subject} - me@example.com - Gmail`;
const gmail = (subject: string) =>
  seed("https://mail.google.com/mail/u/0/#inbox", gmailTitle(subject));

describe("seedFromTab — Gmail", () => {
  it("uses the company pattern when a subject shape matches", () => {
    expect(gmail("Software Engineer at ExampleCompany")).toEqual({
      value: "ExampleCompany",
      rule: "gmail-subject",
    });
  });

  it("falls back to the subject's first word when no shape matches", () => {
    expect(gmail("Chainfill Next steps")).toEqual({
      value: "Chainfill",
      rule: "gmail-subject-fallback",
    });
  });

  it("extracts the company from an 'interest in' subject instead of falling back", () => {
    expect(gmail("Thank you for your interest in Cloudpeak")).toEqual({
      value: "Cloudpeak",
      rule: "gmail-subject",
    });
  });

  it("does not fall back to a generic opener with no company", () => {
    // "Thank you for applying!" has no company; an empty box beats a res=0 "Thank".
    expect(gmail("Thank you for applying!")).toEqual({ value: "", rule: "none" });
  });

  it("does not seed on a list view", () => {
    expect(gmail("Inbox")).toEqual({ value: "", rule: "none" });
  });
});

describe("seedFromTab — LinkedIn job view", () => {
  const job = (title: string, path = "/jobs/view/4469726251/") =>
    seed(`https://www.linkedin.com${path}`, title);

  it("seeds the company from the job title", () => {
    expect(job("Robotics Software Engineer | Lely | LinkedIn")).toEqual({
      value: "Lely",
      rule: "linkedin-title",
    });
  });

  it("ignores a notification count and a role containing the separator", () => {
    expect(job("(10) Backend Engineer | Remote | Example Company | LinkedIn")).toEqual({
      value: "Example",
      rule: "linkedin-title",
    });
  });

  it("does not seed from a title without a company segment", () => {
    expect(job("LinkedIn")).toEqual({ value: "", rule: "none" });
  });

  it("does not seed from a search page title", () => {
    expect(
      job("(10) software engineer Jobs | LinkedIn", "/jobs/search/?currentJobId=4469726251"),
    ).toEqual({ value: "", rule: "none" });
  });
});

describe("seedFromTab — non-web tabs", () => {
  it("does not seed on a chrome:// page", () => {
    expect(seed("chrome://extensions")).toEqual({ value: "", rule: "none" });
  });
});

describe("seedFromTab — non-Gmail (unchanged)", () => {
  it("skips a supported content-script host", () => {
    expect(seed("https://www.linkedin.com/jobs/view/123")).toEqual({ value: "", rule: "none" });
  });

  it("seeds the domain label off a plain company site", () => {
    expect(seed("https://careers.examplecompany.com/jobs/42")).toEqual({
      value: "examplecompany",
      rule: "domain-label",
    });
  });

  it("seeds the path segment on an ATS host", () => {
    expect(seed("https://boards.greenhouse.io/globex/jobs/99")).toEqual({
      value: "globex",
      rule: "ats-path",
    });
  });
});
