import { useSyncExternalStore } from "react";
import { dismissToast, getToasts, subscribeToasts } from "../lib/toast";
import { IconButton } from "./IconButton";

// Keep toasts outside App so render-error fallback cannot hide mutation feedback.
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-md border px-4 py-2 text-sm shadow-lg ${
            t.kind === "error"
              ? "border-red-500/40 bg-surface text-red-700 dark:text-red-300"
              : "border-line bg-surface text-ink"
          }`}
        >
          <span className="min-w-0 break-words">{t.message}</span>
          <IconButton
            size="sm"
            onClick={() => dismissToast(t.id)}
            label="Dismiss"
            className="ml-auto text-ink-muted hover:text-ink"
          >
            ✕
          </IconButton>
        </div>
      ))}
    </div>
  );
}
