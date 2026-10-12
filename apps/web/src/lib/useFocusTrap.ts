import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  "a[href], button, input, textarea, select, details > summary:first-of-type, [tabindex]";

export function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    if (
      element.tabIndex < 0 ||
      element.matches(':disabled, input[type="hidden"]') ||
      element.closest("[hidden], [inert]")
    )
      return false;
    const view = element.ownerDocument.defaultView;
    if (!view) return false;
    const visibility = view.getComputedStyle(element).visibility;
    if (visibility === "hidden" || visibility === "collapse") return false;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      if (view.getComputedStyle(ancestor).display === "none") return false;
      if (ancestor.tagName === "DETAILS" && !ancestor.hasAttribute("open")) {
        const summary = [...ancestor.children].find((child) => child.tagName === "SUMMARY");
        if (!summary?.contains(element)) return false;
      }
    }
    return true;
  });
}

// Trap modal focus and restore its opener on close.
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  // Capture restore focus once per mount.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => restoreTo?.focus?.();
  }, [ref]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = ref.current;
      if (!root) return;
      const focusable = focusableElements(root);
      if (focusable.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!focusable.includes(active as HTMLElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref, onClose]);
}

// Lock both html and body because either can own page scrolling.
// Remove only classes this hook added so nested dialogs preserve existing locks.
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const targets = [document.documentElement, document.body];
    const added = targets.filter((el) => !el.classList.contains("overflow-hidden"));
    for (const el of added) el.classList.add("overflow-hidden");
    return () => {
      for (const el of added) el.classList.remove("overflow-hidden");
    };
  }, [active]);
}
