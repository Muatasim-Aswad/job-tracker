import { captureReviewContext } from "./captureReview";
import { copy } from "./copy";
import { usePrivateAnswers } from "./usePrivateAnswers";
import { captureApplyRequest, captureValueForAnswer } from "./captureDraft";
import { useEffect, useRef, useState } from "react";
import type { CaptureApply } from "./client";
import { RevisionConflictPanel } from "./RevisionConflictPanel";
import {
  useApplyFormFillCapture,
  useFormFillAnswer,
  useFormFillCapture,
  useFormFillQuestion,
  useRemoveFormFillDetail,
  useUpdateFormFillCapture,
} from "./queries";
import { toast } from "../../shared/toast";
import { Drawer } from "./Drawer";
import { bindingsComplete, suggestBindings } from "./bindings";
import { OptionBindingEditor } from "./OptionBindingEditor";
import { answerKey, siteLabel, isChoiceKind, valueText } from "./model";
import { fillExplanation, POLICY_LABEL, SOURCE_LABEL, VALUE_KIND_LABEL } from "./copy";

import { AnswerPicker } from "./AnswerPicker";
import { ChangeReview } from "./ChangeReview";
import { KnowledgeHistory } from "./KnowledgeHistory";
import { choicePairsForQuestion, valueKindForQuestion } from "./answerDraft";
import { HelpTip } from "./HelpTip";

type Action = CaptureApply["action"];

interface Props {
  captureId: string;
  onClose: () => void;
  onOpenQuestion: (questionId: string) => void;
  onNext?: () => void;
}

