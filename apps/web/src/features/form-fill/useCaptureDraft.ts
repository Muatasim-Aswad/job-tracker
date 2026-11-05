import { useEffect, useRef, useState } from "react";
import type { CaptureApply } from "./client";
import {
  useFormFillCapture,
  useFormFillQuestion,
  useFormFillAnswer,
  useRemoveFormFillDetail,
} from "./queries";
import { usePrivateAnswers } from "./usePrivateAnswers";
import { canReviewCapture, captureReviewContext } from "./captureReview";
import { suggestBindings } from "./bindings";
import { answerKey, isChoiceKind } from "./model";
import { choicePairsForQuestion } from "./answerDraft";

type Action = CaptureApply["action"];

export function useCaptureDraft(captureId: string, onClose: () => void) {
  const query = useFormFillCapture(captureId);
  const questionQuery = useFormFillQuestion(query.data?.question_id ?? null);
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
  const actionValid = canReviewCapture({
    captureId,
    capture,
    question,
    captureFailed: query.isError,
    questionFailed: questionQuery.isError,
    currentAnswer,
    selectedAnswer,
    choiceQuestion,
    action,
    label,
    key,
    bindings,
  });

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

  return {
    query,
    questionQuery,
    capture,
    question,
    action,
    setAction,
    answerId,
    setAnswerId,
    label,
    setLabel,
    key,
    setKey,
    description,
    setDescription,
    fillPolicy,
    setFillPolicy,
    bindings,
    setBindings,
    setReviewedContext,
    baseline,
    initialized,
    setInitialized,
    selectedAnswer,
    currentAnswer,
    choiceQuestion,
    pairs,
    newChoices,
    draft,
    actionValid,
    reviewContext,
    reviewed,
    reviewRef,
    close,
  };
}
