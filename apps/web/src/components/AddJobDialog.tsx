import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useCreateListing } from "../hooks";
import { IconButton } from "./IconButton";

// Manually add a job the extension never captured (a referral, a recruiter email,
// a careers page / ATS with no scraper). It routes through the same POST /listings
// verb as a scrape: platform="manual" + a client-minted platform_id (manual
// entries have no natural key, so a fresh uuid each time is correct — no dedup) +
// via="manual" so the job's birth reads as hand-added, not scraped. The server
// auto-creates the owning job; on success the parent opens its drawer to fill in
// the rest (status, notes, documents).
export function AddJobDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (jobId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);
  const create = useCreateListing();

  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Enough to identify the job: at least a title or a company. Everything else is
  // optional and editable later in the drawer.
  const canSave = (title.trim() !== "" || company.trim() !== "") && !create.isPending;

  const submit = () => {
    if (!canSave) return;
    setError(null);
    create.mutate(
      {
        platform: "manual",
        platform_id: crypto.randomUUID(),
        via: "manual",
        title: title.trim() || undefined,
        company: company.trim() || undefined,
        url: url.trim() || undefined,
        // A hand-added job is an off-platform application by nature — never the
        // in-app `easy_apply` a capture detects — so it's always `external`. The
        // board only badges non-external/unknown apply types, so this stays silent
        // (correct); no selector, one less field on a fast-add.
        apply_type: "external",
        // Same bag a capture fills — renders as prose in the drawer like a scraped JD.
        meta: description.trim() ? { description: description.trim() } : undefined,
      },
      {
        onSuccess: (res) => onCreated(res.job_id),
        onError: () => setError("Couldn’t add the job. Is the server running on :3456?"),
      },
    );
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const fieldClass =
    "w-full rounded border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-line-strong focus:ring-2 focus:ring-violet-500";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Add a job"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-canvas p-5 shadow-2xl outline-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Add a job</h2>
          <IconButton label="Close" onClick={onClose} className="text-ink-faint hover:text-ink">
            <X size={16} />
          </IconButton>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Title
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior Backend Engineer"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Company
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Example Company"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Posting URL <span className="text-ink-muted">(optional)</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Job description <span className="text-ink-muted">(optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="Paste the JD here — shown as prose in the job's detail, like a captured one."
              className={`${fieldClass} resize-y`}
            />
          </label>
        </div>

        {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <span className="mr-auto text-micro text-ink-muted">⌘/Ctrl+Enter to save</span>
          <button
            onClick={onClose}
            className="rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSave}
            className="rounded border border-violet-600 bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {create.isPending ? "Adding…" : "Add job"}
          </button>
        </div>
      </div>
    </div>
  );
}
