import type { ApplicationStaleness } from "@job-tracker/shared/api";
import { ChevronRight } from "lucide-react";
import { SectionHelp } from "../extension-settings/SectionHelp";
import { copy } from "./copy";

export function StalenessSettingsFields({
  value,
  onChange,
  disabled,
}: {
  value: ApplicationStaleness;
  onChange: (value: ApplicationStaleness) => void;
  disabled: boolean;
}) {
  return (
    <details className="group border-t border-line pt-5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden="true" className="group-open:rotate-90" />
        {copy.stalenessSettings.title}
        <SectionHelp
          title={copy.stalenessSettings.title}
          description={copy.stalenessSettings.description}
        />
      </summary>
      <div className="mt-3 space-y-3">
        {(["applied_days", "in_process_days"] as const).map((key) => (
          <label key={key} className="flex items-center justify-between gap-4 text-sm text-ink">
            <span>
              {key === "applied_days"
                ? copy.stalenessSettings.applied
                : copy.stalenessSettings.inProcess}
            </span>
            <input
              type="number"
              min={0}
              step={1}
              required
              disabled={disabled}
              className="w-24 rounded border border-line bg-surface px-2.5 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
              value={Number.isNaN(value[key]) ? "" : value[key]}
              onChange={(event) => onChange({ ...value, [key]: event.target.valueAsNumber })}
            />
          </label>
        ))}
      </div>
    </details>
  );
}
