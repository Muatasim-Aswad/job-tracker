// Replay Python-generated normalization cases to prevent blocklist-key drift.
import { describe, expect, it } from "vitest";

import golden from "./text.golden.json";
import { normalizeCompany, normalizeTitle } from "./index";

describe("text golden", () => {
  it("matches the Python normalizers case-for-case", () => {
    for (const { input, company, title } of golden.cases) {
      expect(normalizeCompany(input)).toBe(company);
      expect(normalizeTitle(input)).toBe(title);
    }
  });
});
