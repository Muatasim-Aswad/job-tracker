import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { PreferencesState } from "@job-tracker/shared/api";
import { api } from "../api/client";
import { TitleRules, TitleRuleEditor } from "./TitleRules";
import { SearchDiagnostics } from "./SearchDiagnostics";
import { SectionHelp } from "./SectionHelp";
import { KeywordField } from "./KeywordField";
import {
  BUTTON,
  FIELD,
  HIGHLIGHTS,
  PRIMARY_BUTTON,
  keywordValue,
  settingsDraft,
  settingsValidation,
  settingsValue,
  type RuleDraft,
  type SettingsDraft,
} from "./model";

export function SettingsForm({
  initial,
  onSaved,
  onDirtyChange,
  onBusyChange,
  onEditorChange,
  onReload,
  reloading,
  onClose,
}: {
  initial: PreferencesState;
  onSaved: (value: PreferencesState) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onEditorChange: (title: string | null) => void;
  onReload: () => void;
  reloading: boolean;
  onClose: () => void;
}) {
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState(() => settingsDraft(initial.settings));
  const [editing, setEditing] = useState<{ rule: RuleDraft; original: RuleDraft | null } | null>(
    null,
  );
  const [clearingDiagnostics, setClearingDiagnostics] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const value = settingsValue(draft);
  const dirty =
    JSON.stringify(value) !== JSON.stringify(settingsValue(settingsDraft(base.settings)));
  const editedRule = editing
    ? { ...editing.rule, terms: keywordValue(editing.rule), input: "" }
    : null;
  const ruleChanged = editing && JSON.stringify(editedRule) !== JSON.stringify(editing.original);
  const ruleInvalid = editedRule
    ? settingsValidation({ ...value, title_rules: [editedRule] })
    : null;
  const invalid = settingsValidation(value);
  const disabled = saving || reloading || clearingDiagnostics;
  useEffect(() => onDirtyChange(dirty || !!ruleChanged), [dirty, ruleChanged, onDirtyChange]);
  const change = (patch: Partial<SettingsDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
  };
  const edit = (rule: RuleDraft | null) => {
    setEditing({
      original: rule,
      rule: rule
        ? { ...rule, terms: [...rule.terms] }
        : {
            id: crypto.randomUUID(),
            enabled: true,
            match: "contains",
            action: "outline_job_card",
            terms: [],
            input: "",
          },
    });
    onEditorChange(rule ? "Edit title rule" : "New title rule");
  };
  const stopEditing = () => {
    setEditing(null);
    onEditorChange(null);
  };
  const applyRule = () => {
    if (!editing || !editedRule || !ruleChanged || ruleInvalid) return;
    change({
      title_rules: editing.original
        ? draft.title_rules.map((item) => (item.id === editedRule.id ? editedRule : item))
        : [...draft.title_rules, editedRule],
    });
    stopEditing();
  };
  const save = async () => {
    if (!dirty || invalid || disabled) return;
    setSaving(true);
    onBusyChange(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api.updateExtensionSettings(value, base.revision);
      setBase(result);
      setDraft(settingsDraft(result.settings));
      onSaved(result);
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t save settings. Try again.");
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  };
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (editing) applyRule();
        else void save();
      }}
    >
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {editing ? (
          <TitleRuleEditor
            rule={editing.rule}
            onChange={(rule) => setEditing({ ...editing, rule })}
          />
        ) : (
          <>
            <section aria-label="Job browsing" className="space-y-4">
              <label className="flex items-center justify-between gap-4 text-sm text-ink">
                <span>Fill Easy Apply forms</span>
                <input
                  type="checkbox"
                  className="shrink-0 accent-accent"
                  checked={draft.easy_apply_enabled}
                  disabled={disabled}
                  onChange={(event) => change({ easy_apply_enabled: event.target.checked })}
                />
              </label>
              <label className="flex items-center justify-between gap-4 text-sm text-ink">
                <span>Filtered jobs</span>
                <select
                  className={FIELD + " max-w-44"}
                  value={draft.hide_mode}
                  disabled={disabled}
                  onChange={(event) =>
                    change({ hide_mode: event.target.value as SettingsDraft["hide_mode"] })
                  }
                >
                  <option value="dim">Dim job cards</option>
                  <option value="remove">Hide job cards</option>
                </select>
              </label>
            </section>
            <details className="group border-t border-line pt-5">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                <ChevronRight size={14} aria-hidden="true" className="group-open:rotate-90" />
                Description highlights
                <SectionHelp
                  title="Description highlights"
                  description="Highlight matching words in job descriptions for experience, language, pay, and custom terms. These highlights do not change a job’s status or visibility."
                />
              </summary>
              <div className="mt-3 space-y-3">
                {HIGHLIGHTS.map(({ id, label }) => {
                  const highlight = draft.description_highlights.find((item) => item.id === id);
                  const update = (patch: { enabled?: boolean; terms?: string[]; input?: string }) =>
                    change({
                      description_highlights: highlight
                        ? draft.description_highlights.map((item) =>
                            item.id === id ? { ...item, ...patch } : item,
                          )
                        : [
                            ...draft.description_highlights,
                            { id, enabled: false, terms: [], input: "", ...patch },
                          ],
                    });
                  return (
                    <div key={id} className="space-y-2">
                      <label className="flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="accent-accent"
                          checked={highlight?.enabled ?? false}
                          disabled={disabled}
                          onChange={(event) => update({ enabled: event.target.checked })}
                        />
                        {label}
                      </label>
                      {highlight?.enabled && (
                        <KeywordField
                          label={`${label} keywords`}
                          value={highlight}
                          disabled={disabled}
                          onChange={update}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
            <TitleRules
              rules={draft.title_rules}
              onChange={(title_rules) => change({ title_rules })}
              onEdit={edit}
              disabled={disabled}
            />
            <SearchDiagnostics
              settings={draft.search_diagnostics}
              onChange={(search_diagnostics) => change({ search_diagnostics })}
              disabled={disabled}
              onBusyChange={(busy) => {
                setClearingDiagnostics(busy);
                onBusyChange(busy);
              }}
            />
          </>
        )}
      </div>
      <div className="shrink-0 space-y-3 border-t border-line px-5 py-4">
        {editing ? (
          <>
            {ruleInvalid && (
              <p role="alert" className="text-xs text-ink-muted">
                {ruleInvalid}
              </p>
            )}
            <p className="text-xs text-ink-muted">
              Apply this rule, then Save settings to sync your changes.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={BUTTON} onClick={stopEditing}>
                Cancel editing
              </button>
              <button
                type="submit"
                className={PRIMARY_BUTTON}
                disabled={!ruleChanged || !!ruleInvalid}
              >
                Apply rule
              </button>
            </div>
          </>
        ) : (
          <>
            {error && (
              <div role="alert" className="space-y-2 text-sm text-red-500">
                <p>{error}</p>
                <button type="button" className={BUTTON} onClick={onReload} disabled={disabled}>
                  {reloading ? "Reloading…" : "Reload settings"}
                </button>
              </div>
            )}
            {dirty && invalid && (
              <p role="alert" className="text-xs text-ink-muted">
                {invalid}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span role="status" className="mr-auto text-xs text-ink-muted">
                {saved ? "Settings saved." : dirty ? "Unsaved changes" : ""}
              </span>
              <button type="button" className={BUTTON} onClick={onClose} disabled={disabled}>
                Close
              </button>
              <button
                type="submit"
                className={PRIMARY_BUTTON}
                disabled={!dirty || !!invalid || disabled}
              >
                {saving ? "Saving…" : "Save settings"}
              </button>
            </div>
          </>
        )}
      </div>
    </form>
  );
}
