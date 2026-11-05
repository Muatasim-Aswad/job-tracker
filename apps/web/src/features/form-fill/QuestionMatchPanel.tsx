import type { useQuestionDraft } from "./useQuestionDraft";
import { copy } from "./copy";
import { valueText, type QuestionDetail } from "./model";
import { fillExplanation } from "./copy";
import { AnswerPicker } from "./AnswerPicker";
import { OptionBindingEditor } from "./OptionBindingEditor";
import { ChangeReview } from "./ChangeReview";

type Props = Pick<
  ReturnType<typeof useQuestionDraft>,
  | "answerId"
  | "selectedAnswer"
  | "choiceQuestion"
  | "bindings"
  | "setBindings"
  | "setAnswerId"
  | "setReviewedContext"
  | "reviewed"
  | "reviewRef"
  | "currentAnswer"
  | "captures"
> & { question: QuestionDetail; onCreateAnswer: (question: QuestionDetail) => void };

export function QuestionMatchPanel({
  answerId,
  selectedAnswer,
  choiceQuestion,
  bindings,
  setBindings,
  setAnswerId,
  setReviewedContext,
  reviewed,
  reviewRef,
  currentAnswer,
  captures,
  question,
  onCreateAnswer,
}: Props) {
  const before = currentAnswer.data
    ? `${currentAnswer.data.label}: ${valueText(currentAnswer.data.value, currentAnswer.data.choices)}`
    : "No saved answer matched";

  return (
    <section className="space-y-4" aria-label={copy.questionDrawer.savedAnswerForThisQuestion}>
      <AnswerPicker
        questionId={question.id}
        questionRevision={question.revision}
        value={answerId}
        selected={selectedAnswer.data}
        loading={selectedAnswer.isLoading}
        error={selectedAnswer.isError}
        onRetry={() => void selectedAnswer.refetch()}
        onCreate={() => onCreateAnswer(question)}
        onChange={(id) => {
          setAnswerId(id);
          setBindings({});
          setReviewedContext(null);
        }}
      />
      {choiceQuestion && selectedAnswer.data && (
        <OptionBindingEditor
          options={question.options}
          choices={selectedAnswer.data.choices}
          value={bindings}
          onChange={(next) => {
            setBindings(next);
            setReviewedContext(null);
          }}
        />
      )}
      {reviewed && selectedAnswer.data && (
        <ChangeReview
          ref={reviewRef}
          before={before}
          after={`${selectedAnswer.data.label}: ${valueText(selectedAnswer.data.value, selectedAnswer.data.choices)}`}
          behavior={
            question.review_state === "ignored"
              ? "This question stays dismissed and will not fill until reopened."
              : fillExplanation(selectedAnswer.data.fill_policy, selectedAnswer.data.status)
          }
          affected={[question.raw_question]}
        >
          {choiceQuestion && (
            <ul className="space-y-1 text-sm text-ink-muted">
              {question.options
                .filter((option) => option.status === "active")
                .map((option) => (
                  <li key={option.id}>
                    {option.raw_label} →{" "}
                    {
                      selectedAnswer.data!.choices.find(
                        (choice) => choice.id === bindings[option.id],
                      )?.display_label
                    }
                  </li>
                ))}
            </ul>
          )}
          {!!captures.length && (
            <p className="text-sm text-ink-muted">
              {copy.questionDrawer.anIdenticalRememberedValueIsMarkedReviewedADiffering}
            </p>
          )}
        </ChangeReview>
      )}
    </section>
  );
}