export function CaptureDrawer({ captureId, onClose, onOpenQuestion, onNext }: Props) {
  const query = useFormFillCapture(captureId);
  const questionQuery = useFormFillQuestion(query.data?.question_id ?? null);
  const updateCapture = useUpdateFormFillCapture();
  const applyCapture = useApplyFormFillCapture();
  const removeDetail = useRemoveFormFillDetail();
  const [action, setAction] = useState<Action | "">("");
  const [answerId, setAnswerId] = useState("");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [fillPolicy, setFillPolicy] = useState<"auto" | "confirm_each_time" | "never">("auto");
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [reviewedContext, setReviewedContext] = useState<string | null>(null);
  const [baseline, setBaseline] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const reviewRef = useRef<HTMLElement>(null);
  const capture = query.data;
  const question = questionQuery.data;
  const selectedAnswer = useFormFillAnswer(answerId || null);
  const currentAnswer = useFormFillAnswer(capture?.answer?.id ?? null);
  const choiceQuestion = !!capture && isChoiceKind(capture.value_kind);

  useEffect(() => {
    if (!capture || initialized) return;
    const nextLabel = capture.question.raw_question.slice(0, 120);
    setLabel(nextLabel);
    setKey(answerKey(nextLabel));
    setAnswerId(capture.answer?.id ?? "");
    setBindings(
      Object.fromEntries(
        (capture.mapping?.bindings ?? []).map((binding) => [
          binding.question_option_id,
          binding.answer_choice_id,
        ]),
      ),
    );
    const initialAction =
      !capture.mapping || capture.mapping.status === "retired"
        ? "create_answer_and_map"
        : "update_answer";
    setAction(initialAction);
    setBaseline(
      JSON.stringify({
        action: initialAction,
        answerId: capture.answer?.id ?? "",
        label: nextLabel,
        key: answerKey(nextLabel),
        description: "",
        fillPolicy: "auto",
        bindings: Object.fromEntries(
          (capture.mapping?.bindings ?? []).map((binding) => [
            binding.question_option_id,
            binding.answer_choice_id,
          ]),
        ),
      }),
    );
    setInitialized(true);
  }, [capture, initialized]);

  const clearAnswers = usePrivateAnswers(answerId, capture?.answer?.id);

  function close() {
    removeDetail("capture", captureId);
    if (capture) removeDetail("question", capture.question_id);
    clearAnswers();
    onClose();
  }

  const pairs = question ? choicePairsForQuestion(question) : [];
  const newChoices = pairs.map(({ option, choiceKey }) => ({
    choice_key: choiceKey,
    display_label: option.raw_label,
    status: "active" as const,
  }));

  const draft = JSON.stringify({ action, answerId, label, key, description, fillPolicy, bindings });
  const captureSummary = question?.current_captures?.find((item) => item.id === capture?.id);
  const coherentContext =
    !!capture &&
    !!question &&
    !query.isError &&
    !questionQuery.isError &&
    capture.id === captureId &&
    question.id === capture.question_id &&
    capture.question.id === question.id &&
    capture.question.revision === question.revision &&
    (capture.mapping?.id ?? null) === (question.mapping?.id ?? null) &&
    (capture.mapping?.revision ?? null) === (question.mapping?.revision ?? null) &&
    (capture.answer?.id ?? null) === (question.answer?.id ?? null) &&
    !!captureSummary &&
    capture.revision >= captureSummary.revision;

  const completeBindings =
    !choiceQuestion ||
    (action === "create_answer_and_map"
      ? question?.options
          .filter((option) => option.status === "active")
          .every((option) => !!answerKey(option.raw_label))
      : !!question &&
        !!selectedAnswer.data &&
        bindingsComplete(question.options, selectedAnswer.data.choices, bindings));
  const actionValid =
    coherentContext &&
    !!capture?.value &&
    capture.status === "current" &&
    !capture.question.capture_conflict &&
    !!question &&
    !question.capture_conflict &&
    (!capture.answer ||
      (!!currentAnswer.data &&
        !currentAnswer.isError &&
        currentAnswer.data.id === capture.answer.id &&
        currentAnswer.data.revision >=
          Math.max(capture.answer.revision, question.answer?.revision ?? 0))) &&
    !!action &&
    completeBindings &&
    (action === "create_answer_and_map"
      ? !!label.trim() && !!key.trim()
      : !!selectedAnswer.data && !selectedAnswer.isError) &&
    (action === "retarget_mapping" || action === "replace_option_bindings"
      ? !!capture.mapping
      : true);

  const reviewContext = captureReviewContext({
    draft,
    capture,
    question,
    selectedAnswer: selectedAnswer.data,
    currentAnswer: currentAnswer.data,
  });

  const reviewed = !!actionValid && reviewedContext === reviewContext;
  useEffect(() => {
    if (reviewed) reviewRef.current?.scrollIntoView?.({ block: "start" });
  }, [reviewed]);

  async function apply(advance = false) {
    if (!capture || !question || !actionValid || !reviewed) return;
    const body = captureApplyRequest({
      capture,
      question,
      answer: selectedAnswer.data,
      action: action as Action,
      pairs,
      bindings,
      label,
      key,
      description,
      fillPolicy,
      choiceQuestion,
      newChoices,
    });
    try {
      await applyCapture.mutateAsync({ captureId, body });
      setAnnouncement(copy.captureDrawerMessages.rememberedValueAppliedToVerifiedKnowledge);
      toast.info(copy.captureDrawerMessages.rememberedValueApplied);
      if (advance && onNext) onNext();
      else close();
    } catch {
      setAnnouncement(copy.captureDrawerMessages.theRememberedValueWasNotApplied);
      setReviewedContext(null);
    }
  }

  async function changeStatus(status: "current" | "ignored") {
    if (!capture) return;
    try {
      await updateCapture.mutateAsync({
        captureId,
        body: { expected_revision: capture.revision, status },
      });
      setAnnouncement(
        status === "ignored"
          ? copy.captureDrawerMessages.rememberedValueIgnored
          : copy.captureDrawerMessages.rememberedValueReopened,
      );
      toast.info(
        status === "ignored"
          ? copy.captureDrawerMessages.rememberedValueDismissedAndCleared
          : copy.captureDrawerMessages.rememberedValueReopened,
      );
      if (status === "ignored") close();
    } catch {
      setAnnouncement(copy.captureDrawerMessages.theRememberedValueWasNotChanged);
    }
  }

  const busy = applyCapture.isPending || updateCapture.isPending;
  const retainedQuestionId = useRef<string | null>(null);
  retainedQuestionId.current = capture?.question_id ?? null;
  useEffect(
    () => () => {
      removeDetail("capture", captureId);
      if (retainedQuestionId.current) removeDetail("question", retainedQuestionId.current);
    },
    [removeDetail, captureId],
  );
  useEffect(() => {
    if (!question || !selectedAnswer.data || !choiceQuestion) return;
    setBindings((current) =>
      suggestBindings(question.options, selectedAnswer.data!.choices, current),
    );
  }, [question, selectedAnswer.data, choiceQuestion]);
  const before = currentAnswer.data
    ? `${currentAnswer.data.label}: ${valueText(currentAnswer.data.value, currentAnswer.data.choices)}`
    : "No saved answer for this question";
  const afterValue =
    action === "retarget_mapping" || action === "replace_option_bindings"
      ? selectedAnswer.data?.value
      : captureValueForAnswer({ capture, answer: selectedAnswer.data, action, pairs, bindings });
  const afterLabels =
    action === "create_answer_and_map" ? newChoices : (selectedAnswer.data?.choices ?? []);
  const behavior =
    question?.review_state === "ignored"
      ? "This question is dismissed. Reopen it before filling."
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
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              {!reviewed ? (
                <HelpTip text={copy.captureDrawer.checkTheValueAndAffectedQuestionsBeforeSaving}>
                  <button
                    type="button"
                    disabled={!actionValid || busy}
                    onClick={() => setReviewedContext(reviewContext)}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
                  >
                    {copy.captureDrawer.reviewChanges}
                  </button>
                </HelpTip>
              ) : (
                <>
                  <HelpTip text={copy.captureDrawer.checkTheValueAndAffectedQuestionsBeforeSaving}>
                    <button
                      type="button"
                      disabled={!actionValid || busy}
                      onClick={() => void apply()}
                      className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
                    >
                      {busy
                        ? copy.captureDrawerMessages.saving
                        : copy.captureDrawerMessages.saveChanges}
                    </button>
                  </HelpTip>
                  {onNext && (
                    <HelpTip text={copy.captureDrawer.saveTheseChangesThenOpenTheNextQuestion}>
                      <button
                        type="button"
                        disabled={!actionValid || busy}
                        onClick={() => void apply(true)}
                        className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent disabled:opacity-50"
                      >
                        {copy.captureDrawer.saveAndReviewNext}
                      </button>
                    </HelpTip>
                  )}
                </>
              )}
            </div>
            {!actionValid && (
              <p className="text-xs text-ink-muted">
                {copy.captureDrawer.chooseAnActionAndCompleteAnyMissingChoiceMatches}
              </p>
            )}
          </div>
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
          <section className="space-y-3">
            <button
              type="button"
              onClick={() => onOpenQuestion(capture.question_id)}
              className="text-sm font-medium text-accent"
            >
              {copy.captureDrawer.backToQuestion}
            </button>
            {questionQuery.isLoading ? (
              <p role="status">{copy.captureDrawer.loadingQuestionAndChoices}</p>
            ) : questionQuery.isError ? (
              <p role="alert">
                {copy.captureDrawer.couldntLoadTheFormChoices}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void questionQuery.refetch()}
                >
                  {copy.captureDrawer.retry}
                </button>
              </p>
            ) : (
              <div>
                <p className="text-xs text-ink-muted">{copy.captureDrawer.rememberedValue}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-lg font-normal text-ink">
                  {valueText(capture.value, question?.options)}
                </p>
              </div>
            )}
            {capture.status !== "current" && (
              <p className="rounded border border-line bg-sunken p-3 text-sm">
                {copy.captureDrawer.thisValueHasBeenClearedOpenTheQuestionReopen}
              </p>
            )}
          </section>
          {capture.status === "current" &&
            question &&
            !capture.question.capture_conflict &&
            reviewed && (
              <ChangeReview
                ref={reviewRef}
                before={before}
                after={`${action === "create_answer_and_map" ? label : (selectedAnswer.data?.label ?? "")}: ${valueText(afterValue, afterLabels)}`}
                behavior={behavior}
                affected={affected}
              >
                {capture.mapping &&
                  capture.mapping.status !== "active" &&
                  action !== "update_answer" && (
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
                          ? newChoices.find((choice) => choice.choice_key === choiceKey)
                              ?.display_label
                          : selectedAnswer.data?.choices.find(
                              (choice) => choice.id === bindings[option.id],
                            )?.display_label}
                      </li>
                    ))}
                  </ul>
                )}
              </ChangeReview>
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
                  <div className="space-y-4">
                    <details className="border-t border-line pt-3 text-sm text-ink-muted">
                      <summary className="cursor-pointer font-medium">
                        {copy.captureDrawer.answerDetails}
                      </summary>
                      <div className="mt-3 space-y-3">
                        <dl>
                          <dt className="text-xs text-ink-muted">{copy.captureDrawer.valueType}</dt>
                          <dd className="mt-1 text-sm text-ink">
                            {VALUE_KIND_LABEL[valueKindForQuestion(question.control_kind)]}
                          </dd>
                        </dl>
                        <label className="block flex-1 text-xs font-normal text-ink-muted">
                          {copy.captureDrawer.fillBehavior}
                          <HelpTip text={fillExplanation(fillPolicy)} className="block">
                            <select
                              value={fillPolicy}
                              onChange={(event) => {
                                setFillPolicy(event.target.value as typeof fillPolicy);
                                setReviewedContext(null);
                              }}
                              className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
                            >
                              <option value="auto">{copy.captureDrawer.automatic}</option>
                              <option value="confirm_each_time">
                                {copy.captureDrawer.askEveryTime}
                              </option>
                              <option value="never">{copy.captureDrawer.neverFill}</option>
                            </select>
                          </HelpTip>
                        </label>
                        <label className="block text-xs font-normal text-ink-muted">
                          {copy.captureDrawer.answerName}
                          <input
                            value={label}
                            onChange={(event) => {
                              const next = event.target.value;
                              setReviewedContext(null);
                              setLabel(next);
                              if (!key || key === answerKey(label)) setKey(answerKey(next));
                            }}
                            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
                          />
                        </label>

                        <label className="block text-xs font-normal text-ink-muted">
                          {copy.captureDrawer.stableKey}
                          <HelpTip
                            text={copy.captureDrawer.generatedFromTheLabelChangeItOnlyToDistinguish}
                            className="block"
                          >
                            <input
                              value={key}
                              onChange={(event) => {
                                setKey(answerKey(event.target.value));
                                setReviewedContext(null);
                              }}
                              className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
                            />
                          </HelpTip>
                        </label>
                        <label className="block text-xs font-normal text-ink-muted">
                          {copy.captureDrawer.description}
                          <textarea
                            value={description}
                            onChange={(event) => {
                              setDescription(event.target.value);
                              setReviewedContext(null);
                            }}
                            rows={2}
                            className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
                          />
                        </label>
                      </div>
                    </details>
                  </div>
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
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void selectedAnswer.refetch()}
                    >
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
                {choiceQuestion &&
                  action &&
                  action !== "create_answer_and_map" &&
                  selectedAnswer.data && (
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
