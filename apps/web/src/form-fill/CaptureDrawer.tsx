import { useEffect, useRef, useState } from "react";
import type { CaptureApply } from "../api/client";
import { RevisionConflictPanel } from "../components/RevisionConflictPanel";
import {
  useApplyFormFillCapture,
  useFormFillAnswer,
  useFormFillCapture,
  useFormFillQuestion,
  useRemoveFormFillDetail,
  useUpdateFormFillCapture,
} from "../hooks";
import { toast } from "../lib/toast";
import { Drawer } from "./Drawer";
import { bindingsComplete, suggestBindings } from "./bindings";
import { OptionBindingEditor } from "./OptionBindingEditor";
import {
  answerKey,
  fillExplanation,
  siteLabel,
  isChoiceKind,
  SOURCE_LABEL,
  valueText,
  type AnswerValue,
} from "./model";

import { AnswerPicker } from "./AnswerPicker";
import { ChangeReview } from "./ChangeReview";
import { KnowledgeHistory } from "./KnowledgeHistory";
import { choicePairsForQuestion } from "./answerDraft";
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
  const [reviewed, setReviewed] = useState(false);
  const [baseline, setBaseline] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const openedAnswerIds = useRef(new Set<string>());
  const reviewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (reviewed) reviewRef.current?.scrollIntoView?.({ block: "start" });
  }, [reviewed]);
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

  useEffect(() => {
    if (answerId) openedAnswerIds.current.add(answerId);
    if (capture?.answer?.id) openedAnswerIds.current.add(capture.answer.id);
  }, [answerId, capture?.answer?.id]);

  function close() {
    removeDetail("capture", captureId);
    if (capture) removeDetail("question", capture.question_id);
    for (const id of openedAnswerIds.current) removeDetail("answer", id);
    onClose();
  }

  const pairs = question ? choicePairsForQuestion(question) : [];
  const newChoices = pairs.map(({ option, choiceKey }) => ({
    choice_key: choiceKey,
    display_label: option.raw_label,
    status: "active" as const,
  }));

  function captureValueForAnswer(): AnswerValue {
    if (!capture?.value) return { kind: "text", value: "" };
    const value = capture.value;
    if (value.kind === "text" && selectedAnswer.data?.value_kind === "long_text") {
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
      const choice = selectedAnswer.data?.choices.find((item) => item.id === choiceId);
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
            selectedAnswer.data?.choices.find((item) => item.id === bindings[id])?.choice_key ?? "",
        ),
      };
    }
    return value;
  }

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
    !!capture?.value &&
    capture.status === "current" &&
    !capture.question.capture_conflict &&
    !!question &&
    (!capture.answer || (!!currentAnswer.data && !currentAnswer.isError)) &&
    !!action &&
    completeBindings &&
    (action === "create_answer_and_map"
      ? !!label.trim() && !!key.trim()
      : !!selectedAnswer.data && !selectedAnswer.isError) &&
    (action === "retarget_mapping" || action === "replace_option_bindings"
      ? !!capture.mapping
      : true);

  async function apply(advance = false) {
    if (!capture || !question || !actionValid || !reviewed) return;
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
        value: captureValueForAnswer(),
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
        answer_id: selectedAnswer.data!.id,
        expected_answer_revision: selectedAnswer.data!.revision,
        expected_mapping_revision: capture.mapping?.revision ?? null,
        value: captureValueForAnswer(),
      };
    } else if (action === "retarget_mapping") {
      body = {
        action,
        ...common,
        answer_id: selectedAnswer.data!.id,
        expected_answer_revision: selectedAnswer.data!.revision,
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
        answer_id: selectedAnswer.data!.id,
        mapping_id: capture.mapping!.id,
        expected_answer_revision: selectedAnswer.data!.revision,
        expected_mapping_revision: capture.mapping!.revision,
        bindings: question.options
          .filter((option) => option.status === "active")
          .map((option) => ({
            question_option_id: option.id,
            answer_choice_id: bindings[option.id],
          })),
      };
    }
    try {
      await applyCapture.mutateAsync({ captureId, body });
      setAnnouncement("Remembered value applied to verified knowledge.");
      toast.info("Remembered value applied.");
      if (advance && onNext) onNext();
      else close();
    } catch {
      setAnnouncement("The remembered value was not applied.");
      setReviewed(false);
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
        status === "ignored" ? "Remembered value ignored." : "Remembered value reopened.",
      );
      toast.info(
        status === "ignored"
          ? "Remembered value dismissed and cleared."
          : "Remembered value reopened.",
      );
      if (status === "ignored") close();
    } catch {
      setAnnouncement("The remembered value was not changed.");
    }
  }

  const draft = JSON.stringify({ action, answerId, label, key, description, fillPolicy, bindings });
  const busy = applyCapture.isPending || updateCapture.isPending;
  const retainedQuestionId = useRef<string | null>(null);
  retainedQuestionId.current = capture?.question_id ?? null;
  useEffect(
    () => () => {
      removeDetail("capture", captureId);
      if (retainedQuestionId.current) removeDetail("question", retainedQuestionId.current);
      for (const id of openedAnswerIds.current) removeDetail("answer", id);
    },
    [removeDetail, captureId],
  );
  useEffect(() => {
    setReviewed(false);
  }, [draft, question?.revision, selectedAnswer.data?.revision, capture?.revision]);
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
      : captureValueForAnswer();
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
      label="Review remembered answer"
      onClose={close}
      dirty={initialized && draft !== baseline}
      busy={busy}
      footer={
        capture?.status === "current" && !capture.question.capture_conflict ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              {!reviewed ? (
                <button
                  type="button"
                  disabled={!actionValid || busy}
                  onClick={() => setReviewed(true)}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
                >
                  Review changes
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!actionValid || busy}
                    onClick={() => void apply()}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
                  >
                    {busy ? "Saving…" : "Save changes"}
                  </button>
                  {onNext && (
                    <button
                      type="button"
                      disabled={!actionValid || busy}
                      onClick={() => void apply(true)}
                      className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent disabled:opacity-50"
                    >
                      Save and review next
                    </button>
                  )}
                </>
              )}
              <HelpTip
                label="About saving remembered answers"
                text="Check the value and affected questions before saving."
              />
            </div>
            {!actionValid && (
              <p className="text-xs text-ink-muted">
                Choose an action and complete any missing choice matches.
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
        <p role="status">Loading remembered answer…</p>
      ) : query.isError || !capture ? (
        <p role="alert">
          Couldn’t load this remembered answer.{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="max-w-prose text-xl font-semibold text-ink">
              {capture.question.raw_question}
            </h2>
            <p className="text-sm text-ink-muted">
              {siteLabel(capture.question.site_scope)} • {SOURCE_LABEL[capture.source]}
            </p>
            {questionQuery.isLoading ? (
              <p role="status">Loading question and choices…</p>
            ) : questionQuery.isError ? (
              <p role="alert">
                Couldn’t load the form choices.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void questionQuery.refetch()}
                >
                  Retry
                </button>
              </p>
            ) : (
              <div className="rounded-lg border border-line bg-surface p-4">
                <p className="text-xs text-ink-muted">Remembered value</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-xl font-medium text-ink">
                  {valueText(capture.value, question?.options)}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => onOpenQuestion(capture.question_id)}
              className="text-sm font-medium text-accent"
            >
              Back to question and saved answers
            </button>
            {capture.status === "current" && (
              <details className="text-sm text-ink-muted">
                <summary className="cursor-pointer">Dismiss this remembered value</summary>
                <p className="my-3">
                  Dismissal clears this retained value and stops it being reused. Your saved answer
                  stays unchanged. You can find the question under Dismissed and enter a fresh value
                  later.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void changeStatus("ignored")}
                  className="rounded border border-red-300 px-3 py-2 text-red-700 dark:text-red-300"
                >
                  Dismiss and clear value
                </button>
              </details>
            )}
            {capture.status !== "current" && (
              <p className="rounded border border-line bg-sunken p-3 text-sm">
                This value has been cleared. Open the question, reopen it if dismissed, then enter a
                new value in an application form to remember it again.
              </p>
            )}
          </section>
          {capture.question.capture_conflict ? (
            <section className="space-y-3 rounded-lg border border-red-400 p-4">
              <p className="font-semibold">This question has conflicting remembered values.</p>
              <p className="text-sm text-ink-muted">
                Choose which value to keep before saving an answer.
              </p>
              <button
                type="button"
                onClick={() => onOpenQuestion(capture.question_id)}
                className="text-sm font-medium text-accent"
              >
                Review conflicting values
              </button>
            </section>
          ) : (
            capture.status === "current" &&
            question && (
              <section className="space-y-4" aria-label="How to use this value">
                <h3 className="font-semibold text-ink">How should this value be used?</h3>
                <fieldset className="space-y-2">
                  <legend className="sr-only">Action</legend>
                  {(
                    [
                      ...(!capture.mapping || capture.mapping.status === "retired"
                        ? [["create_answer_and_map", "Save as a new answer for this question"]]
                        : []),
                      ...(capture.mapping
                        ? [["update_answer", "Replace the saved answer’s value"]]
                        : []),
                      ...(capture.mapping
                        ? [["retarget_mapping", "Use a different saved answer for this question"]]
                        : []),
                      ...(capture.mapping && choiceQuestion
                        ? [
                            [
                              "replace_option_bindings",
                              "Correct how form choices match the saved answer",
                            ],
                          ]
                        : []),
                    ] as [Action, string][]
                  ).map(([value, text]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${action === value ? "border-accent bg-surface text-ink" : "border-line text-ink-muted"}`}
                    >
                      <input
                        type="radio"
                        name="capture-action"
                        checked={action === value}
                        onChange={() => {
                          setAction(value);
                          setReviewed(false);
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
                {action === "create_answer_and_map" ? (
                  <div className="space-y-4">
                    <label className="block text-sm font-medium text-ink">
                      Answer name
                      <input
                        value={label}
                        onChange={(event) => {
                          const next = event.target.value;
                          setLabel(next);
                          if (!key || key === answerKey(label)) setKey(answerKey(next));
                        }}
                        className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2"
                      />
                    </label>
                    <div className="flex items-end gap-2">
                      <label className="block flex-1 text-sm font-medium text-ink">
                        Fill behavior
                        <select
                          value={fillPolicy}
                          onChange={(event) =>
                            setFillPolicy(event.target.value as typeof fillPolicy)
                          }
                          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2"
                        >
                          <option value="auto">Fill automatically</option>
                          <option value="confirm_each_time">Ask every time</option>
                          <option value="never">Never fill</option>
                        </select>
                      </label>
                      <HelpTip label="About fill behavior" text={fillExplanation(fillPolicy)} />
                    </div>
                    <details className="text-sm text-ink-muted">
                      <summary className="cursor-pointer">Optional details</summary>
                      <div className="mt-3 space-y-3">
                        <label className="block">
                          Description
                          <textarea
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded border border-line bg-surface px-3 py-2"
                          />
                        </label>
                        <label className="block">
                          Stable key
                          <input
                            value={key}
                            onChange={(event) => setKey(answerKey(event.target.value))}
                            className="mt-1 w-full rounded border border-line bg-surface px-3 py-2"
                          />
                        </label>
                      </div>
                    </details>
                  </div>
                ) : action === "retarget_mapping" ? (
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
                    }}
                  />
                ) : selectedAnswer.isLoading ? (
                  <p role="status">Loading saved answer…</p>
                ) : selectedAnswer.isError ? (
                  <p role="alert">
                    Couldn’t load the saved answer.{" "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void selectedAnswer.refetch()}
                    >
                      Retry
                    </button>
                  </p>
                ) : (
                  selectedAnswer.data && (
                    <div className="rounded border border-line bg-surface p-4">
                      <p className="font-semibold">{selectedAnswer.data.label}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-lg">
                        {valueText(selectedAnswer.data.value, selectedAnswer.data.choices)}
                      </p>
                      <p className="mt-2 text-sm text-ink-muted">
                        Used by {selectedAnswer.data.mappings.length} questions.
                      </p>
                    </div>
                  )
                )}
                {!capture.mapping && (
                  <p className="text-sm text-ink-muted">
                    Already have an answer?{" "}
                    <button
                      type="button"
                      onClick={() => onOpenQuestion(capture.question_id)}
                      className="font-medium text-accent"
                    >
                      Match a saved answer instead
                    </button>
                    .
                  </p>
                )}
                {choiceQuestion &&
                  action &&
                  action !== "create_answer_and_map" &&
                  selectedAnswer.data && (
                    <OptionBindingEditor
                      options={question.options}
                      choices={selectedAnswer.data.choices}
                      value={bindings}
                      onChange={setBindings}
                    />
                  )}
                {reviewed && (
                  <ChangeReview
                    ref={reviewRef}
                    before={before}
                    after={`${action === "create_answer_and_map" ? label : (selectedAnswer.data?.label ?? "")}: ${valueText(afterValue, afterLabels)}`}
                    behavior={behavior}
                    affected={affected}
                  >
                    {action === "update_answer" && (
                      <p className="text-sm text-ink-muted">
                        Every question using this saved answer will use the new value. No other
                        answer is changed.
                      </p>
                    )}
                    {(action === "retarget_mapping" || action === "replace_option_bindings") && (
                      <p className="text-sm text-ink-muted">
                        The saved answer’s value stays unchanged. This remembered value is cleared
                        after saving.
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
              ]);
              setReviewed(false);
              applyCapture.reset();
              updateCapture.reset();
            }}
            onDiscard={() => {
              setInitialized(false);
              setReviewed(false);
              setDescription("");
              setFillPolicy("auto");
              applyCapture.reset();
              updateCapture.reset();
            }}
          />
          <KnowledgeHistory events={capture.events} />
        </>
      )}
    </Drawer>
  );
}
