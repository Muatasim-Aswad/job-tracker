import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Filter } from "lucide-react";
import { IconButton } from "./IconButton";

export function FilterPopover({
  applied = false,
  label,
  children,
}: {
  applied?: boolean;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  return (
    <div
      ref={ref}
      className="ml-auto shrink-0 sm:ml-0"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          ref.current?.querySelector("button")?.focus();
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
          setOpen(false);
      }}
    >
      <IconButton
        type="button"
        label={applied ? "Filters applied" : "Filters"}
        size="field"
        active={open}
        activeMeans="expanded"
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
        className={applied ? "text-accent" : "text-ink-muted hover:text-ink"}
      >
        <Filter size={16} aria-hidden="true" />
      </IconButton>
      {open && (
        <div
          id={id}
          role="group"
          aria-label={label}
          className="absolute right-0 top-full z-20 mt-2 max-h-[70vh] w-72 max-w-full space-y-4 overflow-y-auto rounded-lg border border-line bg-surface p-4 text-sm text-ink shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}
