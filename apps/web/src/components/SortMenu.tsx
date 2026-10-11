import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownUp, Check } from "lucide-react";
import { SORT_OPTIONS, type SortOrder } from "../lib/jobSort";
import { IconButton } from "./IconButton";
import { useFocusTrap } from "../lib/useFocusTrap";

interface Props {
  value: SortOrder;
  onChange: (value: SortOrder) => void;
}

interface ChoiceProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  menuLabel: string;
  actionLabel?: string;
  size?: "md" | "field";
  className?: string;
}

const ITEM =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none";

function SortMenuDropdown<T extends string>({
  value,
  onChange,
  options,
  menuLabel,
  onClose,
}: ChoiceProps<T> & { onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  useFocusTrap(menuRef, onClose);

  // Open on the current choice. This makes repeat visits predictable and still
  // leaves Arrow/Home/End to rove through all six radio items.
  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLElement>(`[role="menuitemradio"][data-value="${value}"]`)
      ?.focus();
  }, [value]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={menuLabel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-line bg-surface py-1 shadow-lg outline-none"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            data-value={option.value}
            onClick={() => {
              onChange(option.value);
              onClose();
            }}
            className={ITEM}
          >
            <Check size={13} className={selected ? "text-accent" : "invisible"} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SortChoiceMenu<T extends string>({
  value,
  onChange,
  options,
  menuLabel,
  actionLabel = "Sort",
  size = "md",
  className = "text-ink-muted hover:text-ink",
}: ChoiceProps<T>) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const label = options.find((option) => option.value === value)?.label ?? menuLabel;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <IconButton
        label={`${actionLabel}: ${label}`}
        size={size}
        active={open}
        activeMeans="expanded"
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className={className}
      >
        <ArrowDownUp size={16} aria-hidden="true" />
      </IconButton>
      {open && (
        <SortMenuDropdown
          value={value}
          onChange={onChange}
          options={options}
          menuLabel={menuLabel}
          onClose={close}
        />
      )}
    </div>
  );
}

export function SortMenu({ value, onChange }: Props) {
  return (
    <SortChoiceMenu
      value={value}
      onChange={onChange}
      options={SORT_OPTIONS}
      menuLabel="Sort jobs"
      size="field"
    />
  );
}
