import { useEffect, useState } from "react";
import {
  EASY_APPLY_DEFAULT_ENABLED,
  loadEasyApplyEnabled,
  saveEasyApplyEnabled,
} from "../form-fill/settings.js";
import { FOCUS } from "./ui";

export function EasyApplyToggle() {
  const [enabled, setEnabled] = useState(EASY_APPLY_DEFAULT_ENABLED);

  useEffect(() => loadEasyApplyEnabled(setEnabled), []);

  function change(next: boolean) {
    setEnabled(next);
    saveEasyApplyEnabled(next);
  }

  return (
    <label className="flex items-center justify-between gap-3">
      <span>
        <span className="block text-[13px] text-popup-fg">Easy Apply form fill</span>
        <span className="block text-[11px] text-popup-faint">Fill and remember safe fields</span>
      </span>
      <input
        className={"size-4 accent-popup-primary " + FOCUS}
        type="checkbox"
        role="switch"
        checked={enabled}
        onChange={(event) => change(event.target.checked)}
        aria-label="Enable Easy Apply form fill"
      />
    </label>
  );
}
