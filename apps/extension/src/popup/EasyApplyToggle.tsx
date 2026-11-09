import { copy } from "./copy";
import type { PreferencesEditor } from "./usePreferences";
import { FOCUS } from "./ui";

export function EasyApplyToggle({ editor }: { editor: PreferencesEditor }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-popup-fg">
        {copy.easyApplyToggle.linkedInEasyApplyForms}
      </span>
      <input
        className={"size-4 accent-popup-primary " + FOCUS}
        type="checkbox"
        role="switch"
        checked={editor.settings!.easy_apply_enabled}
        disabled={editor.saving}
        onChange={(event) => void editor.save({ easy_apply_enabled: event.target.checked })}
        aria-label={copy.easyApplyToggle.enableLinkedInEasyApplyForms}
      />
    </label>
  );
}
