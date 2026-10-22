import type { PreferencesEditor } from "./usePreferences";
import { ICON } from "../icons.js";
import { ACTION_BUTTON, ICON as ICON_CLASS } from "./ui";

// Persist dim/remove mode and notify the active content script to repaint.
type Mode = "dim" | "remove";

const FACE: Record<Mode, { icon: string; text: string; label: string; title: string }> = {
  dim: {
    icon: ICON.contrast,
    text: "Dim",
    label: "Filtered jobs: dimmed",
    title:
      "To-apply, post-application, closed-out, hidden, and blocked jobs are dimmed in job lists. Click to hide them instead.",
  },
  remove: {
    icon: ICON.eyeOff,
    text: "Hide",
    label: "Filtered jobs: hidden",
    title:
      "To-apply, post-application, closed-out, hidden, and blocked jobs are hidden from job lists. Click to dim them instead.",
  },
};

export function HideToggle({ editor }: { editor: PreferencesEditor }) {
  const mode = editor.settings!.hide_mode;
  const toggle = () => {
    void editor.save({ hide_mode: mode === "dim" ? "remove" : "dim" });
  };

  const f = FACE[mode];
  return (
    <button
      disabled={editor.saving}
      className={ACTION_BUTTON}
      title={f.title}
      aria-label={f.label}
      onClick={toggle}
    >
      <span className={ICON_CLASS} dangerouslySetInnerHTML={{ __html: f.icon }} />
      {f.text}
    </button>
  );
}
