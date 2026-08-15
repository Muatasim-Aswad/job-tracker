import type { AnswerChoiceSummary, QuestionOption } from "./model";

export function bindingsComplete(
  options: QuestionOption[],
  choices: AnswerChoiceSummary[],
  value: Record<string, string>,
): boolean {
  const activeChoices = new Set(
    choices.filter((choice) => choice.status === "active").map((choice) => choice.id),
  );
  const selected = options
    .filter((option) => option.status === "active")
    .map((option) => value[option.id]);
  return (
    selected.every((choiceId) => activeChoices.has(choiceId)) &&
    new Set(selected).size === selected.length
  );
}
