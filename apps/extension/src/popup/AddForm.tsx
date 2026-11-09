import { copy } from "./copy";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createListing } from "./api.js";
import type { PopupJob } from "./types";
import { BUTTON, FOCUS, INPUT, PRIMARY_BUTTON } from "./ui";

// Create a manual listing and open its detail for status and notes.

export interface AddFormHandle {
  submit: () => void;
}

interface AddFormProps {
  onCreated: (job: PopupJob) => void;
  onCancel: () => void;
  showOk: () => void;
  showError: (text: string) => void;
}

export const AddForm = forwardRef<AddFormHandle, AddFormProps>(function AddForm(
  { onCreated, onCancel, showOk, showError },
  ref,
) {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function save() {
    const t = title.trim();
    const c = company.trim();
    if (!t && !c) {
      showError(copy.addForm.giveTheJobAtLeastATitleOrA);
      return;
    }
    if (saving) return;
    setSaving(true);
    const platformId = crypto.randomUUID();
    try {
      const res = await createListing({
        platform: "manual",
        capture_kind: "partial",
        platform_id: platformId,
        via: "manual",
        title: t || undefined,
        company: c || undefined,
        url: url.trim() || undefined,
        // Manual listings are off-platform; only captured applications can be easy_apply.
        apply_type: "external",
        // meta.description is the JD, rendered as prose in the app like a capture.
        meta: desc.trim() ? { description: desc.trim() } : undefined,
      });
      // Land on the fresh job so status and notes are reachable. The detail view reads
      // only title/company/status + primary_listing, so this minimal summary suffices.
      onCreated({
        id: res.job_id,
        title: t || null,
        company: c || null,
        status: "new",
        primary_listing: {
          platform: "manual",
          platform_id: platformId,
          url: url.trim() || null,
        },
      });
      showOk();
    } catch {
      showError(copy.addForm.couldnTAddTheJobIsTheTrackerRunning);
      setSaving(false);
    }
  }

  useImperativeHandle(ref, () => ({
    submit() {
      void save();
    },
  }));

  return (
    <div id="add-form" className="mt-2.5">
      <div className="mb-2">
        <label className="mb-1 block text-[11px] text-popup-muted">{copy.addForm.title}</label>
        <input
          ref={titleRef}
          className={INPUT}
          placeholder={copy.addForm.eGSeniorBackendEngineer}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="mb-2">
        <label className="mb-1 block text-[11px] text-popup-muted">{copy.addForm.company}</label>
        <input
          className={INPUT}
          placeholder={copy.addForm.eGExampleCompany}
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
      </div>
      <div className="mb-2">
        <label className="mb-1 block text-[11px] text-popup-muted">{copy.addForm.postingURL}</label>
        <input
          className={INPUT}
          type="url"
          placeholder={copy.addForm.httpsOptional}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="mb-2">
        <label className="mb-1 block text-[11px] text-popup-muted">
          {copy.addForm.jobDescription}
        </label>
        <textarea
          className={INPUT + " resize-y"}
          rows={4}
          placeholder={copy.addForm.pasteTheJDOptional}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>
      <div className="mt-1.5 flex gap-1.5 [&>button]:flex-1">
        <button
          className={PRIMARY_BUTTON + " " + FOCUS}
          disabled={saving}
          onClick={() => void save()}
        >
          {copy.addForm.addJob}
        </button>
        <button className={BUTTON + " " + FOCUS} onClick={onCancel}>
          {copy.addForm.cancel}
        </button>
      </div>
    </div>
  );
});
