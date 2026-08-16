import { answerKey } from "./model";
import type {
  AnswerChoiceInput,
  AnswerDetail,
  AnswerValue,
  AnswerValueKind,
  QuestionDetail,
} from "./model";

export interface AnswerDraft {
  answerKey: string;
  choices: AnswerChoiceInput[];
  description: string;
  fillPolicy: "auto" | "confirm_each_time" | "never";
  label: string;
  selected: string[];
  scalar: string;
  status: "active" | "disabled";
  valueKind: AnswerValueKind;
}

export function emptyAnswerDraft(): AnswerDraft {
  return {
    answerKey: "",
    choices: [],
    description: "",
    fillPolicy: "auto",
    label: "",
    selected: [],
    scalar: "",
    status: "active",
    valueKind: "text",
  };
}

export function valueKindForQuestion(control: QuestionDetail["control_kind"]): AnswerValueKind {
  if (control === "textarea") return "long_text";
  if (control === "integer" || control === "decimal") return "decimal";
  if (control === "date") return "date";
  if (control === "checkbox_boolean") return "boolean";
  if (control === "radio" || control === "select") return "single_choice";
  if (control === "checkbox_group" || control === "multi_select") return "multi_choice";
  return "text";
}

export function choicePairsForQuestion(question: QuestionDetail) {
  const used = new Set<string>();
  return question.options
    .filter((option) => option.status === "active")
    .map((option) => {
      const base = answerKey(option.raw_label) || "option";
      let choiceKey = base;
      let suffix = 2;
      while (used.has(choiceKey)) {
        choiceKey = `${base}_${suffix}`;
        suffix += 1;
      }
      used.add(choiceKey);
      return { option, choiceKey };
    });
}

export function draftForQuestion(question: QuestionDetail): AnswerDraft {
  const label = question.raw_question.slice(0, 120);
  return {
    ...emptyAnswerDraft(),
    answerKey: answerKey(label),
    choices: choicePairsForQuestion(question).map(({ option, choiceKey }) => ({
      choice_key: choiceKey,
      display_label: option.raw_label,
      status: "active",
    })),
    label,
    valueKind: valueKindForQuestion(question.control_kind),
  };
}

export function draftFromAnswer(answer: AnswerDetail): AnswerDraft {
  const value = answer.value;
  const selected =
    value.kind === "single_choice"
      ? [value.choice_key]
      : value.kind === "multi_choice"
        ? value.choice_keys
        : [];
  return {
    answerKey: answer.answer_key,
    choices: answer.choices.map(({ choice_key, display_label, status }) => ({
      choice_key,
      display_label,
      status,
    })),
    description: answer.description ?? "",
    fillPolicy: answer.fill_policy,
    label: answer.label,
    selected,
    scalar: "value" in value ? String(value.value) : "",
    status: answer.status,
    valueKind: answer.value_kind,
  };
}

export function valueFromDraft(draft: AnswerDraft): AnswerValue {
  if (draft.valueKind === "boolean") return { kind: "boolean", value: draft.scalar === "true" };
  if (draft.valueKind === "date") return { kind: "date", value: draft.scalar };
  if (draft.valueKind === "decimal") return { kind: "decimal", value: draft.scalar };
  if (draft.valueKind === "long_text") return { kind: "long_text", value: draft.scalar };
  if (draft.valueKind === "single_choice") {
    return { kind: "single_choice", choice_key: draft.selected[0] ?? "" };
  }
  if (draft.valueKind === "multi_choice") {
    return { kind: "multi_choice", choice_keys: draft.selected };
  }
  return { kind: "text", value: draft.scalar };
}
