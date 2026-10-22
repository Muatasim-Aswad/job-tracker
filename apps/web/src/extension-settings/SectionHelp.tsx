import { Info } from "lucide-react";
import { Tooltip } from "../components/Tooltip";

export function SectionHelp({ title, description }: { title: string; description: string }) {
  return (
    <Tooltip label={description} stopPropagation>
      <button
        type="button"
        aria-label={`About ${title}`}
        onClick={(event) => event.preventDefault()}
        className="rounded p-1 text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Info size={14} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
