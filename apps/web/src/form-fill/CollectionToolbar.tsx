import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Filter } from "lucide-react";
import { IconButton } from "../components/IconButton";

export function CollectionToolbar({
  host,
  children,
}: {
  host?: HTMLElement | null;
  children: ReactNode;
}) {
  const controls = (
    <div
      role="group"
      aria-label="Filters"
      className="relative flex w-full min-w-0 flex-wrap items-center gap-2"
    >
      {children}
    </div>
  );
  return host ? createPortal(controls, host) : controls;
}

export function CollectionSearch({
  label,
  placeholder,
  value,
  onChange,
  count,
  hasNextPage = false,
  loading = false,
  itemName,
  maxLength,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  count: number | null;
  hasNextPage?: boolean;
  loading?: boolean;
  itemName: "question" | "answer";
  maxLength?: number;
}) {
  const id = useId();
  const description =
    count == null
      ? loading
        ? `Loading ${itemName}s`
        : "Count unavailable"
      : `${count} ${itemName}${count === 1 ? "" : "s"} ${hasNextPage ? "loaded; more available" : "shown"}.`;
  return (
    <div className="flex h-[38px] min-w-0 flex-1 items-stretch rounded-md border border-line bg-surface">
      <label className="min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        <input
          type="search"
          placeholder={placeholder}
          value={value}
          maxLength={maxLength}
          aria-describedby={id}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onChange("");
              event.currentTarget.blur();
            }
          }}
          className="h-full w-full min-w-0 rounded-l-md bg-transparent px-3 text-sm font-normal text-ink outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
        />
      </label>
      <span
        id={id}
        title={description}
        aria-label={description}
        className="flex shrink-0 items-center border-l border-line px-2 text-xs tabular-nums text-ink-muted"
      >
        {count == null ? (loading ? "…" : "—") : `${count}${hasNextPage ? "+" : ""}`}
      </span>
    </div>
  );
}

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
      className="shrink-0"
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
        className="relative border border-line bg-surface text-ink"
      >
        <Filter size={16} aria-hidden="true" />
        {applied && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 size-1.5 rounded-full bg-accent"
          />
        )}
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
