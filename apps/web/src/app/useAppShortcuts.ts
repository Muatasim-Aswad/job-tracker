import { useEffect, useRef, type RefObject } from "react";

// Global shortcuts yield to editable controls.
function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

interface Shortcuts {
  selectedJobId: string | null;
  showHelp: boolean;
  showAbout: boolean;
  showExtensionSettings: boolean;
  showAdd: boolean;
  showBlocked: boolean;
  cycleTheme: () => void;
  showStarred: boolean;
  setShowStarred: (value: boolean) => void;
  showAttention: boolean;
  setShowAttention: (value: boolean) => void;
  hideHidden: boolean;
  setHideHidden: (value: boolean) => void;
  hideBlocked: boolean;
  setHideBlocked: (value: boolean) => void;
  easyApplyOnly: boolean;
  setEasyApplyOnly: (value: boolean) => void;
  view: "jobs" | "form-fill";
  searchRef: RefObject<HTMLInputElement | null>;
  setShowHelp: (value: boolean) => void;
  setShowAdd: (value: boolean) => void;
}

export function useAppShortcuts({
  selectedJobId,
  showHelp,
  showAbout,
  showExtensionSettings,
  showAdd,
  showBlocked,
  cycleTheme,
  showStarred,
  setShowStarred,
  showAttention,
  setShowAttention,
  hideHidden,
  setHideHidden,
  hideBlocked,
  setHideBlocked,
  easyApplyOnly,
  setEasyApplyOnly,
  view,
  searchRef,
  setShowHelp,
  setShowAdd,
}: Shortcuts) {
  const lastCardIdRef = useRef<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== "jobs") return;
      if (
        isTypingTarget(e.target) ||
        selectedJobId ||
        showHelp ||
        showAbout ||
        showExtensionSettings ||
        showAdd ||
        showBlocked
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "?") {
        e.preventDefault();
        setShowHelp(true);
      } else if (e.key === "n") {
        e.preventDefault();
        setShowAdd(true);
      } else if (e.key === "t") {
        e.preventDefault();
        cycleTheme();
      } else if (e.key === "S") {
        e.preventDefault();
        setShowStarred(!showStarred);
      } else if (e.key === "A") {
        e.preventDefault();
        setShowAttention(!showAttention);
      } else if (e.key === "H") {
        e.preventDefault();
        setHideHidden(!hideHidden);
      } else if (e.key === "B") {
        e.preventDefault();
        setHideBlocked(!hideBlocked);
      } else if (e.key === "E") {
        e.preventDefault();
        setEasyApplyOnly(!easyApplyOnly);
      } else if (e.key.startsWith("Arrow")) {
        // Enter the board only from idle body focus; preserve arrows in other controls.
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const last =
          lastCardIdRef.current &&
          document.querySelector<HTMLElement>(
            `[data-card-id="${CSS.escape(lastCardIdRef.current)}"]`,
          );
        const target = last ?? document.querySelector<HTMLElement>("[data-card-id]");
        if (target) {
          e.preventDefault();
          target.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selectedJobId,
    showHelp,
    showAbout,
    showExtensionSettings,
    showAdd,
    showBlocked,
    cycleTheme,
    showStarred,
    showAttention,
    hideHidden,
    hideBlocked,
    easyApplyOnly,
    view,
  ]);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const card = (e.target as HTMLElement | null)?.closest?.("[data-card-id]");
      if (card) lastCardIdRef.current = card.getAttribute("data-card-id");
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
}
