import { useEffect, useRef, useState } from "react";
import { RevisionConflictPanel } from "../components/RevisionConflictPanel";
import {
  useFormFillAnswer,
  useFormFillConflictCaptures,
  useFormFillQuestion,
  usePutFormFillMapping,
  useRemoveFormFillDetail,
  useResolveFormFillCaptureConflict,
  useUpdateFormFillMapping,
  useUpdateFormFillQuestion,
} from "../hooks";
import { toast } from "../lib/toast";
import { Drawer } from "./Drawer";
import { bindingsComplete, suggestBindings } from "./bindings";
import { OptionBindingEditor } from "./OptionBindingEditor";
import {
  fillExplanation,
  formatDate,
  siteLabel,
  SOURCE_LABEL,
  valueText,
  type QuestionDetail,
} from "./model";
import { AnswerPicker } from "./AnswerPicker";
import { ChangeReview } from "./ChangeReview";
import { KnowledgeHistory } from "./KnowledgeHistory";

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
  const [reviewed, setReviewed] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const openedAnswerIds = useRef(new Set<string>());
  const reviewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (reviewed) reviewRef.current?.scrollIntoView?.({ block: "start" });
  }, [reviewed]);
  const retainedCaptureIds = useRef<string[]>([]);
  const question = query.data;
  const selectedAnswer = useFormFillAnswer(answerId || null);
  const currentAnswer = useFormFillAnswer(question?.answer?.id ?? null);
  const captureIds = question?.current_captures?.map((capture) => capture.id) ?? [];
  retainedCaptureIds.current = captureIds;
  const captures = useFormFillConflictCaptures(captureIds);
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
  useEffect(() => {
    if (answerId) openedAnswerIds.current.add(answerId);
    if (question?.answer?.id) openedAnswerIds.current.add(question.answer.id);
  }, [answerId, question?.answer?.id]);
  useEffect(
    () => () => {
      removeDetail("question", questionId);
      for (const id of retainedCaptureIds.current) removeDetail("capture", id);
      for (const id of openedAnswerIds.current) removeDetail("answer", id);
    },
    [removeDetail, questionId],
  );
  useEffect(() => {
    if (!selectedAnswer.data || !question || !choiceQuestion) return;
    setBindings((current) =>
      suggestBindings(question.options, selectedAnswer.data!.choices, current),
    );
    setReviewed(false);
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
      setReviewed(false);
      setAnnouncement("Answer matched to question.");
      toast.info("Answer matched to question.");
      if (advance) onNext?.();
    } catch {
      setAnnouncement("The match was not saved.");
      setReviewed(false);
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
      toast.info("Fill behavior saved.");
    } catch {
      setAnnouncement("The fill behavior was not changed.");
    }
  }
  async function changeReview(review_state: "open" | "ignored") {
    if (!question) return;
    try {
      await updateQuestion.mutateAsync({
        questionId,
        body: { expected_revision: question.revision, review_state },
      });
      setAnnouncement(review_state === "ignored" ? "Question dismissed." : "Question reopened.");
      toast.info(review_state === "ignored" ? "Question dismissed." : "Question reopened.");
    } catch {
      setAnnouncement("The question was not changed.");
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
      toast.info("Remembered value selected.");
    } catch {
      setAnnouncement("The conflict was not resolved.");
    }
  }
  const conflictError =
    putMapping.error ?? updateMapping.error ?? updateQuestion.error ?? resolveConflict.error;
  const canReview =
    !!selectedAnswer.data &&
    !selectedAnswer.isError &&
    complete &&
    !question?.capture_conflict &&
    (!question?.answer || (!!currentAnswer.data && !currentAnswer.isError));
  const before = currentAnswer.data
    ? `${currentAnswer.data.label}: ${valueText(currentAnswer.data.value, currentAnswer.data.choices)}`
    : "No saved answer matched";

  return (
    <Drawer
      label="Review question"
      onClose={onClose}
      dirty={initialized && (draft !== baseline || !!winnerId)}
      busy={busy}
      footer={
        question && !question.capture_conflict ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              {!reviewed ? (
                <button
                  type="button"
                  disabled={!canReview || busy}
                  onClick={() => setReviewed(true)}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
                >
                  Review match
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!canReview || busy}
                    onClick={() => void saveMapping()}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
                  >
                    {busy ? "Saving…" : "Save match"}
                  </button>
                  {onNext && (
                    <button
                      type="button"
                      disabled={!canReview || busy}
                      onClick={() => void saveMapping(true)}
                      className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent disabled:opacity-50"
                    >
                      Save and review next
                    </button>
                  )}
                </>
              )}
            </div>
            <p className="text-xs text-ink-muted">
              {!answerId
                ? "Choose a saved answer, use a remembered value, or save a new answer."
                : !complete
                  ? "Match every form choice before saving."
                  : "Check the answer value and fill behavior before saving."}
            </p>
          </div>
        ) : undefined
      }
    >
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {query.isLoading ? (
        <p role="status">Loading question…</p>
      ) : query.isError || !question ? (
        <p role="alert">
          Couldn’t load this question.{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="max-w-prose text-xl font-semibold text-ink">{question.raw_question}</h2>
            {question.raw_help && (
              <p className="max-w-prose text-sm text-ink-muted">{question.raw_help}</p>
            )}
            <p className="text-sm text-ink-muted">
              {siteLabel(question.site_scope)} • {question.raw_section || "Application form"} • Seen{" "}
              {question.seen_count} times
            </p>
            {question.review_state === "ignored" || question.mapping?.status !== "active" ? (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void changeReview(question.review_state === "open" ? "ignored" : "open")
                  }
                  className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
                >
                  {question.review_state === "open" ? "Dismiss question" : "Reopen question"}
                </button>
                {question.review_state === "ignored" && (
                  <p className="text-sm text-ink-muted">
                    This question is dismissed and will not fill. Reopen it before matching an
                    answer.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink-muted">This question already uses a saved answer.</p>
            )}
          </section>
          {!!captures.length && (
            <section
              className={`space-y-3 rounded-lg border p-4 ${question.capture_conflict ? "border-red-400 bg-red-50 dark:bg-red-950/20" : "border-line bg-surface"}`}
              aria-label="Remembered values"
            >
              <h3 className="font-semibold text-ink">
                {question.capture_conflict
                  ? "Choose which remembered value to keep"
                  : "Remembered answer"}
              </h3>
              {question.capture_conflict && (
                <p className="text-sm text-ink-muted">
                  Conflicting values block filling. Keeping one clears the other retained values.
                </p>
              )}
              {captures.some((capture) => capture.isLoading) ? (
                <p role="status">Loading remembered values…</p>
              ) : captures.some((capture) => capture.isError) ? (
                <p role="alert">
                  Couldn’t load every remembered value.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      for (const capture of captures) void capture.refetch();
                    }}
                  >
                    Retry
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
                            <span className="block whitespace-pre-wrap break-words text-lg font-medium text-ink">
                              {valueText(capture.data.value, question.options)}
                            </span>
                            <span className="mt-1 block text-xs text-ink-muted">
                              {SOURCE_LABEL[capture.data.source]} •{" "}
                              {formatDate(capture.data.created_at)}
                            </span>
                          </span>
                        </label>
                        {!question.capture_conflict && onOpenCapture && (
                          <button
                            type="button"
                            onClick={() => onOpenCapture(capture.data!.id)}
                            className="rounded-md border border-accent px-3 py-2 text-sm font-medium text-accent"
                          >
                            Use or dismiss this value
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
                  Keep selected value
                </button>
              )}
            </section>
          )}
          {!question.capture_conflict && (
            <section className="space-y-4" aria-label="Saved answer for this question">
              <h3 className="font-semibold text-ink">Choose what should fill this question</h3>
              <AnswerPicker
                control={question.control_kind}
                prompt={question.raw_question}
                value={answerId}
                selected={selectedAnswer.data}
                loading={selectedAnswer.isLoading}
                error={selectedAnswer.isError}
                onRetry={() => void selectedAnswer.refetch()}
                onChange={(id) => {
                  setAnswerId(id);
                  setBindings({});
                  setReviewed(false);
                }}
              />
              <button
                type="button"
                onClick={() => onCreateAnswer(question)}
                className="text-sm font-medium text-accent"
              >
                Save a new answer for this question
              </button>
              {choiceQuestion && selectedAnswer.data && (
                <OptionBindingEditor
                  options={question.options}
                  choices={selectedAnswer.data.choices}
                  value={bindings}
                  onChange={(next) => {
                    setBindings(next);
                    setReviewed(false);
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
                      An identical remembered value is marked reviewed. A differing remembered value
                      stays in the inbox.
                    </p>
                  )}
                </ChangeReview>
              )}
              {question.mapping && (
                <details className="border-t border-line pt-3 text-sm text-ink-muted">
                  <summary className="cursor-pointer">Manage filling for this question</summary>
                  <p className="my-3">
                    Pausing stops filling and keeps the match. Removing the match retires it; a new
                    match can be saved later.
                  </p>
                  <div className="flex gap-2">
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
                      {question.mapping.status === "active" ? "Pause filling" : "Resume filling"}
                    </button>
                    {question.mapping.status !== "retired" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void changeMapping("retired")}
                        className="rounded border border-line px-3 py-2"
                      >
                        Remove match
                      </button>
                    )}
                  </div>
                </details>
              )}
            </section>
          )}
          <RevisionConflictPanel
            error={conflictError}
            draft={draft}
            onReviewCurrent={async () => {
              await Promise.all([
                query.refetch(),
                selectedAnswer.refetch(),
                currentAnswer.refetch(),
              ]);
              setReviewed(false);
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
              setReviewed(false);
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
