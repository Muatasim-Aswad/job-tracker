import { questionReviewContext } from "./questionReview";
import { copy } from "./copy";
import { usePrivateAnswers } from "./usePrivateAnswers";
import { useEffect, useRef, useState } from "react";
import { RevisionConflictPanel } from "./RevisionConflictPanel";
import {
  useFormFillAnswer,
  useFormFillConflictCaptures,
  useFormFillQuestion,
  usePutFormFillMapping,
  useRemoveFormFillDetail,
  useResolveFormFillCaptureConflict,
  useUpdateFormFillMapping,
  useUpdateFormFillQuestion,
} from "./queries";
import { toast } from "../../shared/toast";
import { Drawer } from "./Drawer";
import { bindingsComplete, suggestBindings } from "./bindings";
import { OptionBindingEditor } from "./OptionBindingEditor";
import { formatDate, siteLabel, valueText, type QuestionDetail } from "./model";
import { CONTROL_LABEL, fillExplanation, SOURCE_LABEL } from "./copy";
import { AnswerPicker } from "./AnswerPicker";
import { ChangeReview } from "./ChangeReview";
import { KnowledgeHistory } from "./KnowledgeHistory";
import { HelpTip } from "./HelpTip";

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
  const query = useFormFillQuestion(questionId);
  const putMapping = usePutFormFillMapping();
  const updateMapping = useUpdateFormFillMapping();
  const updateQuestion = useUpdateFormFillQuestion();
  const resolveConflict = useResolveFormFillCaptureConflict();
  const removeDetail = useRemoveFormFillDetail();
  const [answerId, setAnswerId] = useState("");
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState("");
  const [winnerId, setWinnerId] = useState("");
  const [reviewedContext, setReviewedContext] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const reviewRef = useRef<HTMLElement>(null);
  const retainedCaptureIds = useRef<string[]>([]);
  const question = query.data;
  const selectedAnswer = useFormFillAnswer(answerId || null);
  const currentAnswer = useFormFillAnswer(question?.answer?.id ?? null);
  const captureIds = question?.current_captures?.map((capture) => capture.id) ?? [];
  retainedCaptureIds.current = captureIds;
  const captures = useFormFillConflictCaptures(captureIds);
  const rememberedCapture = captures.length === 1 ? captures[0].data : undefined;
  const choiceQuestion =
    !!question &&
    ["radio", "select", "checkbox_group", "multi_select"].includes(question.control_kind);
  const complete =
    !choiceQuestion ||
    (!!selectedAnswer.data &&
      bindingsComplete(question?.options ?? [], selectedAnswer.data.choices, bindings));
  const draft = JSON.stringify({ answerId, bindings });
  const busy =
    putMapping.isPending ||
    updateMapping.isPending ||
    updateQuestion.isPending ||
    resolveConflict.isPending;

  const canReview =
    !!question &&
    !query.isError &&
    !!selectedAnswer.data &&
    !selectedAnswer.isError &&
    complete &&
    captures.every((capture) => !!capture.data && !capture.isError) &&
    (question.current_captures ?? []).every((summary) =>
      captures.some(
        (capture) => capture.data?.id === summary.id && capture.data.revision >= summary.revision,
      ),
    ) &&
    !question.capture_conflict &&
    (!question.answer ||
      (!!currentAnswer.data &&
        !currentAnswer.isError &&
        currentAnswer.data.revision >= question.answer.revision));
  const reviewContext = questionReviewContext({
    draft,
    question,
    selectedAnswer: selectedAnswer.data,
    currentAnswer: currentAnswer.data,
    captures,
  });

  const reviewed = canReview && reviewedContext === reviewContext;
  useEffect(() => {
    if (reviewed) reviewRef.current?.scrollIntoView?.({ block: "start" });
  }, [reviewed]);

  useEffect(() => {
    if (!question || initialized) return;
    const nextAnswerId = question.answer?.id ?? "";
    const nextBindings = Object.fromEntries(
      (question.mapping?.bindings ?? []).map((binding) => [
        binding.question_option_id,
        binding.answer_choice_id,
      ]),
    );
    setAnswerId(nextAnswerId);
    setBindings(nextBindings);
    setBaseline(JSON.stringify({ answerId: nextAnswerId, bindings: nextBindings }));
    setInitialized(true);
  }, [question, initialized]);
  usePrivateAnswers(answerId, question?.answer?.id);

  useEffect(
    () => () => {
      removeDetail("question", questionId);
      for (const id of retainedCaptureIds.current) removeDetail("capture", id);
    },
    [removeDetail, questionId],
  );
  useEffect(() => {
    if (!selectedAnswer.data || !question || !choiceQuestion) return;
    setBindings((current) =>
      suggestBindings(question.options, selectedAnswer.data!.choices, current),
    );
  }, [answerId, selectedAnswer.data, question, choiceQuestion]);

  async function saveMapping(advance = false) {
    if (!question || !selectedAnswer.data || !complete || !reviewed) return;
    try {
      await putMapping.mutateAsync({
        questionId,
        body: {
          answer_id: selectedAnswer.data.id,
          expected_answer_revision: selectedAnswer.data.revision,
          expected_mapping_revision: question.mapping?.revision ?? null,
          expected_question_revision: question.revision,
          bindings: choiceQuestion
            ? question.options
                .filter((option) => option.status === "active")
                .map((option) => ({
                  question_option_id: option.id,
                  answer_choice_id: bindings[option.id],
                }))
            : [],
        },
      });
      setBaseline(draft);
      setReviewedContext(null);
      setAnnouncement(copy.questionDrawerMessages.answerMatchedToQuestion);
      toast.info(copy.questionDrawerMessages.answerMatchedToQuestion);
      if (advance && onNext) onNext();
      else onClose();
    } catch {
      setAnnouncement(copy.questionDrawerMessages.theMatchWasNotSaved);
      setReviewedContext(null);
    }
  }
  async function changeMapping(status: "active" | "disabled" | "retired") {
    if (!question?.mapping) return;
    try {
      await updateMapping.mutateAsync({
        questionId,
        body: {
          expected_question_revision: question.revision,
          expected_revision: question.mapping.revision,
          status,
        },
      });
      toast.info(copy.questionDrawerMessages.fillBehaviorSaved);
      onClose();
    } catch {
      setAnnouncement(copy.questionDrawerMessages.theFillBehaviorWasNotChanged);
    }
  }
  async function changeReview(review_state: "open" | "ignored") {
    if (!question) return;
    try {
      await updateQuestion.mutateAsync({
        questionId,
        body: { expected_revision: question.revision, review_state },
      });
      setAnnouncement(
        review_state === "ignored"
          ? copy.questionDrawerMessages.questionDismissed
          : copy.questionDrawerMessages.questionReopened,
      );
      toast.info(
        review_state === "ignored"
          ? copy.questionDrawerMessages.questionDismissed
          : copy.questionDrawerMessages.questionReopened,
      );
      onClose();
    } catch {
      setAnnouncement(copy.questionDrawerMessages.theQuestionWasNotChanged);
    }
  }
  async function chooseWinner() {
    if (!question || !winnerId || captures.some((capture) => !capture.data || capture.isError))
      return;
    try {
      await resolveConflict.mutateAsync({
        questionId,
        body: {
          expected_question_revision: question.revision,
          winner_capture_id: winnerId,
          captures: captures.map((capture) => ({
            capture_id: capture.data!.id,
            expected_revision: capture.data!.revision,
          })),
        },
      });
      setWinnerId("");
      toast.info(copy.questionDrawerMessages.rememberedValueSelected);
    } catch {
      setAnnouncement(copy.questionDrawerMessages.theConflictWasNotResolved);
    }
  }
  const conflictError =
    putMapping.error ?? updateMapping.error ?? updateQuestion.error ?? resolveConflict.error;
  const before = currentAnswer.data
    ? `${currentAnswer.data.label}: ${valueText(currentAnswer.data.value, currentAnswer.data.choices)}`
    : "No saved answer matched";

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
          rememberedCapture && onOpenCapture && (!answerId || draft === baseline) && !reviewed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenCapture(rememberedCapture.id)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
            >
              {copy.questionDrawer.reviewRememberedValue}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-3">
                {!reviewed ? (
                  <HelpTip
                    text={copy.questionDrawer.checkTheAnswerValueAndFillBehaviorBeforeSaving}
                  >
                    <button
                      type="button"
                      disabled={!canReview || busy}
                      onClick={() => setReviewedContext(reviewContext)}
                      className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
                    >
                      {copy.questionDrawer.reviewMatch}
                    </button>
                  </HelpTip>
                ) : (
                  <>
                    <HelpTip
                      text={copy.questionDrawer.checkTheAnswerValueAndFillBehaviorBeforeSaving}
                    >
                      <button
                        type="button"
                        disabled={!canReview || busy}
                        onClick={() => void saveMapping()}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
                      >
                        {busy
                          ? copy.questionDrawerMessages.saving
                          : copy.questionDrawerMessages.saveMatch}
                      </button>
                    </HelpTip>
                    {onNext && (
                      <HelpTip text={copy.questionDrawer.saveThisMatchThenOpenTheNextQuestion}>
                        <button
                          type="button"
                          disabled={!canReview || busy}
                          onClick={() => void saveMapping(true)}
                          className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent disabled:opacity-50"
                        >
                          {copy.questionDrawer.saveAndReviewNext}
                        </button>
                      </HelpTip>
                    )}
                  </>
                )}
              </div>
              {answerId && !complete && (
                <p className="text-xs text-ink-muted">
                  {copy.questionDrawer.matchEveryFormChoiceBeforeSaving}
                </p>
              )}
            </div>
          )
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
            <section
              className={`space-y-3 ${question.capture_conflict ? "rounded-lg border border-red-400 bg-red-50 p-4 dark:bg-red-950/20" : ""}`}
              aria-label={copy.questionDrawer.rememberedValues}
            >
              <h3
                className={
                  question.capture_conflict
                    ? "font-medium text-ink"
                    : "text-xs font-normal text-ink-muted"
                }
              >
                {question.capture_conflict
                  ? copy.questionDrawerMessages.chooseWhichRememberedValueToKeep
                  : copy.questionDrawerMessages.rememberedValue}
              </h3>
              {question.capture_conflict && (
                <p className="text-sm text-ink-muted">
                  {copy.questionDrawer.conflictingValuesBlockFillingKeepingOneClearsTheOther}
                </p>
              )}
              {captures.some((capture) => capture.isLoading) ? (
                <p role="status">{copy.questionDrawer.loadingRememberedValues}</p>
              ) : captures.some((capture) => capture.isError) ? (
                <p role="alert">
                  {copy.questionDrawer.couldntLoadEveryRememberedValue}{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      for (const capture of captures) void capture.refetch();
                    }}
                  >
                    {copy.questionDrawer.retry}
                  </button>
                </p>
              ) : (
                captures.map(
                  (capture) =>
                    capture.data && (
                      <div key={capture.data.id} className="space-y-2">
                        <label className="flex items-start gap-3">
                          {question.capture_conflict && (
                            <input
                              type="radio"
                              name="capture-winner"
                              checked={winnerId === capture.data.id}
                              onChange={() => setWinnerId(capture.data!.id)}
                            />
                          )}
                          <span>
                            <span className="block whitespace-pre-wrap break-words text-lg font-normal text-ink">
                              {valueText(capture.data.value, question.options)}
                            </span>
                            {question.capture_conflict && (
                              <span className="mt-1 block text-xs text-ink-muted">
                                {SOURCE_LABEL[capture.data.source]} •{" "}
                                {formatDate(capture.data.created_at)}
                              </span>
                            )}
                          </span>
                        </label>
                        {!question.capture_conflict && onOpenCapture && captures.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onOpenCapture(capture.data!.id)}
                            className="rounded-md border border-accent px-3 py-2 text-sm font-medium text-accent"
                          >
                            {copy.questionDrawer.useOrDismissThisValue}
                          </button>
                        )}
                      </div>
                    ),
                )
              )}
              {question.capture_conflict && (
                <button
                  type="button"
                  disabled={
                    !winnerId ||
                    busy ||
                    captures.some((capture) => !capture.data || capture.isError)
                  }
                  onClick={() => void chooseWinner()}
                  className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
                >
                  {copy.questionDrawer.keepSelectedValue}
                </button>
              )}
            </section>
          )}
          {!question.capture_conflict && (
            <section
              className="space-y-4"
              aria-label={copy.questionDrawer.savedAnswerForThisQuestion}
            >
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
          )}
          <details className="border-t border-line pt-3 text-sm text-ink-muted">
            <summary className="cursor-pointer font-medium">
              {copy.questionDrawer.manageQuestion}
              {question.mapping?.status === "active"
                ? copy.questionDrawerMessages.matched
                : question.mapping?.status === "disabled"
                  ? copy.questionDrawerMessages.fillingPaused
                  : ""}
            </summary>
            <div className="mt-3 flex flex-wrap gap-3">
              {question.mapping && !question.capture_conflict && (
                <>
                  <HelpTip text={copy.questionDrawer.pausingStopsFillingAndKeepsTheMatch}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void changeMapping(
                          question.mapping!.status === "active" ? "disabled" : "active",
                        )
                      }
                      className="rounded border border-line px-3 py-2"
                    >
                      {question.mapping.status === "active"
                        ? copy.questionDrawerMessages.pauseFilling
                        : copy.questionDrawerMessages.resumeFilling}
                    </button>
                  </HelpTip>
                  {question.mapping.status !== "retired" && (
                    <HelpTip
                      text={copy.questionDrawer.removeThisMatchYouCanChooseAnotherSavedAnswer}
                    >
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void changeMapping("retired")}
                        className="rounded border border-line px-3 py-2"
                      >
                        {copy.questionDrawer.removeMatch}
                      </button>
                    </HelpTip>
                  )}
                </>
              )}
              {question.review_state === "open" && question.mapping?.status !== "active" && (
                <HelpTip
                  text={copy.questionDrawer.dismissThisQuestionAndClearItsCurrentRememberedValues}
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void changeReview("ignored")}
                    className="rounded border border-line px-3 py-2"
                  >
                    {copy.questionDrawer.dismissQuestion}
                  </button>
                </HelpTip>
              )}
            </div>
          </details>
          <details className="border-t border-line pt-3 text-sm text-ink-muted">
            <summary className="cursor-pointer font-medium">
              {copy.questionDrawer.questionDetails}
            </summary>
            {question.raw_help && (
              <p className="mt-3 max-w-prose text-xs leading-5">{question.raw_help}</p>
            )}
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs">{copy.questionDrawer.section}</dt>
                <dd className="mt-1 text-ink">{question.raw_section || "Application form"}</dd>
              </div>
              <div>
                <dt className="text-xs">{copy.questionDrawer.fieldType}</dt>
                <dd className="mt-1 text-ink">
                  {CONTROL_LABEL[question.control_kind]}
                  {question.option_count ? ` · ${question.option_count} choices` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs">{copy.questionDrawer.source}</dt>
                <dd className="mt-1 text-ink">{siteLabel(question.site_scope)}</dd>
              </div>
              <div>
                <dt className="text-xs">{copy.questionDrawer.seen}</dt>
                <dd className="mt-1 text-ink">
                  {question.seen_count}{" "}
                  {question.seen_count === 1
                    ? copy.questionDrawerMessages.time
                    : copy.questionDrawerMessages.times}
                </dd>
              </div>
            </dl>
            {captures
              .filter((capture) => capture.data)
              .map((capture) => (
                <p key={capture.data!.id} className="mt-3 text-xs">
                  {SOURCE_LABEL[capture.data!.source]} · {formatDate(capture.data!.created_at)}
                </p>
              ))}
          </details>
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
