import { loadPreferences } from "../preferences.js";

// Only an explicit full-context diagnostic scope authorizes capture.
// Capture stays disabled until the server settings arrive.

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

export function loadDiagnostics(callback: (settings: DiagnosticsSettings) => void): void {
  void loadPreferences()
    .then(({ settings }) =>
      callback({
        scope: settings.search_diagnostics.scope,
        expiresAt: settings.search_diagnostics.expires_at,
      }),
    )
    .catch(() => callback(DIAGNOSTICS_DEFAULT));
}
