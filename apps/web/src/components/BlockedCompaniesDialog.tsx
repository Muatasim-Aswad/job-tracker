import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useBlockCompany, useBlockedCompanies, useUnblockCompany } from "../hooks";
import { useFocusTrap } from "../lib/useFocusTrap";
import { IconButton } from "./IconButton";

// The extension enforces blocking; this editor preserves existing jobs.
function scopeLabel(platform: string): string {
  return platform === "*" ? "everywhere" : platform;
}

export function BlockedCompaniesDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);

  const { data: blocked, isLoading, isError } = useBlockedCompanies();
  const block = useBlockCompany();
  const unblock = useUnblockCompany();
  const [name, setName] = useState("");

  const canAdd = name.trim() !== "" && !block.isPending;
  const add = () => {
    if (!canAdd) return;
    // Global blocks use the server-normalized company key.
    block.mutate({ company: name.trim(), platform: "*" }, { onSuccess: () => setName("") });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Blocked companies"
        tabIndex={-1}
        className="relative z-10 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-canvas p-5 shadow-2xl outline-none"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Blocked companies</h2>
          <IconButton label="Close" onClick={onClose} className="text-ink-faint hover:text-ink">
            <X size={16} />
          </IconButton>
        </div>
        <p className="mb-4 text-xs text-ink-faint">
          The extension skips capturing and hides these on the feed. Block more from a card’s ⋯
          menu, or add one by name below.
        </p>

        <div className="mb-4 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder="Company name to block…"
            className="flex-1 rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-line-strong"
          />
          <button
            onClick={add}
            disabled={!canAdd}
            className="rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:border-line-strong disabled:opacity-50"
          >
            Block
          </button>
        </div>

        {isLoading && <div className="text-sm text-ink-muted">Loading…</div>}
        {isError && (
          <div className="text-sm text-red-600 dark:text-red-400">
            Couldn’t load the blocklist. Is the server running?
          </div>
        )}
        {blocked && blocked.length === 0 && (
          <div className="text-sm text-ink-faint">No companies blocked yet.</div>
        )}
        {blocked && blocked.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {blocked.map((b) => (
              <li
                key={`${b.company_key}\x00${b.platform}`}
                className="flex items-center justify-between gap-4 rounded border border-line px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate text-ink">{b.label || b.company_key}</span>
                  <span className="text-[11px] text-ink-faint">{scopeLabel(b.platform)}</span>
                </span>
                <button
                  onClick={() =>
                    unblock.mutate({ companyKey: b.company_key, platform: b.platform })
                  }
                  disabled={unblock.isPending}
                  className="shrink-0 rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-50"
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
