import { QuestionDrawerFooter } from "./QuestionDrawerFooter";
import { QuestionManagementPanels } from "./QuestionManagementPanels";
import { QuestionMatchPanel } from "./QuestionMatchPanel";
import { QuestionRememberedValues } from "./QuestionRememberedValues";
import { copy } from "./copy";
import { RevisionConflictPanel } from "./RevisionConflictPanel";
import { Drawer } from "./Drawer";
import { type QuestionDetail } from "./model";
import { KnowledgeHistory } from "./KnowledgeHistory";
import { useQuestionDraft } from "./useQuestionDraft";
import { useQuestionActions } from "./useQuestionActions";

interface Props {
  questionId: string;
  onClose: () => void;
  onCreateAnswer: (question: QuestionDetail) => void;
  onOpenCapture?: (id: string) => void;
  onNext?: () => void;
}

export function QuestionDrawer({
  questionId,
  onClose,
  onCreateAnswer,
  onOpenCapture,
  onNext,
}: Props) {
  const state = useQuestionDraft(questionId);
  const {
    query,
    question,
    answerId,
    setAnswerId,
    bindings,
    setBindings,
    baseline,
    setBaseline,
    winnerId,
    setWinnerId,
    setReviewedContext,
    initialized,
    selectedAnswer,
    currentAnswer,
    captures,
    rememberedCapture,
    choiceQuestion,
    complete,
    draft,
    canReview,
    reviewContext,
    reviewed,
    reviewRef,
  } = state;
  const {
    putMapping,
    updateMapping,
    updateQuestion,
    resolveConflict,
    announcement,
    busy,
    conflictError,
    saveMapping,
    changeMapping,
    changeReview,
    chooseWinner,
  } = useQuestionActions({ questionId, state, onClose, onNext });

  return (
    <Drawer
      label={copy.questionDrawer.reviewQuestion}
      title={
        question && (
          <h2 className="text-lg font-semibold leading-7 text-ink">{question.raw_question}</h2>
        )
      }
      onClose={onClose}
      dirty={initialized && (draft !== baseline || !!winnerId)}
      busy={busy}
      footer={
        question && !question.capture_conflict ? (
          <QuestionDrawerFooter
            rememberedCapture={rememberedCapture}
            answerId={answerId}
            draft={draft}
            baseline={baseline}
            reviewed={reviewed}
            canReview={canReview}
            setReviewedContext={setReviewedContext}
            reviewContext={reviewContext}
            complete={complete}
            busy={busy}
            saveMapping={saveMapping}
            onOpenCapture={onOpenCapture}
            onNext={onNext}
          />
        ) : undefined
      }
    >
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {query.isLoading ? (
        <p role="status">{copy.questionDrawer.loadingQuestion}</p>
      ) : query.isError || !question ? (
        <p role="alert">
          {copy.questionDrawer.couldntLoadThisQuestion}{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            {copy.questionDrawer.retry}
          </button>
        </p>
      ) : (
        <>
          {question.review_state === "ignored" && (
            <div className="space-y-2 rounded-md border border-line bg-sunken p-3">
              <p className="text-sm text-ink-muted">
                {copy.questionDrawer.thisQuestionIsDismissedAndWillNotFill}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void changeReview("open")}
                className="text-sm font-medium text-accent"
              >
                {copy.questionDrawer.reopenQuestion}
              </button>
            </div>
          )}
          {!!captures.length && (
            <QuestionRememberedValues
              captures={captures}
              winnerId={winnerId}
              setWinnerId={setWinnerId}
              busy={busy}
              chooseWinner={chooseWinner}
              question={question}
              onOpenCapture={onOpenCapture}
            />
          )}
          {!question.capture_conflict && (
            <QuestionMatchPanel
              answerId={answerId}
              selectedAnswer={selectedAnswer}
              choiceQuestion={choiceQuestion}
              bindings={bindings}
              setBindings={setBindings}
              setAnswerId={setAnswerId}
              setReviewedContext={setReviewedContext}
              reviewed={reviewed}
              reviewRef={reviewRef}
              currentAnswer={currentAnswer}
              captures={captures}
              question={question}
              onCreateAnswer={onCreateAnswer}
            />
          )}
          <QuestionManagementPanels
            captures={captures}
            busy={busy}
            changeMapping={changeMapping}
            changeReview={changeReview}
            question={question}
          />
          <RevisionConflictPanel
            error={conflictError}
            draft={draft}
            onReviewCurrent={async () => {
              await Promise.all([
                query.refetch(),
                selectedAnswer.refetch(),
                currentAnswer.refetch(),
              ]);
              setReviewedContext(null);
              putMapping.reset();
              updateMapping.reset();
              updateQuestion.reset();
              resolveConflict.reset();
            }}
            onDiscard={() => {
              const id = question.answer?.id ?? "";
              const next = Object.fromEntries(
                (question.mapping?.bindings ?? []).map((binding) => [
                  binding.question_option_id,
                  binding.answer_choice_id,
                ]),
              );
              setAnswerId(id);
              setBindings(next);
              setBaseline(JSON.stringify({ answerId: id, bindings: next }));
              setWinnerId("");
              setReviewedContext(null);
              putMapping.reset();
              updateMapping.reset();
              updateQuestion.reset();
              resolveConflict.reset();
            }}
          />
          <KnowledgeHistory events={question.events ?? []} />
        </>
      )}
    </Drawer>
  );
}
