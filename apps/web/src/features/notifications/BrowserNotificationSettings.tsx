import { useEffect, useId, useRef, useState } from "react";
import { BUTTON } from "../extension-settings/model";
import { SectionHelp } from "../extension-settings/SectionHelp";
import { disablePush, enablePush, pushEnabled, pushSupported } from "./push";
import { copy } from "./copy";

function permission(): NotificationPermission {
  return typeof Notification === "undefined" ? "denied" : Notification.permission;
}

export function BrowserNotificationSettings({ disabled }: { disabled: boolean }) {
  const supported = pushSupported();
  const id = useId();
  const changing = useRef(false);
  const [allowed, setAllowed] = useState(permission);
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(supported && allowed !== "denied");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (changing.current) return;
      setError(null);
      const current = permission();
      setAllowed(current);
      if (!supported || current === "denied") {
        setChecking(false);
        return;
      }
      setChecking(true);
      try {
        const value = await pushEnabled();
        if (active) setEnabled(value);
      } catch {
        if (active) setError(copy.permissionError);
      } finally {
        if (active) setChecking(false);
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [supported]);
  async function toggle() {
    changing.current = true;
    setBusy(true);
    setError(null);
    try {
      if (enabled) await disablePush();
      else await enablePush();
      setEnabled(!enabled);
      setAllowed(permission());
    } catch (failure) {
      const current = permission();
      setAllowed(current);
      if (current !== "denied")
        setError(failure instanceof Error ? failure.message : copy.permissionError);
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 text-sm text-ink">
          <span>{copy.browserSettings}</span>
          <SectionHelp
            title={copy.browserSettings}
            description={
              !supported
                ? copy.pushRequirements
                : allowed === "denied"
                  ? copy.browserBlockedHelp
                  : allowed === "granted" && !enabled
                    ? copy.browserAllowedHelp
                    : copy.pushHelp
            }
          />
        </div>
        {!supported || allowed === "denied" ? (
          <span className="text-xs text-ink-muted">
            {supported ? copy.browserBlocked : copy.browserUnavailable}
          </span>
        ) : checking ? (
          <span role="status" className="text-xs text-ink-muted">
            {copy.checkingPermission}
          </span>
        ) : (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => void toggle()}
            aria-describedby={error ? id : undefined}
            className={BUTTON + " h-[38px] w-32 shrink-0 sm:w-44 border border-line"}
          >
            {busy
              ? copy.requestingPermission
              : enabled
                ? copy.disablePush
                : allowed === "default"
                  ? copy.allowBrowser
                  : copy.enablePush}
          </button>
        )}
      </div>
      {error && (
        <p id={id} role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
