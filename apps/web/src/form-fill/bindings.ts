import type { AnswerChoiceSummary, QuestionOption } from "./model";

export function bindingsComplete(
  options: QuestionOption[],
  choices: AnswerChoiceSummary[],
  value: Record<string, string>,
): boolean {
  const activeChoices = new Set(
    choices.filter((choice) => choice.status === "active").map((choice) => choice.id),
  );
  return options
    .filter((option) => option.status === "active")
    .every((option) => activeChoices.has(value[option.id]));
}
