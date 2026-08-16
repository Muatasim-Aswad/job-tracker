import { useEffect, useState } from "react";
import { RevisionConflictPanel } from "../components/RevisionConflictPanel";
import {
  useCreateFormFillAnswer,
  useCreateFormFillAnswerForQuestion,
  useFormFillAnswer,
  useFormFillQuestion,
  useRemoveFormFillDetail,
  useUpdateFormFillAnswer,
} from "../hooks";
import { toast } from "../lib/toast";
import { AnswerEditor } from "./AnswerEditor";
import {
  choicePairsForQuestion,
  draftForQuestion,
  draftFromAnswer,
  emptyAnswerDraft,
  valueFromDraft,
  type AnswerDraft,
} from "./answerDraft";
import { Drawer } from "./Drawer";
import { formatDate, isChoiceKind, type QuestionDetail } from "./model";

interface Props {
  answerId: string | null;
  questionContext?: QuestionDetail | null;
  onClose: () => void;
  onCreated: (answerId: string) => void;
  onOpenQuestion: (questionId: string) => void;
}

export function AnswerDrawer({
  answerId,
  questionContext = null,
  onClose,
  onCreated,
  onOpenQuestion,
}: Props) {
  const query = useFormFillAnswer(answerId);
  const questionQuery = useFormFillQuestion(questionContext?.id ?? null);
  const create = useCreateFormFillAnswer();
  const createForQuestion = useCreateFormFillAnswerForQuestion();
  const update = useUpdateFormFillAnswer();
  const removeDetail = useRemoveFormFillDetail();
  const [context, setContext] = useState(questionContext);
  const [draft, setDraft] = useState<AnswerDraft>(() =>
    questionContext ? draftForQuestion(questionContext) : emptyAnswerDraft(),
  );
  const [initializedFor, setInitializedFor] = useState<string | null>(
    answerId ? null : (questionContext?.id ?? "new"),
  );
  const [announcement, setAnnouncement] = useState("");
  const answer = query.data;
  const mutation = answerId ? update : context ? createForQuestion : create;

  useEffect(() => {
    if (answer && initializedFor !== answer.id) {
      setDraft(draftFromAnswer(answer));
      setInitializedFor(answer.id);
    }
  }, [answer, initializedFor]);

  function close() {
    if (answerId) removeDetail("answer", answerId);
    onClose();
  }

  const valid =
    !!draft.label.trim() &&
    !!draft.answerKey.trim() &&
    (draft.valueKind === "boolean" ? !!draft.scalar : true) &&
    (draft.valueKind === "single_choice" ? draft.selected.length === 1 : true) &&
    (draft.valueKind === "multi_choice" ? draft.selected.length > 0 : true) &&
    (!draft.valueKind.includes("choice") ||
      (draft.choices.length > 0 &&
        draft.choices.every((choice) => choice.choice_key && choice.display_label)));

  async function save() {
    if (!valid) return;
    try {
      if (answerId && answer) {
        await update.mutateAsync({
          answerId,
          body: {
            expected_revision: answer.revision,
            choices: draft.choices,
            description: draft.description || null,
            fill_policy: draft.fillPolicy,
            label: draft.label,
            status: draft.status,
            value: valueFromDraft(draft),
          },
        });
        setAnnouncement("Answer saved.");
        toast.info("Answer saved.");
      } else if (context) {
        const created = await createForQuestion.mutateAsync({
          questionId: context.id,
          body: {
            expected_question_revision: context.revision,
            expected_mapping_revision: context.mapping?.revision ?? null,
            answer_key: draft.answerKey,
            choices: draft.choices,
            description: draft.description || null,
            fill_policy: draft.fillPolicy,
            label: draft.label,
            value: valueFromDraft(draft),
            bindings: isChoiceKind(draft.valueKind)
              ? choicePairsForQuestion(context).map(({ option, choiceKey }) => ({
                  question_option_id: option.id,
                  answer_choice_key: choiceKey,
                }))
              : [],
          },
        });
        if (!created.answer) throw new Error("Question Answer creation returned no Answer");
        setAnnouncement("Answer and Match created.");
        toast.info("Answer and Match created.");
        onCreated(created.answer.id);
      } else {
        const created = await create.mutateAsync({
          answer_key: draft.answerKey,
          choices: draft.choices,
          description: draft.description || null,
          fill_policy: draft.fillPolicy,
          label: draft.label,
          value: valueFromDraft(draft),
          value_kind: draft.valueKind,
        });
        setAnnouncement("Answer created.");
        toast.info("Answer created.");
        onCreated(created.id);
      }
    } catch {
      setAnnouncement("The Answer was not saved.");
    }
  }

  const discard = () => {
    if (answer) setDraft(draftFromAnswer(answer));
    else if (context) setDraft(draftForQuestion(context));
    else setDraft(emptyAnswerDraft());
    mutation.reset();
  };

  return (
    <Drawer label={answerId ? "Answer details" : "Create Answer"} onClose={close}>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {answerId && query.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">
          Loading Answer…
        </p>
      ) : answerId && query.isError ? (
        <div role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300">
          <p>Couldn’t load this Answer.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="font-medium underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-5"
        >
          {context && (
            <p className="rounded border border-line bg-sunken p-3 text-sm text-ink-muted">
              Creating for “{context.raw_question}”. Value type and choice vocabulary come from its{" "}
              {context.control_kind} control, and the Match is created with the Answer.
            </p>
          )}
          <AnswerEditor
            draft={draft}
            existing={!!answerId}
            questionLocked={!!context}
            onChange={setDraft}
          />
          {answer && draft.status === "disabled" && answer.mappings.length > 0 && (
            <p className="rounded border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
              This stops {answer.mappings.length} matched{" "}
              {answer.mappings.length === 1 ? "Question" : "Questions"} from filling. Matches and
              history are preserved.
            </p>
          )}
          {answer && (
            <label className="block text-sm font-medium text-ink">
              Answer state
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft({ ...draft, status: event.target.value as AnswerDraft["status"] })
                }
                className="mt-1 w-full rounded border border-line bg-surface px-3 py-2"
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
          )}
          <RevisionConflictPanel
            error={mutation.error}
            draft={JSON.stringify(draft, null, 2)}
            onReviewCurrent={async () => {
              if (context) {
                const current = await questionQuery.refetch();
                if (current.data) setContext(current.data);
              } else {
                await query.refetch();
              }
              mutation.reset();
            }}
            onDiscard={discard}
          />
          <button
            type="submit"
            disabled={!valid || mutation.isPending}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {mutation.isPending ? "Saving…" : answerId ? "Save Answer" : "Create Answer"}
          </button>
        </form>
      )}

      {answer && (
        <>
          <section aria-labelledby="answer-matches-title" className="space-y-2">
            <h3 id="answer-matches-title" className="font-semibold text-ink">
              Affected Matches
            </h3>
            {answer.mappings.length === 0 ? (
              <p className="text-sm text-ink-muted">No Questions use this Answer.</p>
            ) : (
              <ul className="space-y-2">
                {answer.mappings.map((question) => (
                  <li key={question.id}>
                    <button
                      type="button"
                      onClick={() => onOpenQuestion(question.id)}
                      className="w-full rounded border border-line bg-surface p-3 text-left hover:bg-surface-hover"
                    >
                      <span className="block font-medium text-ink">{question.raw_question}</span>
                      <span className="text-xs text-ink-muted">
                        {question.site_scope} · Match {question.mapping.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="answer-history-title" className="space-y-2">
            <h3 id="answer-history-title" className="font-semibold text-ink">
              Value-free history
            </h3>
            <p className="text-xs text-ink-muted">Previous values are not retained in history.</p>
            {answer.events.length === 0 ? (
              <p className="text-sm text-ink-muted">No history yet.</p>
            ) : (
              <ul className="space-y-1 text-sm text-ink-muted">
                {answer.events.map((event) => (
                  <li key={event.id}>
                    {event.event} · {formatDate(event.created_at)}
                    {event.reason ? ` · ${event.reason}` : ""}
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
