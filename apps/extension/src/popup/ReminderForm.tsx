import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { createReminder } from "./api";
import { copy } from "./copy";
import { BUTTON, INPUT, PRIMARY_BUTTON } from "./ui";

export interface ReminderHandle {
  submit: () => void;
}

export const ReminderForm = forwardRef<
  ReminderHandle,
  { jobId: string; onClose: () => void; onSaved: () => void; onError: (message: string) => void }
>(function ReminderForm({ jobId, onClose, onSaved, onError }, ref) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useImperativeHandle(ref, () => ({ submit: () => form.current?.requestSubmit() }));
  async function save() {
    const date = new Date(when);
    if (Number.isNaN(date.valueOf()) || date.valueOf() <= Date.now()) {
      onError(copy.reminder.invalidDate);
      return;
    }
    setBusy(true);
    try {
      await createReminder({
        job_id: jobId,
        title: title.trim(),
        body: body.trim() || null,
        scheduled_at: date.toISOString(),
      });
      onSaved();
      onClose();
    } catch {
      onError(copy.reminder.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      ref={form}
      className="mt-2 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void save();
      }}
    >
      <label className="block text-xs text-popup-soft">
        {copy.reminder.title}
        <input
          autoFocus
          required
          maxLength={200}
          className={INPUT + " mt-1"}
          value={title}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="block text-xs text-popup-soft">
        {copy.reminder.when}
        <input
          required
          type="datetime-local"
          className={INPUT + " mt-1"}
          value={when}
          disabled={busy}
          onChange={(event) => setWhen(event.target.value)}
        />
      </label>
      <p className="text-xs text-popup-soft">
        {copy.reminder.timezone(Intl.DateTimeFormat().resolvedOptions().timeZone)}
      </p>
      <label className="block text-xs text-popup-soft">
        {copy.reminder.details}
        <textarea
          maxLength={10000}
          className={INPUT + " mt-1"}
          value={body}
          disabled={busy}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button className={PRIMARY_BUTTON} disabled={busy || !title.trim()}>
          {copy.reminder.save}
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={onClose}>
          {copy.detail.cancel}
        </button>
      </div>
    </form>
  );
});
