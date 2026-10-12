// Only an explicit full-context diagnostic scope authorizes capture.
// Missing, corrupt, or legacy aggregate-only settings default to never.

export const DIAGNOSTICS_KEY = "searchDiagnostics";

// How long the temporary full-context capture window stays open.
export const TEMPORARY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export type DiagnosticsScope = "never" | "temporary" | "always";

export interface DiagnosticsSettings {
  scope: DiagnosticsScope;
  expiresAt: number | null;
}

export const DIAGNOSTICS_DEFAULT: DiagnosticsSettings = { scope: "never", expiresAt: null };

export interface SearchSession {
  host: string | null;
  seed_rule: string | null;
  seed: string | null;
  seed_results: number | null;
  query: string | null;
  results: number | null;
  job_id: string | null;
}

// Legacy aggregate settings cannot authorize full capture. Only an unexpired
// detailed window migrates to temporary capture.
export function sanitizeDiagnostics(value: unknown): DiagnosticsSettings {
  if (!value || typeof value !== "object") return { ...DIAGNOSTICS_DEFAULT };
  const v = value as Record<string, unknown>;
  if (v.scope === "always") return { scope: "always", expiresAt: null };
  if (v.scope === "temporary" && typeof v.expiresAt === "number" && Number.isFinite(v.expiresAt)) {
    return { scope: "temporary", expiresAt: v.expiresAt };
  }
  if (
    v.enabled === true &&
    typeof v.detailedUntil === "number" &&
    Number.isFinite(v.detailedUntil) &&
    v.detailedUntil > Date.now()
  ) {
    return { scope: "temporary", expiresAt: v.detailedUntil };
  }
  return { ...DIAGNOSTICS_DEFAULT };
}

export function activeDiagnosticsScope(s: DiagnosticsSettings, now = Date.now()): DiagnosticsScope {
  if (s.scope === "always") return "always";
  if (s.scope === "temporary" && s.expiresAt != null && s.expiresAt > now) return "temporary";
  return "never";
}

// The body to POST for a finished search session under the current settings, or
// null when capture is disabled or its temporary window has expired.
export function diagnosticsBody(
  s: DiagnosticsSettings,
  session: SearchSession,
  now = Date.now(),
): Record<string, unknown> | null {
  if (activeDiagnosticsScope(s, now) === "never") return null;
  return { ...session };
}

// Read the stored settings; safe default when nothing is stored or the value is
// corrupt at rest.
export function loadDiagnostics(cb: (s: DiagnosticsSettings) => void): void {
  chrome.storage.local.get(DIAGNOSTICS_KEY, (data) =>
    cb(sanitizeDiagnostics(data[DIAGNOSTICS_KEY])),
  );
}

// Validated writes notify other contexts through chrome.storage.onChanged.
export function saveDiagnostics(
  s: DiagnosticsSettings,
  cb?: (s: DiagnosticsSettings) => void,
): void {
  const clean = sanitizeDiagnostics(s);
  chrome.storage.local.set({ [DIAGNOSTICS_KEY]: clean }, () => cb?.(clean));
}
