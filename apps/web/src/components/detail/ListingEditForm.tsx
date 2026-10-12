import { useState } from "react";
import { formKeys } from "../../lib/forms";

interface Props {
  initialUrl: string;
  initialDescription: string;
  onSave: (url: string, description: string) => void;
  onCancel: () => void;
}

// Mount resets the manual-listing draft; Esc cancels and Cmd+Enter saves.
export function ListingEditForm({ initialUrl, initialDescription, onSave, onCancel }: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [description, setDescription] = useState(initialDescription);
  const save = () => onSave(url.trim(), description.trim());

  return (
    <div className="flex flex-col gap-2 py-1" onKeyDown={formKeys(save, onCancel)}>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="Posting URL"
        placeholder="Posting URL"
        autoFocus
        className="rounded border border-line bg-surface px-2 py-1 text-prose text-ink outline-none focus:border-line-strong focus:ring-2 focus:ring-violet-500"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        aria-label="Job description"
        placeholder="Job description"
        rows={5}
        className="resize-y rounded border border-line bg-surface px-2 py-1 text-prose leading-relaxed text-ink outline-none focus:border-line-strong focus:ring-2 focus:ring-violet-500"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded border border-line bg-surface px-2 py-1 text-micro text-ink hover:bg-surface-hover"
        >
          Cancel
        </button>
        <button
          onClick={save}
          className="rounded border border-violet-600 bg-violet-600 px-2 py-1 text-micro font-medium text-white hover:bg-violet-700"
        >
          Save
        </button>
      </div>
    </div>
  );
}
