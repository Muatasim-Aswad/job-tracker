import type { components } from "@job-tracker/shared/api";

type Schemas = components["schemas"];
export type AnswerChoiceInput = Schemas["AnswerChoiceInput"];
export type AnswerChoiceSummary = Schemas["AnswerChoiceSummary"];
export type AnswerDetail = Schemas["AnswerDetail"];
export type AnswerListItem = Schemas["AnswerListItem"];
export type AnswerSummary = Schemas["AnswerSummary"];
export type AnswerValue = Schemas["AnswerCreate"]["value"];
export type AnswerValueKind = Schemas["AnswerCreate"]["value_kind"];
export type CaptureDetail = Schemas["CaptureDetail"];
export type CaptureRecordSummary = Schemas["CaptureRecordSummary"];
export type CaptureValue = NonNullable<Schemas["CaptureDetail"]["value"]>;
export type MappingSummary = Schemas["MappingSummary"];
export type QuestionDetail = Schemas["QuestionDetail"];
export type QuestionSummary = Schemas["QuestionSummary"];
export type QuestionOption = Schemas["QuestionOptionSummary"];

export const VALUE_KIND_LABEL: Record<AnswerValueKind, string> = {
  text: "Text",
  long_text: "Long text",
  decimal: "Number",
  boolean: "Yes / No",
  date: "Date",
  single_choice: "Single choice",
  multi_choice: "Multiple choice",
};

export const POLICY_LABEL = {
  auto: "Automatic",
  confirm_each_time: "Ask every time",
  never: "Never fill",
} as const;

export const CONTROL_LABEL: Record<QuestionDetail["control_kind"], string> = {
  text: "Short answer",
  textarea: "Long answer",
  integer: "Whole number",
  decimal: "Number",
  date: "Date",
  checkbox_boolean: "Yes or no",
  radio: "Single choice",
  select: "Dropdown",
  checkbox_group: "Multiple choices",
  multi_select: "Multiple choices",
};

export const SOURCE_LABEL = {
  user_input: "You typed this",
  confirmed_external: "You chose to remember this",
  unattributed_change: "Changed outside Job Tracker — source uncertain",
} as const;

export function answerKey(label: string): string {
  return label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

type ValueLabel = { id?: string; raw_label?: string; choice_key?: string; display_label?: string };

export function valueText(
  value: AnswerValue | CaptureValue | null | undefined,
  labels: ValueLabel[] = [],
): string {
  if (!value) return "No retained value";
  if (value.kind === "boolean") return value.value ? "Yes" : "No";
  const choiceLabel = (key: string) =>
    labels.find((label) => label.choice_key === key)?.display_label ?? "Option no longer available";
  const optionLabel = (id: string) =>
    labels.find((label) => label.id === id)?.raw_label ?? "Option no longer available";
  if (value.kind === "single_choice")
    return "choice_key" in value
      ? choiceLabel(value.choice_key)
      : optionLabel(value.question_option_id);
  if (value.kind === "multi_choice")
    return (
      "choice_keys" in value
        ? value.choice_keys.map(choiceLabel)
        : value.question_option_ids.map(optionLabel)
    ).join(", ");
  return value.value;
}

export function siteLabel(scope: string): string {
  return scope === "linkedin:easy-apply" ? "LinkedIn Easy Apply" : scope;
}

export function fillExplanation(policy: keyof typeof POLICY_LABEL, status = "active"): string {
  if (status !== "active") return "Filling is paused for this answer.";
  if (policy === "never") return "This answer will not fill forms.";
  if (policy === "confirm_each_time") return "You will be asked before each fill.";
  return "Fills empty matched fields automatically. Existing form values stay unchanged.";
}

export function isChoiceKind(kind: AnswerValueKind): boolean {
  return kind === "single_choice" || kind === "multi_choice";
}

export function controlAcceptsAnswer(
  control: QuestionDetail["control_kind"],
  kind: AnswerValueKind,
): boolean {
  if (control === "text") return kind === "text" || kind === "long_text";
  if (control === "textarea") return kind === "text" || kind === "long_text";
  if (control === "integer" || control === "decimal") return kind === "decimal";
  if (control === "date") return kind === "date";
  if (control === "checkbox_boolean") return kind === "boolean";
  if (control === "radio" || control === "select") return kind === "single_choice";
  return kind === "multi_choice";
}
