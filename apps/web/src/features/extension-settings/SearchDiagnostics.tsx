import { copy } from "./copy";
import { useEffect, useId, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { api } from "./client";
import { Tooltip } from "../../shared/ui/Tooltip";
import { FIELD, type SettingsDraft } from "./model";

type Settings = SettingsDraft["search_diagnostics"];
const INFO = copy.searchDiagnostics.whenActiveStoresThePageHostAutomaticSearchSeed;

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
      !window.confirm(
        copy.searchDiagnosticsMessages.clearAllStoredSearchDiagnosticsThisCannotBeUndone,
      )
    )
      return;
    setClearing(true);
    onBusyChange(true);
    setStatus(null);
    try {
      await api.clearSearchLog();
      setStatus({ message: copy.searchDiagnostics.storedSearchDiagnosticsCleared, error: false });
    } catch {
      setStatus({
        message: copy.searchDiagnostics.couldnTClearSearchDiagnosticsCheckYourConnectionAnd,
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
        {copy.searchDiagnostics.searchDiagnostics}
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 text-sm text-ink">
            <label htmlFor={id}>{copy.searchDiagnostics.captureSearchDiagnostics}</label>
            <Tooltip label={INFO}>
              <button
                type="button"
                aria-label={copy.searchDiagnostics.aboutSearchDiagnostics}
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
            <option value="never">{copy.searchDiagnostics.never}</option>
            <option value="temporary">{copy.searchDiagnostics.for30Minutes}</option>
            <option value="always">{copy.searchDiagnostics.always}</option>
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
            {clearing
              ? copy.searchDiagnosticsMessages.clearing
              : copy.searchDiagnosticsMessages.clearStoredData}
          </button>
        </div>
      </div>
    </details>
  );
}
