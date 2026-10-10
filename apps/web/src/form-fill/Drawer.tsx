import type { ReactNode, RefObject } from "react";
import { useRef } from "react";
import { X } from "lucide-react";
import { IconButton } from "../components/IconButton";
import { useFocusTrap, useScrollLock } from "../lib/useFocusTrap";
import { canLeaveFormFill, useDraftGuard } from "./draftGuard";

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  dirty?: boolean;
  busy?: boolean;
  footer?: ReactNode;
}

export function Drawer({
  label,
  onClose,
  children,
  title,
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
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-canvas p-5">
          <div className="min-w-0">
            {title ?? <h2 className="text-lg font-semibold text-ink">{label}</h2>}
          </div>
          <IconButton label="Close" onClick={close} className="text-ink-muted hover:text-ink">
            <X size={18} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">{children}</div>
        {footer && (
          <footer className="shrink-0 border-t border-line bg-surface p-4 sm:px-6">{footer}</footer>
        )}
      </aside>
    </div>
  );
}
