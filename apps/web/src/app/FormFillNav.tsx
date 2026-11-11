import { copy } from "./copy";
import { Tooltip } from "../shared/ui/Tooltip";

interface Props {
  view: "jobs" | "form-fill";
  hasReview: boolean;
  onChange: (view: "jobs" | "form-fill") => void;
}

export function FormFillNav({ view, hasReview, onChange }: Props) {
  return (
    <nav
      aria-label={copy.formFillNav.primaryWorkspace}
      className="flex rounded-md border border-line bg-surface p-0.5"
    >
      {(["jobs", "form-fill"] as const).map((item) => {
        const selected = view === item;
        const button = (
          <button
            key={item}
            type="button"
            aria-current={selected ? "page" : undefined}
            onClick={() => onChange(item)}
            className={`relative rounded px-2 py-1.5 text-sm font-medium sm:px-3 pointer-coarse:min-h-9 ${
              selected ? "bg-surface-hover text-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            {item === "jobs" ? copy.formFillNavMessages.jobs : copy.formFillNavMessages.formFill}
            {item === "form-fill" && hasReview && (
              <span
                className="ml-1.5 inline-block size-2 rounded-full bg-amber-500"
                aria-label={copy.formFillNav.itemsNeedReview}
              />
            )}
          </button>
        );
        return item === "form-fill" ? (
          <Tooltip
            key={item}
            label={copy.formFillNav.chooseTheAnswersJobTrackerCanReuseInApplication}
            toggleOnClick={false}
          >
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </nav>
  );
}
