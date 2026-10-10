import type { ReactNode, RefObject } from "react";
import { useRef } from "react";
import { ArrowLeft, X } from "lucide-react";
import { IconButton } from "../components/IconButton";
import { useFocusTrap, useScrollLock } from "../lib/useFocusTrap";
import { canLeaveFormFill, useDraftGuard } from "./draftGuard";

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  backLabel?: string;
  dirty?: boolean;
  busy?: boolean;
  footer?: ReactNode;
}

export function Drawer({
  label,
  onClose,
  children,
  title,
  backLabel,
  dirty = false,
  busy = false,
  footer,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  useDraftGuard(dirty);
  const close = () => {
    if (!busy && canLeaveFormFill()) onClose();
  };
  useFocusTrap(ref as RefObject<HTMLElement | null>, close);
  useScrollLock();
  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button
        type="button"
        aria-label="Close details"
        className="flex-1 bg-overlay"
        onClick={close}
      />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="flex h-full w-full max-w-3xl flex-col border-l border-line bg-canvas shadow-2xl outline-none"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-canvas px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            {title ?? <h2 className="text-base font-semibold text-ink">{label}</h2>}
          </div>
          <IconButton
            label={backLabel ?? "Close"}
            onClick={close}
            className="shrink-0 text-ink-muted hover:text-ink"
          >
            {backLabel ? (
              <ArrowLeft size={18} aria-hidden="true" />
            ) : (
              <X size={18} aria-hidden="true" />
            )}
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">{children}</div>
        {footer && (
          <footer className="shrink-0 border-t border-line bg-surface p-4 sm:px-6">{footer}</footer>
        )}
      </aside>
    </div>
  );
}
