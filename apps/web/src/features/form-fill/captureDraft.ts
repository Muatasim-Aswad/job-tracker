import type { CaptureApply } from "./client";
import type { AnswerDetail, AnswerValue, CaptureDetail, QuestionDetail } from "./model";
import { choicePairsForQuestion } from "./answerDraft";

type Action = CaptureApply["action"];
type ChoicePairs = ReturnType<typeof choicePairsForQuestion>;
interface CaptureValueContext {
  capture: CaptureDetail | undefined;
  answer: AnswerDetail | undefined;
  action: Action | "";
  pairs: ChoicePairs;
  bindings: Record<string, string>;
}

export function captureValueForAnswer({
  capture,
  answer: selectedAnswerData,
  action,
  pairs,
  bindings,
}: CaptureValueContext): AnswerValue {
  if (!capture?.value) return { kind: "text", value: "" };
  const value = capture.value;
  if (value.kind === "text" && selectedAnswerData?.value_kind === "long_text") {
    return { kind: "long_text", value: value.value };
  }
  if (value.kind === "single_choice") {
    if (action === "create_answer_and_map") {
      return {
        kind: "single_choice",
        choice_key:
          pairs.find(({ option }) => option.id === value.question_option_id)?.choiceKey ?? "",
      };
    }
    const choiceId = bindings[value.question_option_id];
    const choice = selectedAnswerData?.choices.find((item) => item.id === choiceId);
    return { kind: "single_choice", choice_key: choice?.choice_key ?? "" };
  }
  if (value.kind === "multi_choice") {
    if (action === "create_answer_and_map") {
      return {
        kind: "multi_choice",
        choice_keys: value.question_option_ids.map(
          (id) => pairs.find(({ option }) => option.id === id)?.choiceKey ?? "",
        ),
      };
    }
    return {
      kind: "multi_choice",
      choice_keys: value.question_option_ids.map(
        (id) =>
          selectedAnswerData?.choices.find((item) => item.id === bindings[id])?.choice_key ?? "",
      ),
    };
  }
  return value;
}

interface CaptureRequestContext extends CaptureValueContext {
  capture: CaptureDetail;
  question: QuestionDetail;
  action: Action;
  label: string;
  key: string;
  description: string;
  fillPolicy: "auto" | "confirm_each_time" | "never";
  choiceQuestion: boolean;
  newChoices: { choice_key: string; display_label: string; status: "active" }[];
}

export function captureApplyRequest({
  capture,
  question,
  answer,
  action,
  pairs,
  bindings,
  label,
  key,
  description,
  fillPolicy,
  choiceQuestion,
  newChoices,
}: CaptureRequestContext): CaptureApply {
  const common = {
    expected_capture_revision: capture.revision,
    expected_question_revision: question.revision,
  };
  let body: CaptureApply;
  if (action === "create_answer_and_map") {
    body = {
      action,
      ...common,
      answer_key: key,
      label,
      description: description || null,
      fill_policy: fillPolicy,
      value_kind: capture.value_kind,
      value: captureValueForAnswer({ capture, answer, action, pairs, bindings }),
      choices: choiceQuestion ? newChoices : [],
      bindings: choiceQuestion
        ? pairs.map(({ option, choiceKey }) => ({
            question_option_id: option.id,
            answer_choice_key: choiceKey,
          }))
        : [],
      expected_mapping_revision: capture.mapping?.revision ?? null,
    };
  } else if (action === "update_answer") {
    body = {
      action,
      ...common,
      answer_id: answer!.id,
      expected_answer_revision: answer!.revision,
      expected_mapping_revision: capture.mapping?.revision ?? null,
      value: captureValueForAnswer({ capture, answer, action, pairs, bindings }),
    };
  } else if (action === "retarget_mapping") {
    body = {
      action,
      ...common,
      answer_id: answer!.id,
      expected_answer_revision: answer!.revision,
      expected_mapping_revision: capture.mapping!.revision,
      bindings: choiceQuestion
        ? question.options
            .filter((option) => option.status === "active")
            .map((option) => ({
              question_option_id: option.id,
              answer_choice_id: bindings[option.id],
            }))
        : [],
    };
  } else {
    body = {
      action,
      ...common,
      answer_id: answer!.id,
      mapping_id: capture.mapping!.id,
      expected_answer_revision: answer!.revision,
      expected_mapping_revision: capture.mapping!.revision,
      bindings: question.options
        .filter((option) => option.status === "active")
        .map((option) => ({
          question_option_id: option.id,
          answer_choice_id: bindings[option.id],
        })),
    };
  }
  return body;
}
