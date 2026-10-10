import type { AnswerChoiceSummary, QuestionOption } from "./model";
import { ChoiceSetDisclosure, INLINE_CHOICE_LIMIT } from "./ChoiceSetDisclosure";
import { useState } from "react";
import { suggestBindings } from "./bindings";
import { HelpTip } from "./HelpTip";

interface Props {
  choices: AnswerChoiceSummary[];
  options: QuestionOption[];
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

export function OptionBindingEditor({ choices, options, value, onChange }: Props) {
  const [search, setSearch] = useState("");
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
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
  function rows() {
    return activeOptions
      .filter(
        (option) =>
          (!unmatchedOnly || !activeChoiceIds.has(value[option.id])) &&
          option.raw_label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      )
      .map((option) => {
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
    <fieldset className="space-y-3">
      <legend className="sr-only">Match form choices to answer choices</legend>
      {hasDuplicate && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          Every form option needs a different Answer choice.
        </p>
      )}
      <ChoiceSetDisclosure
        count={activeOptions.length}
        initiallyExpanded={selectedCount < activeOptions.length}
        summary={`${selectedCount} of ${activeOptions.length} choices matched`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink-muted">Choice matches</span>
          <HelpTip text="Each form choice needs a different answer choice. Identical labels can be suggested; review every match before saving.">
            <button
              type="button"
              onClick={() => onChange(suggestBindings(options, choices, value))}
              className="text-sm font-medium text-accent"
            >
              Suggest identical labels
            </button>
          </HelpTip>
        </div>
        {activeOptions.length > INLINE_CHOICE_LIMIT && (
          <div className="space-y-2">
            <label className="block text-xs text-ink-muted">
              <span className="sr-only">Search form choices</span>
              <input
                type="search"
                placeholder="Search form choices"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={unmatchedOnly}
                onChange={(event) => setUnmatchedOnly(event.target.checked)}
              />
              Only unmatched choices
            </label>
          </div>
        )}
        <div className="hidden grid-cols-2 gap-3 text-xs text-ink-muted sm:grid" aria-hidden="true">
          <span>Form choice</span>
          <span>Saved choice</span>
        </div>
        <div className="max-h-80 space-y-3 overflow-y-auto">{rows()}</div>
      </ChoiceSetDisclosure>
    </fieldset>
  );
}
