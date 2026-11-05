import { CaptureDrawerFooter } from "./CaptureDrawerFooter";
import { CaptureActionPanel } from "./CaptureActionPanel";
import { CaptureChangeReview } from "./CaptureChangeReview";
import { CaptureValuePanel } from "./CaptureValuePanel";
import { copy } from "./copy";
import { RevisionConflictPanel } from "./RevisionConflictPanel";
import { Drawer } from "./Drawer";
import { siteLabel } from "./model";
import { SOURCE_LABEL } from "./copy";
import { KnowledgeHistory } from "./KnowledgeHistory";
import { useCaptureDraft } from "./useCaptureDraft";
import { useCaptureActions } from "./useCaptureActions";

interface Props {
  captureId: string;
  onClose: () => void;
  onOpenQuestion: (questionId: string) => void;
  onNext?: () => void;
}

export function CaptureDrawer({ captureId, onClose, onOpenQuestion, onNext }: Props) {
  const state = useCaptureDraft(captureId, onClose);
  const {
    query,
    questionQuery,
    capture,
    question,
    action,
    setAction,
    answerId,
    setAnswerId,
    label,
    setLabel,
    key: stableKey,
    setKey,
    description,
    setDescription,
    fillPolicy,
    setFillPolicy,
    bindings,
    setBindings,
    setReviewedContext,
    baseline,
    initialized,
    setInitialized,
    selectedAnswer,
    currentAnswer,
    choiceQuestion,
    pairs,
    newChoices,
    draft,
    actionValid,
    reviewContext,
    reviewed,
    reviewRef,
    close,
  } = state;
  const { updateCapture, applyCapture, announcement, busy, apply, changeStatus } =
    useCaptureActions({ captureId, state, onNext });

  return (
    <Drawer
      label={copy.captureDrawer.reviewRememberedAnswer}
      title={
        capture && (
          <h2 className="text-lg font-semibold leading-7 text-ink">
            {capture.question.raw_question}
          </h2>
        )
      }
      onClose={close}
      dirty={initialized && draft !== baseline}
      busy={busy}
      footer={
        capture?.status === "current" && !capture.question.capture_conflict ? (
          <CaptureDrawerFooter
            reviewed={reviewed}
            actionValid={actionValid}
            setReviewedContext={setReviewedContext}
            reviewContext={reviewContext}
            busy={busy}
            apply={apply}
            onNext={onNext}
          />
        ) : undefined
      }
    >
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {query.isLoading ? (
        <p role="status">{copy.captureDrawer.loadingRememberedAnswer}</p>
      ) : query.isError || !capture ? (
        <p role="alert">
          {copy.captureDrawer.couldntLoadThisRememberedAnswer}{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            {copy.captureDrawer.retry}
          </button>
        </p>
      ) : (
        <>
          <CaptureValuePanel
            questionQuery={questionQuery}
            question={question}
            capture={capture}
            onOpenQuestion={onOpenQuestion}
          />
          {capture.status === "current" &&
            question &&
            !capture.question.capture_conflict &&
            reviewed && (
              <CaptureChangeReview
                action={action}
                label={label}
                selectedAnswer={selectedAnswer}
                reviewRef={reviewRef}
                choiceQuestion={choiceQuestion}
                pairs={pairs}
                newChoices={newChoices}
                bindings={bindings}
                currentAnswer={currentAnswer}
                fillPolicy={fillPolicy}
                capture={capture}
                question={question}
              />
            )}
          {capture.question.capture_conflict ? (
            <section className="space-y-3 rounded-lg border border-red-400 p-4">
              <p className="font-semibold">
                {copy.captureDrawer.thisQuestionHasConflictingRememberedValues}
              </p>
              <p className="text-sm text-ink-muted">
                {copy.captureDrawer.chooseWhichValueToKeepBeforeSavingAnAnswer}
              </p>
              <button
                type="button"
                onClick={() => onOpenQuestion(capture.question_id)}
                className="text-sm font-medium text-accent"
              >
                {copy.captureDrawer.reviewConflictingValues}
              </button>
            </section>
          ) : (
            capture.status === "current" &&
            question && (
              <CaptureActionPanel
                action={action}
                setAction={setAction}
                answerId={answerId}
                setAnswerId={setAnswerId}
                label={label}
                setLabel={setLabel}
                stableKey={stableKey}
                setKey={setKey}
                description={description}
                setDescription={setDescription}
                fillPolicy={fillPolicy}
                setFillPolicy={setFillPolicy}
                bindings={bindings}
                setBindings={setBindings}
                setReviewedContext={setReviewedContext}
                selectedAnswer={selectedAnswer}
                choiceQuestion={choiceQuestion}
                capture={capture}
                question={question}
                onOpenQuestion={onOpenQuestion}
              />
            )
          )}
          <RevisionConflictPanel
            error={applyCapture.error ?? updateCapture.error}
            draft={draft}
            onReviewCurrent={async () => {
              await Promise.all([
                query.refetch(),
                questionQuery.refetch(),
                selectedAnswer.refetch(),
                currentAnswer.refetch(),
              ]);
              setReviewedContext(null);
              applyCapture.reset();
              updateCapture.reset();
            }}
            onDiscard={() => {
              setInitialized(false);
              setReviewedContext(null);
              setDescription("");
              setFillPolicy("auto");
              applyCapture.reset();
              updateCapture.reset();
            }}
          />
          {capture.status === "current" && (
            <details className="border-t border-line pt-3 text-sm text-ink-muted">
              <summary className="cursor-pointer font-medium">
                {copy.captureDrawer.manageRememberedValue}
              </summary>
              <p className="my-3">
                {copy.captureDrawer.clearingRemovesThisRememberedValueAndStopsItsReuse}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void changeStatus("ignored")}
                className="rounded border border-red-300 px-3 py-2 text-red-700 dark:text-red-300"
              >
                {copy.captureDrawer.dismissAndClearValue}
              </button>
            </details>
          )}
          <details className="border-t border-line pt-3 text-sm text-ink-muted">
            <summary className="cursor-pointer font-medium">
              {copy.captureDrawer.sourceDetails}
            </summary>
            <p className="mt-3">
              {siteLabel(capture.question.site_scope)} · {SOURCE_LABEL[capture.source]}
            </p>
          </details>
          {question?.raw_help && (
            <details className="border-t border-line pt-3 text-sm text-ink-muted">
              <summary className="cursor-pointer font-medium">
                {copy.captureDrawer.questionDetails}
              </summary>
              <p className="mt-3 max-w-prose text-xs leading-5">{question.raw_help}</p>
            </details>
          )}
          <KnowledgeHistory events={capture.events} />
        </>
      )}
    </Drawer>
  );
}
