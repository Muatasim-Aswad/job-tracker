import { HideToggle } from "./HideToggle";
import { ThemeToggle } from "./ThemeToggle";
import { KeywordSettings } from "./KeywordSettings";
import { DiagnosticsSettings } from "./DiagnosticsSettings";
import { EasyApplyToggle } from "./EasyApplyToggle";

// The settings panel — a labelled home for extension preferences and a static
// keyboard cheat-sheet, opened from the gear beside search. Each control owns its
// storage and apply logic; this is just the layout.
//
// The cheat-sheet is a plain read-only list, deliberately not the dashboard's
// focus-trapped `?` dialog: Esc closes an action popup at the browser level, so a
// dismissable modal can't work here. The in-popup keys mirror the handlers in
// Popup.tsx and Detail.tsx, and "Open this popup" is the global `_execute_action`
// command from manifest.config.ts. Edit this list alongside those so it can't drift.
const SHORTCUTS: { keys: string[]; label: string }[] = [
  // Open / navigate.
  { keys: ["Alt+J"], label: "Open this popup (any tab)" },
  { keys: ["↑", "↓"], label: "Move through results" },
  { keys: ["Enter"], label: "Open the selected job" },
  // Actions.
  { keys: ["s"], label: "Advance the status (in a job)" },
  { keys: ["c"], label: "Comment on the status (in a job)" },
  { keys: ["n"], label: "Add a note (in a job) · new job elsewhere" },
  { keys: ["t"], label: "Cycle the theme" },
  { keys: ["?"], label: "Settings & this cheat-sheet" },
  // Save / exit.
  { keys: ["⌘/Ctrl", "Enter"], label: "Save the open form" },
  { keys: ["⌫"], label: "Go back · clear search" },
  { keys: ["Esc"], label: "Close the popup" },
];

export function Settings() {
  return (
    <div className="mt-2.5 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-[13px] text-popup-fg">Theme</span>
        <ThemeToggle />
      </div>
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-[13px] text-popup-fg">Hidden jobs</span>
        <HideToggle />
      </div>

      <EasyApplyToggle />

      <KeywordSettings />

      <DiagnosticsSettings />

      <details className="mt-1 border-t border-popup-border-subtle pt-1.5">
        <summary className="cursor-pointer list-none py-1.5 text-[10px] font-semibold uppercase tracking-wider text-popup-faint marker:hidden before:mr-1.5 before:inline-block before:content-['▸'] open:before:rotate-90">
          Keyboard shortcuts
        </summary>
        <ul className="mt-1.5 flex list-none flex-col gap-1.5 p-0">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-popup-muted">{s.label}</span>
              <span className="inline-flex shrink-0 gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-popup-border bg-popup-raised px-1.5 py-px font-mono text-[10px] leading-relaxed text-popup-muted"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
