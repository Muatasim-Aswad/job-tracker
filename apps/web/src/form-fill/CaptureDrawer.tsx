import { useEffect, useMemo, useRef, useState } from "react";
import type { CaptureApply } from "../api/client";
import { RevisionConflictPanel } from "../components/RevisionConflictPanel";
import {
  useApplyFormFillCapture,
  useFormFillAnswer,
  useFormFillAnswers,
  useFormFillCapture,
  useFormFillQuestion,
  useRemoveFormFillDetail,
  useUpdateFormFillCapture,
} from "../hooks";
import { toast } from "../lib/toast";
import { Drawer } from "./Drawer";
import { bindingsComplete } from "./bindings";
import { OptionBindingEditor } from "./OptionBindingEditor";
import {
  answerKey,
  formatDate,
  isChoiceKind,
  SOURCE_LABEL,
  valueText,
  type AnswerValue,
} from "./model";

type Action = CaptureApply["action"];

interface Props {
  captureId: string;
  onClose: () => void;
  onOpenQuestion: (questionId: string) => void;
}

export function CaptureDrawer({ captureId, onClose, onOpenQuestion }: Props) {
  const query = useFormFillCapture(captureId);
  const answersQuery = useFormFillAnswers({ status: "active", limit: 100 });
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
  const [initialized, setInitialized] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const openedAnswerIds = useRef(new Set<string>());
  const capture = query.data;
  const question = questionQuery.data;
  const selectedAnswer = useFormFillAnswer(answerId || null);
  const answers = answersQuery.data?.pages.flatMap((page) => page.items) ?? [];
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
    setInitialized(true);
  }, [capture, initialized]);

  useEffect(() => {
    if (answerId) openedAnswerIds.current.add(answerId);
  }, [answerId]);

  const compatibleAnswers = useMemo(
    () =>
      capture
        ? answers.filter(
            (answer) =>
              answer.value_kind === capture.value_kind ||
              (capture.value_kind === "text" && answer.value_kind === "long_text"),
          )
        : [],
    [answers, capture],
  );

  function close() {
    removeDetail("capture", captureId);
    if (capture) removeDetail("question", capture.question_id);
    for (const id of openedAnswerIds.current) removeDetail("answer", id);
    onClose();
  }

  const newChoices =
    question?.options
      .filter((option) => option.status === "active")
      .map((option) => ({
        choice_key: answerKey(option.raw_label),
        display_label: option.raw_label,
        status: "active" as const,
      })) ?? [];

  function captureValueForAnswer(): AnswerValue {
    if (!capture?.value) return { kind: "text", value: "" };
    const value = capture.value;
    if (value.kind === "text" && selectedAnswer.data?.value_kind === "long_text") {
      return { kind: "long_text", value: value.value };
    }
    if (value.kind === "single_choice") {
      if (action === "create_answer_and_map") {
        const option = question?.options.find((item) => item.id === value.question_option_id);
        return { kind: "single_choice", choice_key: answerKey(option?.raw_label ?? "") };
      }
      const choiceId = bindings[value.question_option_id];
      const choice = selectedAnswer.data?.choices.find((item) => item.id === choiceId);
      return { kind: "single_choice", choice_key: choice?.choice_key ?? "" };
    }
    if (value.kind === "multi_choice") {
      if (action === "create_answer_and_map") {
        return {
          kind: "multi_choice",
          choice_keys: value.question_option_ids.map((id) =>
            answerKey(question?.options.find((item) => item.id === id)?.raw_label ?? ""),
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
    !!capture &&
    !!question &&
    !!action &&
    completeBindings &&
    (action === "create_answer_and_map" ? !!label && !!key : !!selectedAnswer.data) &&
    (action === "retarget_mapping" || action === "replace_option_bindings"
      ? !!capture.mapping
      : true);

  async function apply() {
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
          ? question.options
              .filter((option) => option.status === "active")
              .map((option) => ({
                question_option_id: option.id,
                answer_choice_key: answerKey(option.raw_label),
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
      close();
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
      toast.info(status === "ignored" ? "Remembered value ignored." : "Remembered value reopened.");
    } catch {
      setAnnouncement("The remembered value was not changed.");
    }
  }

  return (
    <Drawer label="Remembered value details" onClose={close}>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {query.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">
          Loading remembered value…
        </p>
      ) : query.isError || !capture ? (
        <div role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300">
          <p>Couldn’t load this remembered value.</p>
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
            <h2 className="text-lg font-semibold text-ink">{capture.question.raw_question}</h2>
            <p className="break-words rounded border border-line bg-surface p-3 text-ink">
              {valueText(capture.value)}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-ink-muted">Source</dt>
              <dd>{SOURCE_LABEL[capture.source]}</dd>
              <dt className="text-ink-muted">Scope</dt>
              <dd>This exact Question only</dd>
              <dt className="text-ink-muted">Site</dt>
              <dd>{capture.question.site_scope}</dd>
              <dt className="text-ink-muted">Remembered</dt>
              <dd>{formatDate(capture.created_at)}</dd>
              <dt className="text-ink-muted">State</dt>
              <dd>{capture.status}</dd>
            </dl>
            <button
              type="button"
              onClick={() =>
                void changeStatus(capture.status === "ignored" ? "current" : "ignored")
              }
              className="rounded border border-line px-3 py-1.5 text-sm"
            >
              {capture.status === "ignored"
                ? "Reopen remembered value"
                : "Keep provisional and ignore review"}
            </button>
          </section>

          {capture.question.capture_conflict && (
            <section className="rounded border border-red-500/40 p-3">
              <p className="font-medium text-ink">This Question has competing remembered values.</p>
              <p className="text-sm text-ink-muted">
                Nothing fills until the conflict is resolved.
              </p>
              <button
                type="button"
                onClick={() => onOpenQuestion(capture.question_id)}
                className="mt-2 text-sm font-medium text-accent"
              >
                Resolve all values in Question details
              </button>
            </section>
          )}

          {capture.status === "current" && !capture.question.capture_conflict && (
            <section aria-labelledby="apply-title" className="space-y-4">
              <div>
                <h3 id="apply-title" className="font-semibold text-ink">
                  Apply to verified knowledge
                </h3>
                <p className="text-sm text-ink-muted">
                  Choose one interpretation, review every affected resource, then commit once.
                </p>
              </div>
              <fieldset className="space-y-2">
                <legend className="sr-only">Interpretation</legend>
                {(
                  [
                    ["create_answer_and_map", "Create an Answer and Match this Question"],
                    ["update_answer", "Update an existing Answer"],
                    ["retarget_mapping", "Point this Question to another Answer"],
                    ["replace_option_bindings", "Replace this Match’s Option matches"],
                  ] as const
                ).map(([value, text]) => {
                  const unavailable =
                    (value === "retarget_mapping" || value === "replace_option_bindings") &&
                    !capture.mapping;
                  return (
                    <label
                      key={value}
                      className={`flex items-start gap-2 text-sm ${unavailable ? "text-ink-muted" : "text-ink"}`}
                    >
                      <input
                        type="radio"
                        name="capture-action"
                        value={value}
                        checked={action === value}
                        disabled={unavailable}
                        onChange={() => {
                          setAction(value);
                          setReviewed(false);
                        }}
                      />
                      <span>
                        {text}
                        {unavailable ? " — no Match exists" : ""}
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              {action === "create_answer_and_map" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium text-ink">
                    Answer label
                    <input
                      value={label}
                      onChange={(event) => {
                        setLabel(event.target.value);
                        setKey(answerKey(event.target.value));
                        setReviewed(false);
                      }}
                      className="mt-1 w-full rounded border border-line bg-surface px-3 py-2"
                    />
                  </label>
                  <label className="text-sm font-medium text-ink">
                    Stable key
                    <input
                      value={key}
                      onChange={(event) => {
                        setKey(answerKey(event.target.value));
                        setReviewed(false);
                      }}
                      className="mt-1 w-full rounded border border-line bg-surface px-3 py-2"
                    />
                  </label>
                  <label className="text-sm font-medium text-ink sm:col-span-2">
                    Description
                    <textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded border border-line bg-surface px-3 py-2"
                    />
                  </label>
                  <label className="text-sm font-medium text-ink">
                    Fill policy
                    <select
                      value={fillPolicy}
                      onChange={(event) => setFillPolicy(event.target.value as typeof fillPolicy)}
                      className="mt-1 w-full rounded border border-line bg-surface px-3 py-2"
                    >
                      <option value="auto">Automatic</option>
                      <option value="confirm_each_time">Ask every time</option>
                      <option value="never">Never fill</option>
                    </select>
                  </label>
                </div>
              ) : (
                action && (
                  <label className="block text-sm font-medium text-ink">
                    Affected Answer
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
                )
              )}

              {choiceQuestion &&
                action &&
                action !== "create_answer_and_map" &&
                selectedAnswer.data &&
                question && (
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
              {actionValid && !reviewed && (
                <button
                  type="button"
                  onClick={() => setReviewed(true)}
                  className="rounded border border-accent px-3 py-2 text-sm font-medium text-accent"
                >
                  Review affected resources
                </button>
              )}
              {reviewed && question && (
                <div className="space-y-2 rounded-lg border border-accent p-3 text-sm">
                  <p className="font-semibold text-ink">Affected-resource review</p>
                  <ul className="list-disc pl-5">
                    <li>Remembered value revision {capture.revision} will become applied.</li>
                    <li>Question revision {question.revision} will be checked.</li>
                    <li>
                      {action === "create_answer_and_map"
                        ? "One Answer and its Match will be created."
                        : `Answer revision ${selectedAnswer.data?.revision ?? "—"} will be checked.`}
                    </li>
                    {capture.mapping && (
                      <li>Match revision {capture.mapping.revision} will be checked.</li>
                    )}
                    {choiceQuestion && <li>The complete Option-match set will be replaced.</li>}
                  </ul>
                  <button
                    type="button"
                    disabled={applyCapture.isPending}
                    onClick={() => void apply()}
                    className="rounded bg-accent px-3 py-2 font-medium text-white disabled:opacity-50"
                  >
                    {applyCapture.isPending ? "Applying…" : "Apply reviewed change"}
                  </button>
                </div>
              )}
            </section>
          )}

          <RevisionConflictPanel
            error={applyCapture.error ?? updateCapture.error}
            draft={JSON.stringify(
              { action, answerId, label, key, description, fillPolicy, bindings },
              null,
              2,
            )}
            onReviewCurrent={async () => {
              await query.refetch();
              await questionQuery.refetch();
              await selectedAnswer.refetch();
              setAction("");
              setReviewed(false);
              applyCapture.reset();
              updateCapture.reset();
            }}
            onDiscard={() => {
              setAction("");
              setReviewed(false);
              setAnswerId(capture.answer?.id ?? "");
              setBindings(
                Object.fromEntries(
                  (capture.mapping?.bindings ?? []).map((binding) => [
                    binding.question_option_id,
                    binding.answer_choice_id,
                  ]),
                ),
              );
              applyCapture.reset();
              updateCapture.reset();
            }}
          />

          <section aria-labelledby="capture-history-title" className="space-y-2">
            <h3 id="capture-history-title" className="font-semibold text-ink">
              Value-free history
            </h3>
            <p className="text-xs text-ink-muted">
              History records decisions and revisions, never previous values.
            </p>
            {capture.events.length === 0 ? (
              <p className="text-sm text-ink-muted">No history yet.</p>
            ) : (
              <ul className="space-y-1 text-sm text-ink-muted">
                {capture.events.map((event) => (
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
