// Search-diagnostics gate: a fresh install sends nothing, while temporary and
// always scopes send the same complete debugging context.
import { describe, expect, it } from "vitest";

import {
  DIAGNOSTICS_DEFAULT,
  TEMPORARY_WINDOW_MS,
  type SearchSession,
  activeDiagnosticsScope,
  diagnosticsBody,
} from "./diagnostics";

const SESSION: SearchSession = {
  host: "mail.google.com",
  seed_rule: "gmail-subject",
  seed: "Sample Company Corp",
  seed_results: 0,
  query: "Sample Company",
  results: 3,
  job_id: "j-42",
};

describe("diagnosticsBody — what actually goes on the wire", () => {
  it("sends nothing on a fresh (disabled) install", () => {
    expect(diagnosticsBody(DIAGNOSTICS_DEFAULT, SESSION)).toBeNull();
  });

  it("sends complete context in always mode", () => {
    expect(diagnosticsBody({ scope: "always", expiresAt: null }, SESSION)).toEqual(SESSION);
  });

  it("sends the same complete context inside a temporary window", () => {
    const now = 1_000_000;
    const live = { scope: "temporary" as const, expiresAt: now + 1_000 };
    expect(diagnosticsBody(live, SESSION, now)).toEqual(SESSION);
  });

  it("sends nothing once the temporary window has expired", () => {
    const now = 1_000_000;
    const expired = { scope: "temporary" as const, expiresAt: now - 1 };
    expect(activeDiagnosticsScope(expired, now)).toBe("never");
    expect(diagnosticsBody(expired, SESSION, now)).toBeNull();
  });

  it("treats TEMPORARY_WINDOW_MS as a real bound", () => {
    const now = 1_000_000;
    const s = { scope: "temporary" as const, expiresAt: now + TEMPORARY_WINDOW_MS };
    expect(activeDiagnosticsScope(s, now)).toBe("temporary");
    expect(activeDiagnosticsScope(s, now + TEMPORARY_WINDOW_MS + 1)).toBe("never");
  });
});
