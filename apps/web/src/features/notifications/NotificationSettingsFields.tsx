import { useId } from "react";
import { FIELD } from "../extension-settings/model";
import { ChevronRight } from "lucide-react";
import type { ApplicationStaleness, Preferences } from "@job-tracker/shared/api";
import { SectionHelp } from "../extension-settings/SectionHelp";
import { BrowserNotificationSettings } from "./BrowserNotificationSettings";
import { copy } from "./copy";

export function NotificationSettingsFields({
  value,
  onChange,
  staleness,
  onStalenessChange,
  disabled,
}: {
  value: Preferences["notifications"];
  onChange: (value: Preferences["notifications"]) => void;
  disabled: boolean;
  staleness: ApplicationStaleness;
  onStalenessChange: (value: ApplicationStaleness) => void;
}) {
  const muteId = useId();
  return (
    <details className="group border-t border-line pt-5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden="true" className="group-open:rotate-90" />
        {copy.title}
        <SectionHelp title={copy.title} description={copy.pushHelp} />
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 text-sm text-ink">
            <label htmlFor={muteId}>{copy.muteAll}</label>
            <SectionHelp title={copy.muteAll} description={copy.muteHelp} />
          </div>
          <input
            id={muteId}
            type="checkbox"
            className="shrink-0 accent-accent"
            disabled={disabled}
            checked={value.muted}
            onChange={(event) => onChange({ muted: event.target.checked })}
          />
        </div>
        <BrowserNotificationSettings disabled={disabled} />
        <fieldset className="space-y-3 pt-1">
          <legend className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
            {copy.staleSettings.title}
            <SectionHelp title={copy.staleSettings.title} description={copy.staleSettings.help} />
          </legend>
          {(["applied", "in_process"] as const).map((stage) => {
            const key = `${stage}_notifications` as const;
            return (
              <label
                key={stage}
                className="flex items-center justify-between gap-4 text-sm text-ink"
              >
                <span>
                  {stage === "applied"
                    ? copy.staleSettings.appliedLabel
                    : copy.staleSettings.inProcessLabel}
                </span>
                <select
                  disabled={disabled}
                  aria-label={
                    stage === "applied" ? copy.staleSettings.applied : copy.staleSettings.inProcess
                  }
                  value={staleness[key]}
                  className={FIELD + " max-w-32 sm:max-w-44"}
                  onChange={(event) =>
                    onStalenessChange({
                      ...staleness,
                      [key]: event.target.value as ApplicationStaleness[typeof key],
                    })
                  }
                >
                  <option value="on">{copy.staleSettings.on}</option>
                  <option value="muted">{copy.staleSettings.muted}</option>
                  <option value="off">{copy.staleSettings.off}</option>
                </select>
              </label>
            );
          })}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 text-sm text-ink">
              <label htmlFor={`${muteId}-time`}>{copy.staleSettings.time}</label>
              <SectionHelp
                title={copy.staleSettings.time}
                description={copy.staleSettings.timezone(staleness.timezone)}
              />
            </div>
            <input
              id={`${muteId}-time`}
              type="time"
              required
              disabled={disabled}
              className={FIELD + " max-w-32 sm:max-w-44"}
              value={staleness.notification_time}
              onChange={(event) =>
                onStalenessChange({ ...staleness, notification_time: event.target.value })
              }
            />
          </div>
        </fieldset>
      </div>
    </details>
  );
}
