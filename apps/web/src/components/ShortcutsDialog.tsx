import { useRef } from "react";
import { X } from "lucide-react";
import { SHORTCUTS } from "../lib/shortcuts";
import { useFocusTrap } from "../lib/useFocusTrap";
import { IconButton } from "./IconButton";

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        className="relative z-10 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-canvas p-5 shadow-2xl outline-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Keyboard shortcuts</h2>
          <IconButton label="Close" onClick={onClose} className="text-ink-faint hover:text-ink">
            <X size={16} />
          </IconButton>
        </div>

        <div className="flex flex-col gap-4">
          {SHORTCUTS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-micro uppercase tracking-wide text-ink-muted">
                {group.title}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-ink-soft">{item.label}</span>
                    <span className="flex shrink-0 gap-1">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-micro text-ink-muted"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
