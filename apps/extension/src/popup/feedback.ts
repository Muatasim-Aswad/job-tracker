import { useCallback, useEffect, useRef, useState } from "react";

// Success uses a fixed badge because state already reflects the write.
// Failures use a text pill; clear both timers on unmount.
export interface Feedback {
  ok: boolean;
  toast: string;
  showOk: () => void;
  showError: (text: string) => void;
}

export function useFeedback(): Feedback {
  const [ok, setOk] = useState(false);
  const [toast, setToast] = useState("");
  const okTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showOk = useCallback(() => {
    setOk(true);
    clearTimeout(okTimer.current);
    okTimer.current = setTimeout(() => setOk(false), 1200);
  }, []);

  const showError = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(okTimer.current);
      clearTimeout(toastTimer.current);
    },
    [],
  );

  return { ok, toast, showOk, showError };
}
