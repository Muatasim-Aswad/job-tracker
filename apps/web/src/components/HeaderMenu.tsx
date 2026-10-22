import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Ban,
  SlidersHorizontal,
  Keyboard,
  Monitor,
  Moon,
  Menu,
  Plus,
  RefreshCw,
  Sun,
  Check,
  Info,
} from "lucide-react";
import { IconButton } from "./IconButton";
import { focusableElements, useFocusTrap } from "../lib/useFocusTrap";
import type { ThemePref } from "../lib/theme";

const THEME_FACE: Record<ThemePref, { icon: ReactNode; label: string }> = {
  system: { icon: <Monitor size={14} />, label: "System" },
  light: { icon: <Sun size={14} />, label: "Light" },
  dark: { icon: <Moon size={14} />, label: "Dark" },
};

const ITEM =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none";
const KBD = "ml-auto rounded border border-line px-1.5 py-0.5 font-mono text-micro text-ink-muted";

interface DropdownProps {
  onClose: () => void;
  onOpenBlocked: () => void;
  onOpenExtensionSettings: () => void;
  onOpenHelp: () => void;
  onOpenAbout: () => void;
  themePref: ThemePref;
  cycleTheme: () => void;
  view: "jobs" | "form-fill";
  hasReview: boolean;
  onChangeView: (view: "jobs" | "form-fill") => void;
  onAdd?: (() => void) | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

// Mount lifetime equals open lifetime, allowing the focus trap to restore its trigger.
function HeaderMenuDropdown({
  onClose,
  onOpenBlocked,
  onOpenExtensionSettings,
  onOpenHelp,
  onOpenAbout,
  themePref,
  cycleTheme,
  view,
  hasReview,
  onChangeView,
  onAdd,
  onRefresh,
  refreshing,
}: DropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);

  // Focus the first item after the trap's container-focus effect.
  const menuItems = () =>
    ref.current
      ? focusableElements(ref.current).filter((item) => item.getAttribute("role") === "menuitem")
      : [];
  useEffect(() => {
    menuItems()[0]?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = menuItems();
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length]?.focus();
    }
  };

  const face = THEME_FACE[themePref];

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Navigation and settings"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-line bg-surface py-1 shadow-lg outline-none"
    >
      <div data-mobile-navigation className="border-b border-line pb-1 mb-1 sm:hidden">
        {(["jobs", "form-fill"] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="menuitem"
            aria-current={view === item ? "page" : undefined}
            disabled={view === item}
            className={`${ITEM} ${view === item ? "bg-sunken font-semibold disabled:hover:bg-sunken" : ""}`}
            onClick={() => {
              onChangeView(item);
              onClose();
            }}
          >
            <span className="flex-1">{item === "jobs" ? "Jobs" : "Form Fill"}</span>
            {view === item && <Check size={14} aria-hidden="true" className="text-accent" />}
            {item === "form-fill" && hasReview && (
              <span className="size-2 rounded-full bg-amber-500" aria-label="Items need review" />
            )}
          </button>
        ))}
        {(onAdd || onRefresh) && <hr className="my-1 border-line" />}
        {onAdd && (
          <button
            type="button"
            role="menuitem"
            className={ITEM}
            onClick={() => {
              onAdd();
              onClose();
            }}
          >
            <Plus size={14} aria-hidden="true" />
            <span>{view === "jobs" ? "Add a job" : "New answer"}</span>
          </button>
        )}
        {onRefresh && (
          <button
            type="button"
            role="menuitem"
            className={ITEM}
            disabled={refreshing}
            onClick={() => {
              onRefresh();
              onClose();
            }}
          >
            <RefreshCw
              size={14}
              aria-hidden="true"
              className={refreshing ? "animate-spin motion-reduce:animate-none" : ""}
            />
            <span>{refreshing ? "Refreshing…" : "Refresh data"}</span>
          </button>
        )}
      </div>
      <div role="group" aria-label="Companies">
        <button
          role="menuitem"
          onClick={() => {
            onOpenBlocked();
            onClose();
          }}
          className={ITEM}
        >
          <Ban size={14} className="text-ink-muted" />
          <span>Blocked companies…</span>
        </button>
      </div>
      <hr className="my-1 border-line" />
      <div role="group" aria-label="Settings">
        <button
          role="menuitem"
          onClick={() => {
            onOpenExtensionSettings();
            onClose();
          }}
          className={ITEM}
        >
          <SlidersHorizontal size={14} className="text-ink-muted" />
          <span>Extension settings…</span>
        </button>
        <button
          role="menuitem"
          onClick={() => {
            cycleTheme();
            onClose();
          }}
          className={ITEM}
        >
          {face.icon}
          <span>Theme: {face.label}</span>
          <kbd className={KBD}>t</kbd>
        </button>
      </div>
      <hr className="my-1 border-line" />
      <button
        role="menuitem"
        onClick={() => {
          onOpenHelp();
          onClose();
        }}
        className={ITEM}
      >
        <Keyboard size={14} className="text-ink-muted" />
        <span>Keyboard shortcuts</span>
        <kbd className={KBD}>?</kbd>
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onOpenAbout();
          onClose();
        }}
        className={ITEM}
      >
        <Info size={14} className="text-ink-muted" />
        <span>About</span>
      </button>
    </div>
  );
}

export function HeaderMenu(props: Omit<DropdownProps, "onClose">) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  // Include trigger and dropdown in the outside-click boundary to avoid reopening.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  return (
    <div className="relative ml-auto shrink-0 lg:ml-0" ref={wrapRef}>
      <IconButton
        label="Navigation and settings"
        size="field"
        active={open}
        activeMeans="expanded"
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="text-ink-muted hover:text-ink"
      >
        <Menu size={16} />
      </IconButton>
      {open && <HeaderMenuDropdown {...props} onClose={close} />}
    </div>
  );
}
