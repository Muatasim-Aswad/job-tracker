import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationItem } from "@job-tracker/shared/api";
import { useFocusTrap, useScrollLock } from "../../shared/useFocusTrap";
import { useNotificationActions } from "./queries";
import { copy } from "./copy";

const FIELD =
  "w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent";

function localInput(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ReminderForm({
  jobId,
  initial,
  onClose,
}: {
  jobId?: string;
  initial?: NotificationItem;
  onClose: () => void;
}) {
  const actions = useNotificationActions();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const job = initial?.job_id ?? jobId ?? null;
  const [when, setWhen] = useState(initial ? localInput(initial.scheduled_at) : "");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const busy = actions.create.isPending || actions.update.isPending;
  const dirty =
    title !== (initial?.title ?? "") ||
    body !== (initial?.body ?? "") ||
    when !== (initial ? localInput(initial.scheduled_at) : "");
  const close = useCallback(() => {
    if (!busy && (!dirty || window.confirm(copy.discard))) onClose();
  }, [busy, dirty, onClose]);
  useFocusTrap(ref, close);
  useScrollLock();
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    const date = new Date(when);
    if (!when || Number.isNaN(date.valueOf()) || date.valueOf() <= Date.now()) {
      setError(copy.invalidDate);
      return;
    }
    const value = {
      title: title.trim(),
      body: body.trim() || null,
      job_id: job || null,
      scheduled_at: date.toISOString(),
    };
    try {
      if (initial)
        await actions.update.mutateAsync({
          id: initial.id,
          body: { ...value, expected_revision: initial.revision },
        });
      else await actions.create.mutateAsync(value);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.formError);
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay" onClick={close} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-title"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-lg border border-line bg-canvas p-5 text-ink shadow-2xl outline-none"
      >
        <h2 id="reminder-title" className="mb-4 text-base font-semibold">
          {initial ? copy.edit : copy.add}
        </h2>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block space-y-1 text-sm">
            <span>{copy.titleLabel}</span>
            <input
              required
              maxLength={200}
              className={FIELD}
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>{copy.when}</span>
            <input
              required
              type="datetime-local"
              className={FIELD}
              value={when}
              disabled={busy}
              onChange={(event) => setWhen(event.target.value)}
            />
          </label>
          <p className="text-xs text-ink-muted">
            {copy.timezone(Intl.DateTimeFormat().resolvedOptions().timeZone)}
          </p>
          <label className="block space-y-1 text-sm">
            <span>{copy.body}</span>
            <textarea
              maxLength={10000}
              rows={3}
              className={FIELD}
              value={body}
              disabled={busy}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          {!jobId && <p className="text-xs text-ink-muted">{copy.linkThroughJob}</p>}
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              disabled={busy}
              className="rounded px-3 py-2 text-sm hover:bg-surface-hover"
              onClick={close}
            >
              {copy.dismiss}
            </button>
            <button
              disabled={busy || !title.trim()}
              className="rounded bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {busy ? copy.saving : copy.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
