import { copy } from "./copy";
import { HideToggle } from "./HideToggle";
import { ThemeToggle } from "./ThemeToggle";
import { usePreferences } from "./usePreferences";
import { KeywordSettings } from "./KeywordSettings";
import { DiagnosticsSettings } from "./DiagnosticsSettings";
import { EasyApplyToggle } from "./EasyApplyToggle";
import { ServerSettings } from "./ServerSettings";

// Keep this keyboard list aligned with Popup, Detail, and the manifest command.
// Use a static list: Chrome closes action popups on Escape, preventing a dismissible modal.
const SHORTCUTS: { keys: string[]; label: string }[] = [
  // Open / navigate.
  { keys: ["Alt+J"], label: copy.settings.openThisPopupAnyTab },
  { keys: ["↑", "↓"], label: copy.settings.moveThroughResults },
  { keys: ["Enter"], label: copy.settings.openTheSelectedJob },
  // Actions.
  { keys: ["s"], label: copy.settings.advanceTheStatusInAJob },
  { keys: ["c"], label: copy.settings.commentOnTheStatusInAJob },
  { keys: ["n"], label: copy.settings.addANoteInAJobNewJobElsewhere },
  { keys: ["t"], label: copy.settings.cycleTheTheme },
  { keys: ["?"], label: copy.settings.settingsThisCheatSheet },
  // Save / exit.
  { keys: ["⌘/Ctrl", "Enter"], label: copy.settings.saveTheOpenForm },
  { keys: ["⌫"], label: copy.settings.goBackClearSearch },
  { keys: ["Esc"], label: copy.settings.closeThePopup },
];

export function Settings({ reachable }: { reachable: boolean }) {
  const editor = usePreferences();
  return (
    <div className="mt-2.5 flex flex-col gap-2.5">
      <ServerSettings reachable={reachable} />
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-[13px] text-popup-fg">{copy.settings.theme}</span>
        <ThemeToggle />
      </div>
      {editor.error && (
        <div role="alert" className="text-xs text-popup-danger">
          {editor.error}{" "}
          <button className="underline" onClick={() => void editor.reload()}>
            {copy.settings.reloadSettings}
          </button>
        </div>
      )}
      {!editor.settings ? (
        <p className="text-xs text-popup-faint">{copy.settings.loadingSharedSettings}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2.5">
            <span className="text-[13px] text-popup-fg">{copy.settings.filteredJobs}</span>
            <HideToggle editor={editor} />
          </div>
          <EasyApplyToggle editor={editor} />
        </>
      )}

      <KeywordSettings />
      {editor.settings && <DiagnosticsSettings editor={editor} />}

      <details className="mt-1 border-t border-popup-border-subtle pt-1.5">
        <summary className="cursor-pointer list-none py-1.5 text-[10px] font-semibold uppercase tracking-wider text-popup-faint marker:hidden before:mr-1.5 before:inline-block before:content-['▸'] open:before:rotate-90">
          {copy.settings.keyboardShortcuts}
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
