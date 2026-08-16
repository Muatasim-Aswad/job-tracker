import { useState } from "react";
import type { AnswerValueKind } from "./model";
import { answerKey, isChoiceKind, VALUE_KIND_LABEL } from "./model";
import type { AnswerDraft } from "./answerDraft";
import { ChoiceSetDisclosure, INLINE_CHOICE_LIMIT } from "./ChoiceSetDisclosure";

interface Props {
  draft: AnswerDraft;
  existing: boolean;
  questionLocked?: boolean;
  onChange: (draft: AnswerDraft) => void;
}

const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";

export function AnswerEditor({ draft, existing, questionLocked = false, onChange }: Props) {
  const [choiceQuery, setChoiceQuery] = useState("");
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

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-ink">
        Label
        <input
          required
          value={draft.label}
          onChange={(event) => {
            const label = event.target.value;
            onChange({
              ...draft,
              label,
              answerKey: existing || draft.answerKey ? draft.answerKey : answerKey(label),
            });
          }}
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-ink">
        Stable key
        <input
          required
          readOnly={existing}
          value={draft.answerKey}
          onChange={(event) => set("answerKey", answerKey(event.target.value))}
          className={`${inputClass} read-only:bg-sunken`}
        />
      </label>
      <label className="block text-sm font-medium text-ink">
        Description
        <textarea
          value={draft.description}
          onChange={(event) => set("description", event.target.value)}
          className={inputClass}
          rows={2}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink">
          Value type
          <select
            disabled={existing || questionLocked}
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
            className={inputClass}
          >
            {Object.entries(VALUE_KIND_LABEL).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-ink">
          Fill policy
          <select
            value={draft.fillPolicy}
            onChange={(event) => set("fillPolicy", event.target.value as AnswerDraft["fillPolicy"])}
            className={inputClass}
          >
            <option value="auto">Automatic</option>
            <option value="confirm_each_time">Ask every time</option>
            <option value="never">Never fill</option>
          </select>
        </label>
      </div>

      {isChoiceKind(draft.valueKind) ? (
        <fieldset className="space-y-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-medium text-ink">Choice vocabulary and value</legend>
          <ChoiceSetDisclosure
            count={draft.choices.length}
            summary={`${draft.choices.length} choices · ${selectedSummary}`}
          >
            {draft.choices.length > INLINE_CHOICE_LIMIT && (
              <label className="block text-sm font-medium text-ink">
                Search choices
                <input
                  type="search"
                  value={choiceQuery}
                  onChange={(event) => setChoiceQuery(event.target.value)}
                  className={inputClass}
                />
              </label>
            )}
            <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
              {displayedChoices.map(({ choice, index }) => {
                const selected = draft.selected.includes(choice.choice_key);
                return (
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
                        const choice_key = existing ? choice.choice_key : answerKey(display_label);
                        const choices = draft.choices.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, display_label, choice_key } : item,
                        );
                        const selectedKeys = draft.selected.map((key) =>
                          key === choice.choice_key ? choice_key : key,
                        );
                        onChange({ ...draft, choices, selected: selectedKeys });
                      }}
                      className={inputClass}
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
              <button type="button" onClick={addChoice} className="text-sm font-medium text-accent">
                Add choice
              </button>
            )}
          </ChoiceSetDisclosure>
        </fieldset>
      ) : draft.valueKind === "long_text" ? (
        <label className="block text-sm font-medium text-ink">
          Value
          <textarea
            required
            value={draft.scalar}
            onChange={(event) => set("scalar", event.target.value)}
            className={inputClass}
            rows={5}
          />
        </label>
      ) : draft.valueKind === "boolean" ? (
        <fieldset>
          <legend className="text-sm font-medium text-ink">Value</legend>
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
        <label className="block text-sm font-medium text-ink">
          Value
          <input
            required
            type={draft.valueKind === "date" ? "date" : "text"}
            inputMode={draft.valueKind === "decimal" ? "decimal" : undefined}
            value={draft.scalar}
            onChange={(event) => set("scalar", event.target.value)}
            className={inputClass}
          />
        </label>
      )}
    </div>
  );
}
