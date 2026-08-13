import type { ReactNode, RefObject } from "react";
import { useRef } from "react";
import { X } from "lucide-react";
import { IconButton } from "../components/IconButton";
import { useFocusTrap, useScrollLock } from "../lib/useFocusTrap";

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
}

export function Drawer({ label, onClose, children, title }: Props) {
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref as RefObject<HTMLElement | null>, onClose);
  useScrollLock();
  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button
        type="button"
        aria-label="Close details"
        className="flex-1 bg-overlay"
        onClick={onClose}
      />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="flex w-xl max-w-full flex-col overflow-y-auto border-l border-line bg-canvas shadow-2xl outline-none"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-canvas p-5">
          <div className="min-w-0">
            {title ?? <h2 className="text-lg font-semibold text-ink">{label}</h2>}
          </div>
          <IconButton label="Close" onClick={onClose} className="text-ink-muted hover:text-ink">
            <X size={18} />
          </IconButton>
        </header>
        <div className="space-y-6 p-5">{children}</div>
      </aside>
    </div>
  );
}
