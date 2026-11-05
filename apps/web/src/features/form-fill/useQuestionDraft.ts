import { useEffect, useRef, useState } from "react";
import {
  useFormFillQuestion,
  useFormFillAnswer,
  useFormFillConflictCaptures,
  useRemoveFormFillDetail,
} from "./queries";
import { usePrivateAnswers } from "./usePrivateAnswers";
import { canReviewQuestionMatch, questionReviewContext } from "./questionReview";
import { bindingsComplete, suggestBindings } from "./bindings";

export function useQuestionDraft(questionId: string) {
  const query = useFormFillQuestion(questionId);
  const removeDetail = useRemoveFormFillDetail();
  const [answerId, setAnswerId] = useState("");
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState("");
  const [winnerId, setWinnerId] = useState("");
  const [reviewedContext, setReviewedContext] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const reviewRef = useRef<HTMLElement>(null);
  const retainedCaptureIds = useRef<string[]>([]);
  const question = query.data;
  const selectedAnswer = useFormFillAnswer(answerId || null);
  const currentAnswer = useFormFillAnswer(question?.answer?.id ?? null);
  const captureIds = question?.current_captures?.map((capture) => capture.id) ?? [];
  retainedCaptureIds.current = captureIds;
  const captures = useFormFillConflictCaptures(captureIds);
  const rememberedCapture = captures.length === 1 ? captures[0].data : undefined;
  const choiceQuestion =
    !!question &&
    ["radio", "select", "checkbox_group", "multi_select"].includes(question.control_kind);
  const complete =
    !choiceQuestion ||
    (!!selectedAnswer.data &&
      bindingsComplete(question?.options ?? [], selectedAnswer.data.choices, bindings));
  const draft = JSON.stringify({ answerId, bindings });
  const canReview = canReviewQuestionMatch({
    question,
    questionFailed: query.isError,
    selectedAnswer,
    currentAnswer,
    complete,
    captures,
  });
  const reviewContext = questionReviewContext({
    draft,
    question,
    selectedAnswer: selectedAnswer.data,
    currentAnswer: currentAnswer.data,
    captures,
  });

  const reviewed = canReview && reviewedContext === reviewContext;
  useEffect(() => {
    if (reviewed) reviewRef.current?.scrollIntoView?.({ block: "start" });
  }, [reviewed]);

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
  usePrivateAnswers(answerId, question?.answer?.id);

  useEffect(
    () => () => {
      removeDetail("question", questionId);
      for (const id of retainedCaptureIds.current) removeDetail("capture", id);
    },
    [removeDetail, questionId],
  );
  useEffect(() => {
    if (!selectedAnswer.data || !question || !choiceQuestion) return;
    setBindings((current) =>
      suggestBindings(question.options, selectedAnswer.data!.choices, current),
    );
  }, [answerId, selectedAnswer.data, question, choiceQuestion]);

  return {
    query,
    question,
    answerId,
    setAnswerId,
    bindings,
    setBindings,
    baseline,
    setBaseline,
    winnerId,
    setWinnerId,
    setReviewedContext,
    initialized,
    selectedAnswer,
    currentAnswer,
    captures,
    rememberedCapture,
    choiceQuestion,
    complete,
    draft,
    canReview,
    reviewContext,
    reviewed,
    reviewRef,
  };
}
