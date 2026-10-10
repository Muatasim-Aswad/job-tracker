import { cloneElement, useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";

// Gap between the trigger and the bubble, and the minimum breathing room kept
// against the viewport edge.
const GAP = 6;
const MARGIN = 8;

interface Props {
  // The tooltip text. Plain text only: a tooltip that needs markup is a popover,
  // and a popover is a different (focusable, dismissible) component.
  label: string;
  // The trigger. Cloned so `aria-describedby` lands on the real interactive
  // element — putting it on a wrapper would describe a <span> nobody focuses.
  children: ReactElement<{ "aria-describedby"?: string }>;
  // Layout classes for the anchor wrapper. Defaults to `inline-flex`, which is
  // right for a button sitting in a line of text; a trigger that must fill and
  // truncate inside a grid cell needs `block min-w-0 truncate` instead, and the
  // wrapper is the only element in the chain that can carry it.
  className?: string;
  // Action controls use hover/focus only so a click keeps its existing purpose.
  toggleOnClick?: boolean;
}

// Hover + focus + tap, described to assistive tech, and never clipped.
//
// Three things this exists to get right, none of which a `title` attribute does:
//   * **Focus and touch**, not just hover — a keyboard user tabbing to the trigger
//     and a phone user tapping it both get the text. Tap toggles, so the bubble is
//     dismissible without a pointer leaving anything.
//   * **`aria-describedby`**, so the text is announced as a description of the
//     control rather than being invisible to a screen reader — or, with `title`,
//     read as the control's *name*, clobbering the real label.
//   * **No clipping.** The bubble renders in a portal at the document root with
//     `position: fixed`, so the drawer's overflow and stacking context can't cut it
//     off at the panel edge — the failure that makes an in-flow tooltip useless on
//     exactly the controls nearest the edge, which is most of them.
export function Tooltip({
  label,
  children,
  className = "inline-flex",
  toggleOnClick = true,
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  // Measured after paint: the bubble's own size decides whether it fits above the
  // trigger and how far it must slide back inside the viewport horizontally.
  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const a = anchor.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const above = a.top - b.height - GAP;
    const top = above >= MARGIN ? above : a.bottom + GAP;
    const wanted = a.left + a.width / 2 - b.width / 2;
    const max = Math.max(MARGIN, window.innerWidth - b.width - MARGIN);
    setPos({ top, left: Math.min(Math.max(MARGIN, wanted), max) });
  }, []);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    // Anything that moves the trigger (scrolling a column, resizing the drawer)
    // moves the bubble with it. `capture` catches scrolls in nested containers.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // Escape dismisses, matching every other transient surface in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const trigger = cloneElement(children, { "aria-describedby": open ? id : undefined });

  return (
    <>
      <span
        ref={anchorRef}
        className={className}
        // Focus/blur are listened for on the wrapper because React's onFocus/onBlur
        // bubble — the trigger stays whatever the caller passed.
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={toggleOnClick ? () => setOpen((v) => !v) : undefined}
      >
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            style={{
              position: "fixed",
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              // Hidden until measured, so it never flashes at the origin first.
              visibility: pos ? "visible" : "hidden",
            }}
            className="pointer-events-none z-50 max-w-56 rounded-md border border-line bg-surface px-2 py-1 text-micro text-ink-soft shadow-lg"
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
