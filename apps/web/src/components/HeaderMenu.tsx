import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Ban, Keyboard, Monitor, Moon, MoreHorizontal, Sun } from "lucide-react";
import { IconButton } from "./IconButton";
import { useFocusTrap } from "../lib/useFocusTrap";
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
  onOpenHelp: () => void;
  themePref: ThemePref;
  cycleTheme: () => void;
}

// The dropdown's own mount lifetime *is* the open state (rendered only while
// `open`), so useFocusTrap's mount/unmount effects land exactly on open/close —
// the same trick ShortcutsDialog and AddJobDialog rely on for Esc-close, Tab
// cycling, and restoring focus to whatever was focused (the ⋯ trigger) on close.
function HeaderMenuDropdown({
  onClose,
  onOpenBlocked,
  onOpenHelp,
  themePref,
  cycleTheme,
}: DropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);

  // Land focus on the first item rather than the container — the ARIA menu
  // pattern. Declared after useFocusTrap so its mount effect (which focuses the
  // container) runs first and this one overrides it.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  // Roving arrow-key navigation between items, same pattern as JobCard's
  // change-status menu.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  };

  const face = THEME_FACE[themePref];

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="More"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-line bg-surface py-1 shadow-lg outline-none"
    >
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
  );
}

// The header's overflow menu: rare items (blocked companies, the shortcuts
// sheet, theme) get names instead of glyphs, so future settings land here
// without widening the header. The trigger stays mounted always; only the
// dropdown mounts/unmounts with `open`.
export function HeaderMenu(props: {
  onOpenBlocked: () => void;
  onOpenHelp: () => void;
  themePref: ThemePref;
  cycleTheme: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  // Outside-click closes, same as JobCard's status menu. Scoped to the wrapper
  // (trigger + dropdown together) so clicking the trigger to close never
  // immediately reopens it.
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
        label="More"
        size="field"
        active={open}
        activeMeans="expanded"
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="text-ink-muted hover:text-ink"
      >
        <MoreHorizontal size={16} />
      </IconButton>
      {open && (
        <HeaderMenuDropdown
          onClose={close}
          onOpenBlocked={props.onOpenBlocked}
          onOpenHelp={props.onOpenHelp}
          themePref={props.themePref}
          cycleTheme={props.cycleTheme}
        />
      )}
    </div>
  );
}
