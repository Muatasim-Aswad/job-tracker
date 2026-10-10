import { useEffect, useId, useState } from "react";
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
import { fillExplanation, isChoiceKind, valueText, type QuestionDetail } from "./model";
import { ChangeReview } from "./ChangeReview";
import { KnowledgeHistory } from "./KnowledgeHistory";
import { HelpTip } from "./HelpTip";

interface Props {
  answerId: string | null;
  questionContext?: QuestionDetail | null;
  onClose: () => void;
  onCreated: (answerId: string, advance?: boolean) => void;
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
  const formId = useId();
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(questionContext ? draftForQuestion(questionContext) : emptyAnswerDraft()),
  );
  const answer = query.data;
  const mutation = answerId ? update : context ? createForQuestion : create;
  useEffect(
    () => () => {
      if (answerId) removeDetail("answer", answerId);
      if (questionContext) removeDetail("question", questionContext.id);
    },
    [answerId, questionContext, removeDetail],
  );

  useEffect(() => {
    if (answer && initializedFor !== answer.id) {
      setDraft(draftFromAnswer(answer));
      setBaseline(JSON.stringify(draftFromAnswer(answer)));
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
    (!isChoiceKind(draft.valueKind) ? !!draft.scalar.trim() : true) &&
    (draft.valueKind === "single_choice" ? draft.selected.length === 1 : true) &&
    (draft.valueKind === "multi_choice" ? draft.selected.length > 0 : true) &&
    (!draft.valueKind.includes("choice") ||
      (draft.choices.length > 0 &&
        draft.choices.every((choice) => choice.choice_key && choice.display_label)));

  async function save(advance = false) {
    if (!valid) return;
    try {
      if (answerId && answer) {
        const saved = await update.mutateAsync({
          answerId,
          body: {
            expected_revision: answer.revision,
            answer_key: draft.answerKey,
            choices: draft.choices,
            description: draft.description || null,
            fill_policy: draft.fillPolicy,
            label: draft.label,
            status: draft.status,
            value: valueFromDraft(draft),
          },
        });
        setDraft(draftFromAnswer(saved));
        setBaseline(JSON.stringify(draftFromAnswer(saved)));
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
        onCreated(created.answer.id, advance);
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
    <Drawer
      label={answerId ? "Edit saved answer" : "New saved answer"}
      onClose={close}
      dirty={JSON.stringify(draft) !== baseline}
      busy={mutation.isPending}
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <HelpTip text="Check the value and fill behavior before saving.">
            <button
              type="submit"
              form={formId}
              disabled={!valid || mutation.isPending || (!!answerId && !answer)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
            >
              {mutation.isPending
                ? "Saving…"
                : answerId
                  ? "Save answer"
                  : context
                    ? "Save answer and match"
                    : "Save answer"}
            </button>
          </HelpTip>
          {context && (
            <HelpTip text="Save this answer and match, then open the next question.">
              <button
                type="button"
                disabled={!valid || mutation.isPending}
                onClick={() => void save(true)}
                className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent disabled:opacity-50"
              >
                Save and review next
              </button>
            </HelpTip>
          )}
          {!valid && (
            <span className="text-xs text-ink-muted">
              Add a name and a valid answer value to save.
            </span>
          )}
        </div>
      }
    >
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
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-5"
        >
          {context && (
            <p className="rounded border border-line bg-sunken p-3 text-sm text-ink-muted">
              This answer will be saved and used for “{context.raw_question}”.
            </p>
          )}
          <AnswerEditor
            draft={draft}
            existing={!!answerId}
            questionLocked={!!context}
            onChange={setDraft}
          />
          {(answer || context) && (
            <ChangeReview
              before={
                answer
                  ? valueText(answer.value, answer.choices)
                  : "No saved answer for this question"
              }
              after={valueText(valueFromDraft(draft), draft.choices)}
              behavior={fillExplanation(draft.fillPolicy, draft.status)}
              affected={
                answer
                  ? answer.mappings.map((question) => question.raw_question)
                  : context
                    ? [context.raw_question]
                    : []
              }
            />
          )}
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
        </form>
      )}

      {answer && (
        <>
          <section aria-labelledby="answer-matches-title" className="space-y-2">
            <h3 id="answer-matches-title" className="font-semibold text-ink">
              Questions using this answer
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
          <KnowledgeHistory events={answer.events} />
        </>
      )}
    </Drawer>
  );
}
