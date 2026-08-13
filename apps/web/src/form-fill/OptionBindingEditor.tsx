import type { AnswerChoiceSummary, QuestionOption } from "./model";

interface Props {
  choices: AnswerChoiceSummary[];
  options: QuestionOption[];
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

export function OptionBindingEditor({ choices, options, value, onChange }: Props) {
  const activeOptions = options.filter((option) => option.status === "active");
  return (
    <fieldset className="space-y-3 rounded-lg border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink">Complete Option matches</legend>
      <p className="text-xs text-ink-muted">
        Choose what every current form option means. Saving replaces the entire set.
      </p>
      {activeOptions.map((option) => (
        <label
          key={option.id}
          className="grid gap-1 text-sm text-ink sm:grid-cols-2 sm:items-center"
        >
          <span>{option.raw_label}</span>
          <select
            aria-label={`Meaning of ${option.raw_label}`}
            value={value[option.id] ?? ""}
            onChange={(event) => onChange({ ...value, [option.id]: event.target.value })}
            className="rounded border border-line bg-surface px-3 py-2"
          >
            <option value="">Select an Answer choice</option>
            {choices
              .filter((choice) => choice.status === "active")
              .map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.display_label}
                </option>
              ))}
          </select>
        </label>
      ))}
    </fieldset>
  );
}
