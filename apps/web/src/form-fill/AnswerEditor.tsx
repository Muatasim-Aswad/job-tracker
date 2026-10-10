import { useId, useState, type ReactNode } from "react";
import type { AnswerValueKind } from "./model";
import { answerKey, isChoiceKind, VALUE_KIND_LABEL } from "./model";
import type { AnswerDraft } from "./answerDraft";
import { ChoiceSetDisclosure, INLINE_CHOICE_LIMIT } from "./ChoiceSetDisclosure";
import { AnswerFillBehavior } from "./AnswerFillBehavior";
import { HelpTip } from "./HelpTip";

interface Props {
  draft: AnswerDraft;
  existing: boolean;
  questionLocked?: boolean;
  nameInHeader?: boolean;
  afterValue?: ReactNode;
  valueHelp?: string | null;
  onChange: (draft: AnswerDraft) => void;
}

const inputClass =
  "mt-1 w-full rounded-md border border-line bg-surface px-3 py-2.5 font-normal text-ink focus:border-accent focus:outline-none";

export function AnswerEditor({
  draft,
  existing,
  questionLocked = false,
  nameInHeader = false,
  afterValue,
  valueHelp,
  onChange,
}: Props) {
  const helpId = useId();
  const describedBy = valueHelp ? helpId : undefined;
  const [choiceQuery, setChoiceQuery] = useState("");
  const contextualValue = existing || questionLocked;
  const set = <K extends keyof AnswerDraft>(key: K, value: AnswerDraft[K]) =>
    onChange({ ...draft, [key]: value });

  function addChoice() {
    const displayLabel = `Choice ${draft.choices.length + 1}`;
    const choice_key = answerKey(displayLabel);
    setChoiceQuery("");
    set("choices", [
      ...draft.choices,
      { choice_key, display_label: displayLabel, status: "active" },
    ]);
  }

  const normalizedChoiceQuery = choiceQuery.trim().toLocaleLowerCase();
  const displayedChoices = draft.choices
    .map((choice, index) => ({ choice, index }))
    .filter(
      ({ choice }) =>
        !normalizedChoiceQuery ||
        choice.display_label.toLocaleLowerCase().includes(normalizedChoiceQuery) ||
        choice.choice_key.toLocaleLowerCase().includes(normalizedChoiceQuery),
    )
    .sort(
      (left, right) =>
        Number(draft.selected.includes(right.choice.choice_key)) -
        Number(draft.selected.includes(left.choice.choice_key)),
    );
  const selectedLabels = draft.choices
    .filter((choice) => draft.selected.includes(choice.choice_key))
    .map((choice) => choice.display_label);
  const selectedSummary =
    selectedLabels.length === 0
      ? "No value selected"
      : draft.valueKind === "single_choice"
        ? `Selected: ${selectedLabels[0]}`
        : `${selectedLabels.length} selected`;

  const nameField = (
    <label className="block text-xs font-normal text-ink-muted">
      <span className={existing ? "sr-only" : undefined}>Answer name</span>
      <input
        required
        placeholder="Answer name"
        value={draft.label}
        onChange={(event) => {
          const label = event.target.value;
          onChange({
            ...draft,
            label,
            answerKey:
              existing || (draft.answerKey && draft.answerKey !== answerKey(draft.label))
                ? draft.answerKey
                : answerKey(label),
          });
        }}
        className={`${inputClass} ${existing ? "text-xl font-semibold" : "text-sm"}`}
      />
    </label>
  );

  return (
    <div className="space-y-4 text-sm">
      {!questionLocked && !nameInHeader && nameField}
      <div className="space-y-1">
        {isChoiceKind(draft.valueKind) ? (
          <fieldset aria-describedby={describedBy} className="min-w-0 space-y-3">
            <legend className="sr-only">Value</legend>
            <ChoiceSetDisclosure
              count={draft.choices.length}
              initiallyExpanded={draft.selected.length === 0}
              summary={`${draft.choices.length} choices · ${selectedSummary}`}
            >
              {draft.choices.length > INLINE_CHOICE_LIMIT && (
                <label className="block text-xs font-normal text-ink-muted">
                  <span className="sr-only">Search choices</span>
                  <input
                    type="search"
                    placeholder="Search choices"
                    value={choiceQuery}
                    onChange={(event) => setChoiceQuery(event.target.value)}
                    className="w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm font-normal text-ink focus:border-accent focus:outline-none"
                  />
                </label>
              )}
              <div
                className={`max-h-80 overflow-y-auto pr-1 ${questionLocked && draft.choices.length <= 4 ? "grid gap-2 sm:grid-cols-2" : "space-y-2"}`}
              >
                {displayedChoices.map(({ choice, index }) => {
                  const selected = draft.selected.includes(choice.choice_key);
                  return questionLocked ? (
                    <label
                      key={choice.choice_key || index}
                      className="flex cursor-pointer items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink has-checked:border-accent has-checked:bg-sunken"
                    >
                      <input
                        aria-label={`Use ${choice.display_label || `choice ${index + 1}`} as the value`}
                        type={draft.valueKind === "single_choice" ? "radio" : "checkbox"}
                        name="answer-choice-value"
                        checked={selected}
                        disabled={choice.status === "disabled"}
                        className="size-4 accent-accent"
                        onChange={() =>
                          set(
                            "selected",
                            draft.valueKind === "single_choice"
                              ? [choice.choice_key]
                              : selected
                                ? draft.selected.filter((key) => key !== choice.choice_key)
                                : [...draft.selected, choice.choice_key],
                          )
                        }
                      />
                      <span>{choice.display_label}</span>
                    </label>
                  ) : (
                    <div
                      key={choice.choice_key || index}
                      className="grid grid-cols-[auto_1fr_auto] gap-2"
                    >
                      <input
                        aria-label={`Use ${choice.display_label || `choice ${index + 1}`} as the value`}
                        type={draft.valueKind === "single_choice" ? "radio" : "checkbox"}
                        name="answer-choice-value"
                        checked={selected}
                        disabled={choice.status === "disabled"}
                        onChange={() =>
                          set(
                            "selected",
                            draft.valueKind === "single_choice"
                              ? [choice.choice_key]
                              : selected
                                ? draft.selected.filter((key) => key !== choice.choice_key)
                                : [...draft.selected, choice.choice_key],
                          )
                        }
                      />
                      <input
                        aria-label={`Choice ${index + 1} label`}
                        readOnly={questionLocked}
                        value={choice.display_label}
                        onChange={(event) => {
                          const display_label = event.target.value;
                          const choice_key = existing
                            ? choice.choice_key
                            : answerKey(display_label);
                          const choices = draft.choices.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, display_label, choice_key } : item,
                          );
                          const selectedKeys = draft.selected.map((key) =>
                            key === choice.choice_key ? choice_key : key,
                          );
                          onChange({ ...draft, choices, selected: selectedKeys });
                        }}
                        className={`${inputClass} text-sm`}
                      />
                      {questionLocked ? null : existing ? (
                        <select
                          aria-label={`Choice ${index + 1} status`}
                          value={choice.status}
                          onChange={(event) =>
                            set(
                              "choices",
                              draft.choices.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, status: event.target.value as "active" | "disabled" }
                                  : item,
                              ),
                            )
                          }
                          className="rounded border border-line bg-surface px-2 text-sm text-ink"
                        >
                          <option value="active">Active</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            set(
                              "choices",
                              draft.choices.filter((_, itemIndex) => itemIndex !== index),
                            );
                          }}
                          className="rounded px-2 text-sm text-red-700 dark:text-red-300"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
                {displayedChoices.length === 0 && (
                  <p className="text-sm text-ink-muted">No choices match this search.</p>
                )}
              </div>
              {!questionLocked && (
                <button
                  type="button"
                  onClick={addChoice}
                  className="text-sm font-medium text-accent"
                >
                  Add choice
                </button>
              )}
            </ChoiceSetDisclosure>
          </fieldset>
        ) : draft.valueKind === "long_text" ? (
          <label className="block text-xs font-normal text-ink-muted">
            <span className={contextualValue ? "sr-only" : undefined}>Value</span>
            <textarea
              aria-describedby={describedBy}
              required
              placeholder="Enter your answer"
              value={draft.scalar}
              onChange={(event) => set("scalar", event.target.value)}
              className={`${inputClass} ${contextualValue ? "text-base" : "text-sm"}`}
              rows={5}
            />
          </label>
        ) : draft.valueKind === "boolean" ? (
          <fieldset aria-describedby={describedBy}>
            <legend className={contextualValue ? "sr-only" : "text-xs font-normal text-ink-muted"}>
              Value
            </legend>
            <div className="mt-1 flex gap-4">
              {[
                ["true", "Yes"],
                ["false", "No"],
              ].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    required
                    type="radio"
                    name="boolean-answer"
                    value={value}
                    checked={draft.scalar === value}
                    onChange={() => set("scalar", value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <label className="block text-xs font-normal text-ink-muted">
            <span className={contextualValue ? "sr-only" : undefined}>Value</span>
            <input
              aria-describedby={describedBy}
              required
              placeholder="Enter your answer"
              type={draft.valueKind === "date" ? "date" : "text"}
              inputMode={draft.valueKind === "decimal" ? "decimal" : undefined}
              value={draft.scalar}
              onChange={(event) => set("scalar", event.target.value)}
              className={`${inputClass} ${contextualValue ? "text-lg" : "text-sm"}`}
            />
          </label>
        )}
        {valueHelp && (
          <p id={helpId} className="max-w-prose text-xs leading-5 text-ink-muted">
            {valueHelp}
          </p>
        )}
      </div>
      {afterValue}

      <details className="border-t border-line pt-3 text-sm text-ink-muted">
        <summary className="cursor-pointer font-medium">Answer details</summary>
        {!existing && !questionLocked && (
          <label className="mt-3 block text-xs font-normal text-ink-muted">
            Value type
            <select
              value={draft.valueKind}
              onChange={(event) =>
                onChange({
                  ...draft,
                  valueKind: event.target.value as AnswerValueKind,
                  scalar: "",
                  selected: [],
                  choices: [],
                })
              }
              className={`${inputClass} text-sm`}
            >
              {Object.entries(VALUE_KIND_LABEL).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {contextualValue && (
          <dl className="mt-3">
            <dt className="text-xs text-ink-muted">Value type</dt>
            <dd className="mt-1 text-sm text-ink">{VALUE_KIND_LABEL[draft.valueKind]}</dd>
          </dl>
        )}
        {!existing && (
          <div className="mt-3">
            <AnswerFillBehavior
              policy={draft.fillPolicy}
              status={draft.status}
              onChange={(policy) => set("fillPolicy", policy)}
            />
          </div>
        )}

        {questionLocked && <div className="mt-3">{nameField}</div>}

        <label className="mt-3 block text-xs font-normal text-ink-muted">
          Stable key
          <HelpTip
            text="Generated from the label. Change it only to distinguish answers with the same label."
            className="block"
          >
            <input
              required
              value={draft.answerKey}
              onChange={(event) => set("answerKey", answerKey(event.target.value))}
              className={`${inputClass} text-sm read-only:bg-sunken`}
            />
          </HelpTip>
        </label>
        <label className="mt-3 block text-xs font-normal text-ink-muted">
          Description
          <textarea
            value={draft.description}
            onChange={(event) => set("description", event.target.value)}
            className={`${inputClass} text-sm`}
            rows={2}
          />
        </label>
      </details>
    </div>
  );
}
