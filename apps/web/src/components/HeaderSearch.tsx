import type { ReactNode, RefObject } from "react";
import { X } from "lucide-react";

interface Props {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  maxLength?: number;
  count: ReactNode;
  countLabel: string;
  countId?: string;
  active?: boolean;
  onClear?: () => void;
  children?: ReactNode;
}

export function HeaderSearch({
  label,
  placeholder,
  value,
  onChange,
  inputRef,
  maxLength,
  count,
  countLabel,
  countId,
  active = false,
  onClear,
  children,
}: Props) {
  return (
    <div
      className={`flex min-h-[38px] min-w-0 flex-1 flex-wrap items-stretch overflow-hidden rounded-lg border bg-surface ${active ? "border-accent ring-2 ring-accent/20" : "border-line"}`}
    >
      <div className="flex h-9 min-w-0 basis-[180px] flex-1 items-stretch">
        <input
          ref={inputRef}
          type="search"
          aria-label={label}
          aria-describedby={countId}
          placeholder={placeholder}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onChange("");
              event.currentTarget.blur();
            }
          }}
          className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 text-sm font-normal text-ink outline-none placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
        />
        <div
          id={countId}
          title={countLabel}
          aria-label={countLabel}
          className="flex shrink-0 items-center gap-1.5 border-l border-line px-2 text-xs tabular-nums text-ink-muted"
        >
          <span>{count}</span>
          {active && onClear && (
            <button
              type="button"
              aria-label="Clear filters"
              title="Clear filters"
              onClick={onClear}
              className="inline-flex size-6 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 pointer-coarse:size-9"
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
