import { useEffect } from "react";

const NAVIGATION_EVENT = "form-fill-before-navigation";

export function canLeaveFormFill(): boolean {
  return window.dispatchEvent(new Event(NAVIGATION_EVENT, { cancelable: true }));
}

export function useDraftGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const url = window.location.href;
    const confirm = (event: Event) => {
      if (!window.confirm("Discard your unsaved changes?")) event.preventDefault();
    };
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const back = (event: PopStateEvent) => {
      if (canLeaveFormFill()) return;
      event.stopImmediatePropagation();
      window.history.pushState(null, "", url);
    };
    window.addEventListener(NAVIGATION_EVENT, confirm);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", back, true);
    return () => {
      window.removeEventListener(NAVIGATION_EVENT, confirm);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", back, true);
    };
  }, [dirty]);
}
