import { useEffect, useId, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { api } from "../api/client";
import { Tooltip } from "../components/Tooltip";
import { FIELD, type SettingsDraft } from "./model";

type Settings = SettingsDraft["search_diagnostics"];
const INFO =
  "When active, stores the page host, automatic search seed and extraction rule, result counts, replacement query, and opened job on this server. Keeps the newest 1,000 diagnostic rows.";

export function SearchDiagnostics({
  settings,
  onChange,
  disabled,
  onBusyChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const id = useId();
  const [clearing, setClearing] = useState(false);
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);
  const [, setNow] = useState(Date.now);
  useEffect(() => {
    if (settings.scope !== "temporary" || settings.expires_at == null) return;
    const remaining = settings.expires_at - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(timer);
  }, [settings.scope, settings.expires_at]);
  const scope =
    settings.scope === "always"
      ? "always"
      : settings.scope === "temporary" && settings.expires_at && settings.expires_at > Date.now()
        ? "temporary"
        : "never";
  const clear = async () => {
    if (
      disabled ||
      clearing ||
      !window.confirm("Clear all stored search diagnostics? This cannot be undone.")
    )
      return;
    setClearing(true);
    onBusyChange(true);
    setStatus(null);
    try {
      await api.clearSearchLog();
      setStatus({ message: "Stored search diagnostics cleared.", error: false });
    } catch {
      setStatus({
        message: "Couldn’t clear search diagnostics. Check your connection and try again.",
        error: true,
      });
    } finally {
      setClearing(false);
      onBusyChange(false);
    }
  };
  return (
    <details className="group border-t border-line pt-5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden="true" className="group-open:rotate-90" />
        Search diagnostics
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 text-sm text-ink">
            <label htmlFor={id}>Capture search diagnostics</label>
            <Tooltip label={INFO}>
              <button
                type="button"
                aria-label="About search diagnostics"
                className="rounded p-1 text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Info size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          <select
            id={id}
            className={FIELD + " max-w-44"}
            value={scope}
            disabled={disabled || clearing}
            onChange={(event) => {
              const next = event.target.value as Settings["scope"];
              onChange({
                scope: next,
                expires_at: next === "temporary" ? Date.now() + 30 * 60 * 1000 : null,
              });
            }}
          >
            <option value="never">Never</option>
            <option value="temporary">For 30 minutes</option>
            <option value="always">Always</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {status && (
            <span
              role={status.error ? "alert" : "status"}
              className={"mr-auto text-xs " + (status.error ? "text-red-500" : "text-ink-muted")}
            >
              {status.message}
            </span>
          )}
          <button
            type="button"
            disabled={disabled || clearing}
            onClick={() => {
              void clear();
            }}
            className="rounded px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-500/10 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 dark:text-red-400"
          >
            {clearing ? "Clearing…" : "Clear stored data"}
          </button>
        </div>
      </div>
    </details>
  );
}
