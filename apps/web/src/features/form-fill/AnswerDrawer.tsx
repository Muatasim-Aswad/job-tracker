import { AnswerDrawerTitle } from "./AnswerDrawerTitle";
import { AnswerDrawerFooter } from "./AnswerDrawerFooter";
import { copy } from "./copy";
import { useEffect, useId, useState } from "react";
import { RevisionConflictPanel } from "./RevisionConflictPanel";
import {
  useCreateFormFillAnswer,
  useCreateFormFillAnswerForQuestion,
  useFormFillAnswer,
  useFormFillQuestion,
  useRemoveFormFillDetail,
  useUpdateFormFillAnswer,
} from "./queries";
import { toast } from "../../shared/toast";
import { AnswerEditor } from "./AnswerEditor";
import { AnswerFillBehavior } from "./AnswerFillBehavior";
import {
  choicePairsForQuestion,
  answerFields,
  draftForQuestion,
  draftFromAnswer,
  emptyAnswerDraft,
  valueFromDraft,
  type AnswerDraft,
} from "./answerDraft";
import { Drawer } from "./Drawer";
import { isChoiceKind, valueText, type AnswerDetail, type QuestionDetail } from "./model";
import { fillExplanation, POLICY_LABEL } from "./copy";
import { ChangeReview } from "./ChangeReview";
import { KnowledgeHistory } from "./KnowledgeHistory";

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
  const [baseAnswer, setBaseAnswer] = useState<AnswerDetail | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameBeforeEdit, setNameBeforeEdit] = useState("");
  const formId = useId();
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(questionContext ? draftForQuestion(questionContext) : emptyAnswerDraft()),
  );
  const answer = query.data;
  const dirty = JSON.stringify(draft) !== baseline;
  const mutation = answerId ? update : context ? createForQuestion : create;
  const savedDraft = baseAnswer ? draftFromAnswer(baseAnswer) : null;
  const fillChanged =
    savedDraft &&
    (["scalar", "selected", "choices", "fillPolicy", "status"] as const).some(
      (key) => JSON.stringify(draft[key]) !== JSON.stringify(savedDraft[key]),
    );
  useEffect(
    () => () => {
      if (answerId) removeDetail("answer", answerId);
      if (questionContext) removeDetail("question", questionContext.id);
    },
    [answerId, questionContext, removeDetail],
  );

  useEffect(() => {
    if (answer && baseAnswer?.id !== answer.id) {
      setDraft(draftFromAnswer(answer));
      setBaseline(JSON.stringify(draftFromAnswer(answer)));
      setBaseAnswer(answer);
    }
  }, [answer, baseAnswer]);

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

  async function saveExisting() {
    if (!answerId || !answer || !baseAnswer) return;
    const saved = await update.mutateAsync({
      answerId,
      body: {
        expected_revision: baseAnswer.revision,
        ...answerFields(draft),
        status: draft.status,
      },
    });
    setBaseAnswer(saved);
    setDraft(draftFromAnswer(saved));
    setBaseline(JSON.stringify(draftFromAnswer(saved)));
    setEditingName(false);
    setAnnouncement(copy.answerDrawerMessages.answerSaved);
    toast.info(copy.answerDrawerMessages.answerSaved);
    onClose();
  }

  async function saveMatched(question: QuestionDetail, advance: boolean) {
    const created = await createForQuestion.mutateAsync({
      questionId: question.id,
      body: {
        expected_question_revision: question.revision,
        expected_mapping_revision: question.mapping?.revision ?? null,
        ...answerFields(draft),
        bindings: isChoiceKind(draft.valueKind)
          ? choicePairsForQuestion(question).map(({ option, choiceKey }) => ({
              question_option_id: option.id,
              answer_choice_key: choiceKey,
            }))
          : [],
      },
    });
    if (!created.answer)
      throw new Error(copy.answerDrawerMessages.questionAnswerCreationReturnedNoAnswer);
    setAnnouncement(copy.answerDrawerMessages.answerAndMatchCreated);
    toast.info(copy.answerDrawerMessages.answerAndMatchCreated);
    onCreated(created.answer.id, advance);
  }

  async function saveStandalone() {
    const created = await create.mutateAsync({
      ...answerFields(draft),
      value_kind: draft.valueKind,
    });
    setAnnouncement(copy.answerDrawerMessages.answerCreated);
    toast.info(copy.answerDrawerMessages.answerCreated);
    onCreated(created.id);
  }

  async function save(advance = false) {
    if (!valid || (answerId && baseAnswer?.id !== answerId)) return;
    try {
      if (answerId && answer) return await saveExisting();
      if (context) return await saveMatched(context, advance);
      await saveStandalone();
    } catch {
      setAnnouncement(copy.answerDrawerMessages.theAnswerWasNotSaved);
    }
  }

  const discard = () => {
    setEditingName(false);
    const next = answer
      ? draftFromAnswer(answer)
      : context
        ? draftForQuestion(context)
        : emptyAnswerDraft();
    setBaseAnswer(answer ?? null);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    mutation.reset();
  };

  const finishName = () => {
    if (draft.label.trim()) setEditingName(false);
  };
  const cancelName = () => {
    setDraft((current) => ({ ...current, label: nameBeforeEdit }));
    setEditingName(false);
  };

  return (
    <Drawer
      label={
        answerId ? copy.answerDrawerMessages.editSavedAnswer : copy.answerDrawerMessages.newAnswer
      }
      backLabel={!answerId && context ? copy.answerDrawerMessages.backToQuestion : undefined}
      title={
        answer || context ? (
          <AnswerDrawerTitle
            answer={answer}
            context={context}
            label={draft.label}
            editingName={editingName}
            finishName={finishName}
            cancelName={cancelName}
            startName={() => {
              setNameBeforeEdit(draft.label);
              setEditingName(true);
            }}
            onLabelChange={(label) => setDraft({ ...draft, label })}
          />
        ) : undefined
      }
      onClose={close}
      dirty={dirty}
      busy={mutation.isPending}
      footer={
        <AnswerDrawerFooter
          valid={valid}
          pending={mutation.isPending}
          existing={!!answerId}
          hasAnswer={!!answer}
          dirty={dirty}
          hasContext={!!context}
          formId={formId}
          onAdvance={() => void save(true)}
        />
      }
    >
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {answerId && query.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">
          {copy.answerDrawer.loadingAnswer}
        </p>
      ) : answerId && query.isError ? (
        <div role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300">
          <p>{copy.answerDrawer.couldntLoadThisAnswer}</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="font-medium underline"
          >
            {copy.answerDrawer.retry}
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
          <AnswerEditor
            draft={draft}
            existing={!!answerId}
            nameInHeader={!!answerId}
            questionLocked={!!context}
            valueHelp={context?.raw_help}
            onChange={setDraft}
            afterValue={
              valid &&
              (fillChanged || context) && (
                <ChangeReview
                  before={
                    baseAnswer
                      ? valueText(baseAnswer.value, baseAnswer.choices)
                      : copy.answerDrawer.noSavedAnswerForThisQuestion
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
              )
            }
          />
          {answer && draft.status === "disabled" && answer.mappings.length > 0 && (
            <p className="rounded border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
              {copy.answerDrawer.pausedMatches(answer.mappings.length)}
            </p>
          )}
          {answer && (
            <details className="border-t border-line pt-3 text-sm text-ink-muted">
              <summary className="cursor-pointer font-medium">
                {copy.answerDrawer.manageAnswer}{" "}
                {draft.status === "active"
                  ? POLICY_LABEL[draft.fillPolicy]
                  : copy.answerDrawerMessages.paused}
              </summary>
              <div className="mt-3">
                <AnswerFillBehavior
                  policy={draft.fillPolicy}
                  status={draft.status}
                  onChange={(policy) => setDraft({ ...draft, fillPolicy: policy })}
                />
              </div>
              <label className="mt-3 block text-xs font-normal text-ink-muted">
                {copy.answerDrawer.answerState}
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value as AnswerDraft["status"] })
                  }
                  className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
                >
                  <option value="active">{copy.answerDrawer.active}</option>
                  <option value="disabled">{copy.answerDrawer.paused}</option>
                </select>
              </label>
            </details>
          )}
          <RevisionConflictPanel
            error={mutation.error}
            draft={JSON.stringify(draft, null, 2)}
            onReviewCurrent={async () => {
              if (context) {
                const current = await questionQuery.refetch();
                if (current.data) setContext(current.data);
              } else {
                const current = await query.refetch();
                if (current.data) {
                  setBaseAnswer(current.data);
                  setBaseline(JSON.stringify(draftFromAnswer(current.data)));
                }
              }
              mutation.reset();
            }}
            onDiscard={discard}
          />
        </form>
      )}

      {answer && (
        <>
          <details className="border-t border-line pt-3 text-sm text-ink-muted">
            <summary className="cursor-pointer font-medium">
              {copy.answerDrawer.questionsUsingThisAnswer(answer.mappings.length)}
            </summary>
            <div className="mt-3 space-y-2">
              {answer.mappings.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  {copy.answerDrawer.noQuestionsUseThisAnswer}
                </p>
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
                          {question.site_scope}
                          {copy.answerDrawer.match}
                          {copy.questionDetails.status[question.mapping.status]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
          <KnowledgeHistory events={answer.events} />
        </>
      )}
    </Drawer>
  );
}
