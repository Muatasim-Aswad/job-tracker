import { cloneElement, useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const MARGIN = 8;

interface Props {
  // Rich interactive content requires a popover.
  label: string;
  // Put aria-describedby on the focusable trigger rather than its wrapper.
  children: ReactElement<{ "aria-describedby"?: string }>;
  // The wrapper owns truncation/grid layout classes.
  className?: string;
  // Action controls use hover/focus only so a click keeps its existing purpose.
  toggleOnClick?: boolean;
  stopPropagation?: boolean;
}

// Portal positioning avoids drawer clipping; descriptions preserve the control name.
// Informational tips support focus/tap; actions retain their click purpose.
export function Tooltip({
  label,
  children,
  className = "inline-flex",
  toggleOnClick = true,
  stopPropagation = false,
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const touchRef = useRef(false);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  // Measure the bubble before clamping its position to the viewport.
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
    // Capture nested scrolls so the bubble tracks its trigger.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

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
        // React focus/blur bubble to the wrapper; preserve the caller's trigger.
        onTouchStart={() => {
          touchRef.current = true;
          setOpen(false);
        }}
        onPointerDown={(event) => {
          if (stopPropagation) event.stopPropagation();
          touchRef.current = event.pointerType === "touch";
          if (touchRef.current) setOpen(false);
        }}
        onKeyDown={() => {
          touchRef.current = false;
        }}
        onMouseEnter={() => {
          if (!touchRef.current) setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          if (!touchRef.current) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation();
          if (toggleOnClick) setOpen((value) => !value);
          else if (touchRef.current) setOpen(false);
        }}
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
              // Hide until measured to avoid flashing at the origin.
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
