import type { useCaptureDraft } from "./useCaptureDraft";
import { copy } from "./copy";
import { valueText, type CaptureDetail, type QuestionDetail } from "./model";
import { captureValueForAnswer } from "./captureDraft";
import { fillExplanation } from "./copy";
import { ChangeReview } from "./ChangeReview";

type Props = Pick<
  ReturnType<typeof useCaptureDraft>,
  | "action"
  | "label"
  | "selectedAnswer"
  | "reviewRef"
  | "choiceQuestion"
  | "pairs"
  | "newChoices"
  | "bindings"
  | "currentAnswer"
  | "fillPolicy"
> & { capture: CaptureDetail; question: QuestionDetail };

export function CaptureChangeReview({
  action,
  label,
  selectedAnswer,
  reviewRef,
  choiceQuestion,
  pairs,
  newChoices,
  bindings,
  currentAnswer,
  fillPolicy,
  capture,
  question,
}: Props) {
  const before = currentAnswer.data
    ? `${currentAnswer.data.label}: ${valueText(currentAnswer.data.value, currentAnswer.data.choices)}`
    : copy.captureChangeReview.noSavedAnswerForThisQuestion;
  const afterValue =
    action === "retarget_mapping" || action === "replace_option_bindings"
      ? selectedAnswer.data?.value
      : captureValueForAnswer({ capture, answer: selectedAnswer.data, action, pairs, bindings });
  const afterLabels =
    action === "create_answer_and_map" ? newChoices : (selectedAnswer.data?.choices ?? []);
  const behavior =
    question?.review_state === "ignored"
      ? copy.captureChangeReview.thisQuestionIsDismissedReopenItBeforeFilling
      : fillExplanation(
          action === "create_answer_and_map"
            ? fillPolicy
            : (selectedAnswer.data?.fill_policy ?? "never"),
          selectedAnswer.data?.status ?? "active",
        );
  const affected =
    action === "update_answer"
      ? (selectedAnswer.data?.mappings.map((item) => item.raw_question) ?? [])
      : capture
        ? [capture.question.raw_question]
        : [];

  return (
    <ChangeReview
      ref={reviewRef}
      before={before}
      after={`${action === "create_answer_and_map" ? label : (selectedAnswer.data?.label ?? "")}: ${valueText(afterValue, afterLabels)}`}
      behavior={behavior}
      affected={affected}
    >
      {capture.mapping && capture.mapping.status !== "active" && action !== "update_answer" && (
        <p className="text-sm text-ink-muted">
          {copy.captureDrawer.savingReactivatesThisQuestionsMatch}
        </p>
      )}
      {action === "update_answer" && (
        <p className="text-sm text-ink-muted">
          {copy.captureDrawer.everyQuestionUsingThisSavedAnswerWillUseThe}
        </p>
      )}
      {(action === "retarget_mapping" || action === "replace_option_bindings") && (
        <p className="text-sm text-ink-muted">
          {copy.captureDrawer.theSavedAnswersValueStaysUnchangedThisRememberedValue}
        </p>
      )}
      {choiceQuestion && (
        <ul className="space-y-1 text-sm text-ink-muted">
          {pairs.map(({ option, choiceKey }) => (
            <li key={option.id}>
              {option.raw_label} →{" "}
              {action === "create_answer_and_map"
                ? newChoices.find((choice) => choice.choice_key === choiceKey)?.display_label
                : selectedAnswer.data?.choices.find((choice) => choice.id === bindings[option.id])
                    ?.display_label}
            </li>
          ))}
        </ul>
      )}
    </ChangeReview>
  );
}
