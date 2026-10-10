import { CircleHelp } from "lucide-react";
import { Tooltip } from "../components/Tooltip";

interface Props {
  label: string;
  text: string;
}

export function HelpTip({ label, text }: Props) {
  return (
    <Tooltip label={text}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        <CircleHelp size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
