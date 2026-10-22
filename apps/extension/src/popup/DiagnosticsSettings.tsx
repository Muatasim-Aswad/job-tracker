import type { PreferencesEditor } from "./usePreferences";
import { useEffect, useState } from "react";
import {
  TEMPORARY_WINDOW_MS,
  type DiagnosticsScope,
  activeDiagnosticsScope,
} from "../engine/diagnostics.js";
import { FOCUS } from "./ui";

// One scope selector controls full-context search logging. "30 minutes" is a
// self-expiring debugging session; "Always" persists until explicitly changed.

export function DiagnosticsSettings({ editor }: { editor: PreferencesEditor }) {
  const stored = editor.settings!.search_diagnostics;
  const settings = { scope: stored.scope, expiresAt: stored.expires_at };
  const [, setNow] = useState(Date.now);
  useEffect(() => {
    if (stored.scope !== "temporary" || stored.expires_at == null) return;
    const remaining = stored.expires_at - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(timer);
  }, [stored.scope, stored.expires_at]);

  function setScope(scope: DiagnosticsScope) {
    void editor.save({
      search_diagnostics: {
        scope,
        expires_at: scope === "temporary" ? Date.now() + TEMPORARY_WINDOW_MS : null,
      },
    });
  }

  const scope = activeDiagnosticsScope(settings);

  return (
    <details className="mt-1 border-t border-popup-border-subtle pt-1.5">
      <summary className="cursor-pointer list-none py-1.5 text-[10px] font-semibold uppercase tracking-wider text-popup-faint marker:hidden before:mr-1.5 before:inline-block before:content-['▸'] open:before:rotate-90">
        Search diagnostics
      </summary>
      <div className="mt-1.5">
        <label className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-popup-fg">Capture search diagnostics</span>
          <select
            className={
              "rounded border border-popup-border bg-popup-surface px-1.5 py-1 text-xs " + FOCUS
            }
            disabled={editor.saving}
            value={scope}
            onChange={(e) => setScope(e.target.value as DiagnosticsScope)}
          >
            <option value="never">Never</option>
            <option value="temporary">30 minutes</option>
            <option value="always">Always</option>
          </select>
        </label>
      </div>
    </details>
  );
}
