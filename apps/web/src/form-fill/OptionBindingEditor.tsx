import { useState } from "react";
import type { AnswerChoiceSummary, QuestionOption } from "./model";

const LARGE_OPTION_SET = 12;

interface Props {
  choices: AnswerChoiceSummary[];
  options: QuestionOption[];
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

export function OptionBindingEditor({ choices, options, value, onChange }: Props) {
  const activeOptions = options.filter((option) => option.status === "active");
  const activeChoices = choices.filter((choice) => choice.status === "active");
  const activeChoiceIds = new Set(activeChoices.map((choice) => choice.id));
  const selectedCount = activeOptions.filter((option) =>
    activeChoiceIds.has(value[option.id]),
  ).length;
  const choiceOwners = new Map<string, Set<string>>();
  for (const option of activeOptions) {
    const choiceId = value[option.id];
    if (!activeChoiceIds.has(choiceId)) continue;
    const owners = choiceOwners.get(choiceId) ?? new Set<string>();
    owners.add(option.id);
    choiceOwners.set(choiceId, owners);
  }
  const hasDuplicate = [...choiceOwners.values()].some((owners) => owners.size > 1);
  const large = activeOptions.length > LARGE_OPTION_SET;
  const [expanded, setExpanded] = useState(false);
  function rows() {
    return activeOptions.map((option) => {
      const selectedId = value[option.id] ?? "";
      const selectedChoice = activeChoices.find((choice) => choice.id === selectedId);
      const remainingChoices = activeChoices.filter((choice) => choice.id !== selectedId);
      return (
        <label
          key={option.id}
          className="grid gap-1 text-sm text-ink sm:grid-cols-2 sm:items-center"
        >
          <span>{option.raw_label}</span>
          <select
            aria-label={`Meaning of ${option.raw_label}`}
            value={selectedId}
            onChange={(event) => onChange({ ...value, [option.id]: event.target.value })}
            className="rounded border border-line bg-surface px-3 py-2"
          >
            {selectedChoice && (
              <option
                value={selectedChoice.id}
                disabled={(choiceOwners.get(selectedChoice.id)?.size ?? 0) > 1}
              >
                {selectedChoice.display_label}
              </option>
            )}
            <option value="">Select an Answer choice</option>
            {remainingChoices.map((choice) => (
              <option
                key={choice.id}
                value={choice.id}
                disabled={
                  choiceOwners.has(choice.id) && !choiceOwners.get(choice.id)?.has(option.id)
                }
              >
                {choice.display_label}
              </option>
            ))}
          </select>
        </label>
      );
    });
  }
  return (
    <fieldset className="space-y-3 rounded-lg border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink">Complete Option matches</legend>
      <p className="text-xs text-ink-muted">
        Choose a different Answer choice for every current form option. Saving replaces the entire
        set.
      </p>
      {hasDuplicate && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          Every form option needs a different Answer choice.
        </p>
      )}
      {large ? (
        <details
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
          className="rounded border border-line bg-surface px-3 py-2"
        >
          <summary className="cursor-pointer text-sm font-medium text-ink">
            {activeOptions.length} Option matches · {selectedCount} selected
          </summary>
          {expanded && <div className="mt-3 space-y-3">{rows()}</div>}
        </details>
      ) : (
        rows()
      )}
    </fieldset>
  );
}
