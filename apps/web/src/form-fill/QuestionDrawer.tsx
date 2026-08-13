import { useEffect, useMemo, useRef, useState } from "react";
import { RevisionConflictPanel } from "../components/RevisionConflictPanel";
import {
  useFormFillAnswer,
  useFormFillAnswers,
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
import { bindingsComplete } from "./bindings";
import { OptionBindingEditor } from "./OptionBindingEditor";
import { controlAcceptsAnswer, formatDate, valueText } from "./model";

interface Props {
  questionId: string;
  suggestedAnswerId?: string | null;
  onClose: () => void;
  onCreateAnswer: () => void;
}

export function QuestionDrawer({ questionId, suggestedAnswerId, onClose, onCreateAnswer }: Props) {
  const query = useFormFillQuestion(questionId);
  const answerList = useFormFillAnswers({ status: "active", limit: 100 });
  const putMapping = usePutFormFillMapping();
  const updateMapping = useUpdateFormFillMapping();
  const updateQuestion = useUpdateFormFillQuestion();
  const resolveConflict = useResolveFormFillCaptureConflict();
  const removeDetail = useRemoveFormFillDetail();
  const [answerId, setAnswerId] = useState(suggestedAnswerId ?? "");
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [winnerId, setWinnerId] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const openedAnswerIds = useRef(new Set<string>());
  const question = query.data;
  const selectedAnswer = useFormFillAnswer(answerId || null);
  const captureIds = question?.current_captures?.map((capture) => capture.id) ?? [];
  const conflictCaptures = useFormFillConflictCaptures(captureIds);
  const answers = answerList.data?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => {
    if (!question || initialized) return;
    const nextAnswerId = suggestedAnswerId ?? question.answer?.id ?? "";
    setAnswerId(nextAnswerId);
    setBindings(
      Object.fromEntries(
        (question.mapping?.bindings ?? []).map((binding) => [
          binding.question_option_id,
          binding.answer_choice_id,
        ]),
      ),
    );
    setWinnerId(question.current_captures?.[0]?.id ?? "");
    setInitialized(true);
  }, [question, initialized, suggestedAnswerId]);

  useEffect(() => {
    if (answerId) openedAnswerIds.current.add(answerId);
  }, [answerId]);

  const compatibleAnswers = useMemo(
    () =>
      question
        ? answers.filter((answer) => controlAcceptsAnswer(question.control_kind, answer.value_kind))
        : [],
    [answers, question],
  );
  const choiceQuestion =
    !!question &&
    ["radio", "select", "checkbox_group", "multi_select"].includes(question.control_kind);
  const complete =
    !choiceQuestion ||
    (!!selectedAnswer.data &&
      bindingsComplete(question?.options ?? [], selectedAnswer.data.choices, bindings));

  function close() {
    removeDetail("question", questionId);
    for (const id of captureIds) removeDetail("capture", id);
    for (const id of openedAnswerIds.current) removeDetail("answer", id);
    onClose();
  }

  async function saveMapping() {
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
      setAnnouncement("Match saved.");
      toast.info("Match saved.");
      setReviewed(false);
    } catch {
      setAnnouncement("The Match was not saved.");
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
      setAnnouncement("Match state saved.");
      toast.info("Match state saved.");
    } catch {
      setAnnouncement("The Match state was not saved.");
    }
  }

  async function changeReview(review_state: "open" | "ignored") {
    if (!question) return;
    try {
      await updateQuestion.mutateAsync({
        questionId,
        body: { expected_revision: question.revision, review_state },
      });
      setAnnouncement(review_state === "ignored" ? "Question muted." : "Question reopened.");
      toast.info(review_state === "ignored" ? "Question muted." : "Question reopened.");
    } catch {
      setAnnouncement("The Question was not changed.");
    }
  }

  async function chooseWinner() {
    if (!question || !winnerId || conflictCaptures.some((capture) => !capture.data)) return;
    try {
      await resolveConflict.mutateAsync({
        questionId,
        body: {
          expected_question_revision: question.revision,
          winner_capture_id: winnerId,
          captures: conflictCaptures.map((capture) => ({
            capture_id: capture.data!.id,
            expected_revision: capture.data!.revision,
          })),
        },
      });
      setAnnouncement("Remembered-value conflict resolved.");
      toast.info("Remembered-value conflict resolved.");
    } catch {
      setAnnouncement("The conflict was not resolved.");
    }
  }

  const conflictError =
    putMapping.error ?? updateMapping.error ?? updateQuestion.error ?? resolveConflict.error;

  return (
    <Drawer label="Question details" onClose={close}>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {query.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">
          Loading Question…
        </p>
      ) : query.isError || !question ? (
        <div role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300">
          <p>Couldn’t load this Question.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="font-medium underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-ink">{question.raw_question}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-ink-muted">Site</dt>
              <dd>{question.site_scope}</dd>
              <dt className="text-ink-muted">Control</dt>
              <dd>{question.control_kind}</dd>
              <dt className="text-ink-muted">Section</dt>
              <dd>{question.raw_section || "—"}</dd>
              <dt className="text-ink-muted">Help</dt>
              <dd>{question.raw_help || "—"}</dd>
              <dt className="text-ink-muted">Seen</dt>
              <dd>
                {question.seen_count} times, last {formatDate(question.last_seen_at)}
              </dd>
              <dt className="text-ink-muted">State</dt>
              <dd>{question.review_state === "ignored" ? "Muted" : "Open"}</dd>
            </dl>
            <button
              type="button"
              onClick={() =>
                void changeReview(question.review_state === "open" ? "ignored" : "open")
              }
              className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink"
            >
              {question.review_state === "open" ? "Mute Question" : "Reopen Question"}
            </button>
          </section>

          {question.capture_conflict && (
            <section
              aria-labelledby="capture-conflict-title"
              className="space-y-3 rounded-lg border border-red-500/40 p-4"
            >
              <h3 id="capture-conflict-title" className="font-semibold text-ink">
                Competing remembered values
              </h3>
              <p className="text-sm text-ink-muted">
                Nothing fills until you choose the current value.
              </p>
              {conflictCaptures.some((capture) => capture.isLoading) ? (
                <p role="status" className="text-sm text-ink-muted">
                  Loading remembered values…
                </p>
              ) : (
                conflictCaptures.map(
                  (capture) =>
                    capture.data && (
                      <label
                        key={capture.data.id}
                        className="flex items-start gap-2 rounded border border-line bg-surface p-3 text-sm text-ink"
                      >
                        <input
                          type="radio"
                          name="capture-winner"
                          checked={winnerId === capture.data.id}
                          onChange={() => setWinnerId(capture.data!.id)}
                        />
                        <span>
                          <span className="block font-medium">{valueText(capture.data.value)}</span>
                          <span className="text-xs text-ink-muted">
                            {capture.data.source} · {formatDate(capture.data.created_at)}
                          </span>
                        </span>
                      </label>
                    ),
                )
              )}
              <button
                type="button"
                disabled={!winnerId || resolveConflict.isPending}
                onClick={() => void chooseWinner()}
                className="rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {resolveConflict.isPending ? "Resolving…" : "Keep selected value"}
              </button>
            </section>
          )}

          <section aria-labelledby="match-title" className="space-y-3">
            <div>
              <h3 id="match-title" className="font-semibold text-ink">
                Match
              </h3>
              <p className="text-sm text-ink-muted">
                Connect this exact Question to one compatible Answer.
              </p>
            </div>
            {question.mapping && (
              <p className="text-sm text-ink">
                Current Match: <strong>{question.answer?.label ?? "Unknown Answer"}</strong> ·{" "}
                {question.mapping.status}
              </p>
            )}
            <label className="block text-sm font-medium text-ink">
              Destination Answer
              <select
                value={answerId}
                onChange={(event) => {
                  setAnswerId(event.target.value);
                  setBindings({});
                  setReviewed(false);
                }}
                className="mt-1 w-full rounded border border-line bg-surface px-3 py-2"
              >
                <option value="">Choose an Answer</option>
                {compatibleAnswers.map((answer) => (
                  <option key={answer.id} value={answer.id}>
                    {answer.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={onCreateAnswer}
              className="text-sm font-medium text-accent"
            >
              Create a new Answer for this Question
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
            {answerId && complete && !reviewed && (
              <button
                type="button"
                onClick={() => setReviewed(true)}
                className="rounded border border-accent px-3 py-2 text-sm font-medium text-accent"
              >
                Review Match change
              </button>
            )}
            {reviewed && selectedAnswer.data && (
              <div className="space-y-2 rounded-lg border border-accent p-3 text-sm">
                <p className="font-semibold text-ink">Affected-resource review</p>
                <p>
                  Question revision {question.revision}; Answer revision{" "}
                  {selectedAnswer.data.revision};{" "}
                  {question.mapping ? `Match revision ${question.mapping.revision}` : "new Match"}.{" "}
                  {choiceQuestion
                    ? `${question.options.filter((option) => option.status === "active").length} Option matches will be replaced.`
                    : "No Option matches are needed."}
                </p>
                <button
                  type="button"
                  disabled={putMapping.isPending}
                  onClick={() => void saveMapping()}
                  className="rounded bg-accent px-3 py-2 font-medium text-white disabled:opacity-50"
                >
                  {putMapping.isPending ? "Saving…" : "Save reviewed Match"}
                </button>
              </div>
            )}
            {question.mapping?.status === "active" && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void changeMapping("disabled")}
                  className="rounded border border-line px-3 py-1.5 text-sm"
                >
                  Disable Match
                </button>
                <button
                  type="button"
                  onClick={() => void changeMapping("retired")}
                  className="rounded border border-line px-3 py-1.5 text-sm"
                >
                  Retire Match
                </button>
              </div>
            )}
            {question.mapping?.status === "disabled" && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void changeMapping("active")}
                  className="rounded border border-line px-3 py-1.5 text-sm"
                >
                  Enable Match
                </button>
                <button
                  type="button"
                  onClick={() => void changeMapping("retired")}
                  className="rounded border border-line px-3 py-1.5 text-sm"
                >
                  Retire Match
                </button>
              </div>
            )}
            {question.mapping?.status === "retired" && (
              <p className="text-sm text-ink-muted">
                Choose an Answer and save to reactivate this Match.
              </p>
            )}
          </section>

          <RevisionConflictPanel
            error={conflictError}
            draft={JSON.stringify({ answerId, bindings }, null, 2)}
            onReviewCurrent={async () => {
              await query.refetch();
              await selectedAnswer.refetch();
              setReviewed(false);
              putMapping.reset();
              updateMapping.reset();
              updateQuestion.reset();
              resolveConflict.reset();
            }}
            onDiscard={() => {
              setAnswerId(question.answer?.id ?? "");
              setBindings(
                Object.fromEntries(
                  (question.mapping?.bindings ?? []).map((binding) => [
                    binding.question_option_id,
                    binding.answer_choice_id,
                  ]),
                ),
              );
              setReviewed(false);
              putMapping.reset();
              updateMapping.reset();
              updateQuestion.reset();
              resolveConflict.reset();
            }}
          />

          <section aria-labelledby="question-history-title" className="space-y-2">
            <h3 id="question-history-title" className="font-semibold text-ink">
              Value-free history
            </h3>
            <p className="text-xs text-ink-muted">Previous values are not retained in history.</p>
            {!question.events?.length ? (
              <p className="text-sm text-ink-muted">No history yet.</p>
            ) : (
              <ul className="space-y-1 text-sm text-ink-muted">
                {question.events.map((event) => (
                  <li key={event.id}>
                    {event.event} · {formatDate(event.created_at)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Drawer>
  );
}
