import type { AnswerChoiceSummary, QuestionOption } from "./model";

const normalizeLabel = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function suggestBindings(
  options: QuestionOption[],
  choices: AnswerChoiceSummary[],
  current: Record<string, string> = {},
): Record<string, string> {
  const next = { ...current };
  const used = new Set(Object.values(next));
  for (const option of options.filter((item) => item.status === "active")) {
    if (next[option.id]) continue;
    const candidates = choices.filter(
      (choice) =>
        choice.status === "active" &&
        normalizeLabel(choice.display_label) === normalizeLabel(option.raw_label),
    );
    const peers = options.filter(
      (peer) =>
        peer.status === "active" &&
        normalizeLabel(peer.raw_label) === normalizeLabel(option.raw_label),
    );
    if (candidates.length === 1 && peers.length === 1 && !used.has(candidates[0].id)) {
      next[option.id] = candidates[0].id;
      used.add(candidates[0].id);
    }
  }
  return next;
}

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
