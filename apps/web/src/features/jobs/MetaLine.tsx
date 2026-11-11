import { Fragment, type ReactNode } from "react";

// Drop falsy metadata items; semantic color belongs to each item, not the shared line.
export function MetaLine({ items, className = "" }: { items: ReactNode[]; className?: string }) {
  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-micro text-ink-muted ${className}`}
    >
      {shown.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span aria-hidden className="text-ink-subtle">
              ·
            </span>
          )}
          <span>{item}</span>
        </Fragment>
      ))}
    </div>
  );
}
