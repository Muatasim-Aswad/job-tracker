import { CaptureNewAnswerFields } from "./CaptureNewAnswerFields";
import type { useCaptureDraft } from "./useCaptureDraft";
import { copy } from "./copy";
import type { CaptureApply } from "./client";
import { valueText, type CaptureDetail, type QuestionDetail } from "./model";
import { POLICY_LABEL } from "./copy";
import { AnswerPicker } from "./AnswerPicker";
import { OptionBindingEditor } from "./OptionBindingEditor";

type Action = CaptureApply["action"];

type Props = Pick<
  ReturnType<typeof useCaptureDraft>,
  | "action"
  | "setAction"
  | "answerId"
  | "setAnswerId"
  | "label"
  | "setLabel"
  | "setKey"
  | "description"
  | "setDescription"
  | "fillPolicy"
  | "setFillPolicy"
  | "bindings"
  | "setBindings"
  | "setReviewedContext"
  | "selectedAnswer"
  | "choiceQuestion"
> & {
  stableKey: string;
  capture: CaptureDetail;
  question: QuestionDetail;
  onOpenQuestion: (questionId: string) => void;
};

export function CaptureActionPanel({
  action,
  setAction,
  answerId,
  setAnswerId,
  label,
  setLabel,
  stableKey,
  setKey,
  description,
  setDescription,
  fillPolicy,
  setFillPolicy,
  bindings,
  setBindings,
  setReviewedContext,
  selectedAnswer,
  choiceQuestion,
  capture,
  question,
  onOpenQuestion,
}: Props) {
  return (
    <section className="space-y-4" aria-label={copy.captureDrawer.howToUseThisValue}>
      <h3 className="text-sm font-medium text-ink-muted">
        {!capture.mapping || capture.mapping.status === "retired"
          ? copy.captureDrawerMessages.saveAsANewAnswer
          : copy.captureDrawerMessages.useRememberedValue}
      </h3>
      {capture.mapping && (
        <fieldset className="space-y-2">
          <legend className="sr-only">{copy.captureDrawer.action}</legend>
          {(
            [
              ...(!capture.mapping || capture.mapping.status === "retired"
                ? [["create_answer_and_map", "New answer"]]
                : []),
              ...(capture.mapping ? [["update_answer", "Update saved value"]] : []),
              ...(capture.mapping ? [["retarget_mapping", "Use another answer"]] : []),
              ...(capture.mapping && choiceQuestion
                ? [["replace_option_bindings", "Change choice matches"]]
                : []),
            ] as [Action, string][]
          ).map(([value, text]) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-3 py-1 text-sm text-ink"
            >
              <input
                type="radio"
                name="capture-action"
                checked={action === value}
                onChange={() => {
                  setAction(value);
                  setReviewedContext(null);
                  if (value === "update_answer" || value === "replace_option_bindings") {
                    setAnswerId(capture.answer?.id ?? "");
                    setBindings(
                      Object.fromEntries(
                        (capture.mapping?.bindings ?? []).map((binding) => [
                          binding.question_option_id,
                          binding.answer_choice_id,
                        ]),
                      ),
                    );
                  }
                }}
              />
              <span>{text}</span>
            </label>
          ))}
        </fieldset>
      )}
      {action === "create_answer_and_map" ? (
        <CaptureNewAnswerFields
          label={label}
          setLabel={setLabel}
          stableKey={stableKey}
          setKey={setKey}
          description={description}
          setDescription={setDescription}
          fillPolicy={fillPolicy}
          setFillPolicy={setFillPolicy}
          setReviewedContext={setReviewedContext}
          question={question}
        />
      ) : action === "retarget_mapping" ? (
        <AnswerPicker
          questionId={question.id}
          questionRevision={question.revision}
          value={answerId}
          selected={selectedAnswer.data}
          loading={selectedAnswer.isLoading}
          error={selectedAnswer.isError}
          onRetry={() => void selectedAnswer.refetch()}
          onChange={(id) => {
            setAnswerId(id);
            setBindings({});
            setReviewedContext(null);
          }}
        />
      ) : selectedAnswer.isLoading ? (
        <p role="status">{copy.captureDrawer.loadingSavedAnswer}</p>
      ) : selectedAnswer.isError ? (
        <p role="alert">
          {copy.captureDrawer.couldntLoadTheSavedAnswer}{" "}
          <button type="button" className="underline" onClick={() => void selectedAnswer.refetch()}>
            {copy.captureDrawer.retry}
          </button>
        </p>
      ) : (
        selectedAnswer.data && (
          <div className="rounded border border-line bg-surface p-4">
            <p className="text-xs text-ink-muted">{selectedAnswer.data.label}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-lg">
              {valueText(selectedAnswer.data.value, selectedAnswer.data.choices)}
            </p>
            <p className="mt-2 text-xs text-ink-muted">
              {selectedAnswer.data.status === "disabled"
                ? copy.captureDrawerMessages.paused
                : POLICY_LABEL[selectedAnswer.data.fill_policy]}{" "}
              · {selectedAnswer.data.mappings.length}{" "}
              {selectedAnswer.data.mappings.length === 1
                ? copy.captureDrawerMessages.question
                : copy.captureDrawerMessages.questions}
            </p>
          </div>
        )
      )}
      {!capture.mapping && (
        <div>
          <button
            type="button"
            onClick={() => onOpenQuestion(capture.question_id)}
            className="font-medium text-accent"
          >
            {copy.captureDrawer.useASavedAnswer}
          </button>
        </div>
      )}
      {choiceQuestion && action && action !== "create_answer_and_map" && selectedAnswer.data && (
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
    </section>
  );
}
