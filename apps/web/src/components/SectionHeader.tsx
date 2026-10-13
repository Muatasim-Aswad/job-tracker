import { ChevronRight, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./IconButton";
import { Tooltip } from "./Tooltip";

interface Props {
  // Keep count out of the section title.
  title: string;
  // Omit count only when nothing is countable; zero remains meaningful.
  count?: number;
  // The noun supplies consistent Add/Cancel accessible labels.
  add?: { noun: string; open: boolean; onToggle: () => void };
  // Optional help for non-obvious sections.
  help?: string;
  collapse?: { collapsed: boolean; controlsId: string; onToggle: () => void };
  children?: ReactNode;
  className?: string;
}

// Shared title, count, disclosure, help, and add controls keep section headings consistent.
export function SectionHeader({
  title,
  count,
  add,
  help,
  collapse,
  children,
  className = "",
}: Props) {
  const heading = (
    <>
      {title}
      {count === undefined ? "" : ` (${count})`}
    </>
  );
  return (
    <div className={`mb-2 flex items-center justify-between gap-2 ${className}`}>
      <div className="flex items-center gap-1">
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">
          {collapse ? (
            <button
              type="button"
              aria-label={`${collapse.collapsed ? "Expand" : "Collapse"} ${title}`}
              aria-expanded={!collapse.collapsed}
              aria-controls={collapse.controlsId}
              onClick={collapse.onToggle}
              className="flex min-h-6 items-center gap-1 rounded pr-1 text-left uppercase tracking-wide hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 pointer-coarse:min-h-9"
            >
              <ChevronRight
                size={14}
                aria-hidden="true"
                className={collapse.collapsed ? "" : "rotate-90"}
              />
              {heading}
            </button>
          ) : (
            heading
          )}
        </h3>
        {help && (
          <Tooltip label={help}>
            <button
              type="button"
              aria-label={`About ${title}`}
              className="flex h-4 w-4 items-center justify-center rounded-full border border-line text-micro leading-none text-ink-muted transition-colors hover:border-line-strong hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              ?
            </button>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center gap-1">
        {children}
        {add && (
          <IconButton
            size="sm"
            active={add.open}
            activeMeans="expanded"
            onClick={add.onToggle}
            label={add.open ? `Cancel adding ${add.noun}` : `Add ${add.noun}`}
            className={
              add.open
                ? "text-violet-600 dark:text-violet-300"
                : "text-ink-faint hover:text-ink-soft"
            }
          >
            {add.open ? <X size={15} /> : <Plus size={15} />}
          </IconButton>
        )}
      </div>
    </div>
  );
}
