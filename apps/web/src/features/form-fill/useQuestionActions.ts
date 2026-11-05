import { useState } from "react";
import {
  usePutFormFillMapping,
  useUpdateFormFillMapping,
  useUpdateFormFillQuestion,
  useResolveFormFillCaptureConflict,
} from "./queries";
import type { useQuestionDraft } from "./useQuestionDraft";
import { toast } from "../../shared/toast";
import { copy } from "./copy";

interface Props {
  questionId: string;
  state: Pick<
    ReturnType<typeof useQuestionDraft>,
    | "question"
    | "selectedAnswer"
    | "complete"
    | "reviewed"
    | "choiceQuestion"
    | "bindings"
    | "draft"
    | "setBaseline"
    | "setReviewedContext"
    | "winnerId"
    | "setWinnerId"
    | "captures"
  >;
  onClose: () => void;
  onNext?: () => void;
}

export function useQuestionActions({ questionId, state, onClose, onNext }: Props) {
  const putMapping = usePutFormFillMapping();
  const updateMapping = useUpdateFormFillMapping();
  const updateQuestion = useUpdateFormFillQuestion();
  const resolveConflict = useResolveFormFillCaptureConflict();
  const [announcement, setAnnouncement] = useState("");
  const {
    question,
    selectedAnswer,
    complete,
    reviewed,
    choiceQuestion,
    bindings,
    draft,
    setBaseline,
    setReviewedContext,
    winnerId,
    setWinnerId,
    captures,
  } = state;

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
  const busy =
    putMapping.isPending ||
    updateMapping.isPending ||
    updateQuestion.isPending ||
    resolveConflict.isPending;
  return {
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
  };
}
