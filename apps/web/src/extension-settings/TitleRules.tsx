import { useEffect, useRef } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { IconButton } from "../components/IconButton";
import { ACTIONS, BUTTON, CONDITIONS, FIELD, type RuleDraft } from "./model";
import { SectionHelp } from "./SectionHelp";
import { KeywordField } from "./KeywordField";

const keywordOrder = new Intl.Collator(undefined, { sensitivity: "base" });

export function TitleRuleEditor({
  rule,
  onChange,
}: {
  rule: RuleDraft;
  onChange: (rule: RuleDraft) => void;
}) {
  const condition = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    condition.current?.focus();
  }, []);
  return (
    <section aria-label="Title rule editor" className="space-y-5">
      <label className="flex flex-col gap-1.5 text-xs text-ink-muted">
        If title
        <select
          ref={condition}
          aria-label="Title condition"
          value={rule.match}
          onChange={(event) =>
            onChange({ ...rule, match: event.target.value as RuleDraft["match"] })
          }
          className={FIELD}
        >
          {Object.entries(CONDITIONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="space-y-1.5">
        <p className="text-xs text-ink-muted">any of</p>
        <KeywordField
          label="Rule keywords"
          value={rule}
          onChange={(value) => onChange({ ...rule, ...value })}
          disabled={false}
        />
      </div>
      <label className="flex flex-col gap-1.5 text-xs text-ink-muted">
        Then
        <select
          aria-label="Rule action"
          value={rule.action}
          onChange={(event) =>
            onChange({ ...rule, action: event.target.value as RuleDraft["action"] })
          }
          className={FIELD}
        >
          {Object.entries(ACTIONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
export function TitleRules({
  rules,
  onChange,
  onEdit,
  disabled,
}: {
  rules: RuleDraft[];
  onChange: (rules: RuleDraft[]) => void;
  onEdit: (rule: RuleDraft | null) => void;
  disabled: boolean;
}) {
  return (
    <details className="group border-t border-line pt-5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden="true" className="group-open:rotate-90" />
        Keyword actions
        <SectionHelp
          title="Keyword actions"
          description="Match job titles against keyword alternatives to outline, hide, star, or skip jobs. Matching ignores case and respects word boundaries. Disabling a rule does not undo actions already recorded."
        />
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex justify-end">
          <button
            type="button"
            className={BUTTON}
            disabled={disabled || rules.length >= 100}
            onClick={() => onEdit(null)}
          >
            <Plus size={14} aria-hidden="true" />
            Add rule
          </button>
        </div>
        {rules.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No title rules. Add one to outline, hide, star, or skip matching jobs.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rules.map((item) => (
              <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <input
                  type="checkbox"
                  aria-label={`Enable rule: ${item.terms.join(", ")}`}
                  checked={item.enabled}
                  disabled={disabled}
                  className="mt-1 accent-accent"
                  onChange={(event) =>
                    onChange(
                      rules.map((value) =>
                        value.id === item.id ? { ...value, enabled: event.target.checked } : value,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onEdit(item)}
                  className="group min-w-0 flex-1 rounded text-left text-sm leading-relaxed text-ink hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                  aria-label={`Edit rule: ${item.terms.join(", ")}`}
                >
                  <span className="block">
                    If title {CONDITIONS[item.match]} any of these, then{" "}
                    {ACTIONS[item.action].toLowerCase()}.
                  </span>
                  <span className="my-1.5 flex flex-wrap gap-1.5">
                    {[...item.terms]
                      .sort((a, b) => keywordOrder.compare(a, b))
                      .map((term) => (
                        <span
                          key={term}
                          className="max-w-full wrap-anywhere rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-accent"
                        >
                          {term}
                        </span>
                      ))}
                  </span>
                </button>
                <IconButton
                  label={`Delete rule: ${item.terms.join(", ")}`}
                  onClick={() => onChange(rules.filter((value) => value.id !== item.id))}
                  disabled={disabled}
                  className="shrink-0 text-ink-muted hover:text-red-500"
                >
                  <Trash2 size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
