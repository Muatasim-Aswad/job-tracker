import type { CaptureApply } from "./client";
import { bindingsComplete } from "./bindings";
import { answerKey } from "./model";
import type { AnswerDetail, CaptureDetail, QuestionDetail } from "./model";

interface ReviewContext {
  draft: string;
  capture: CaptureDetail | undefined;
  question: QuestionDetail | undefined;
  selectedAnswer: AnswerDetail | undefined;
  currentAnswer: AnswerDetail | undefined;
}

export function captureReviewContext({
  draft,
  capture,
  question,
  selectedAnswer,
  currentAnswer,
}: ReviewContext): string {
  return JSON.stringify({
    draft,
    capture: [capture?.id, capture?.revision, capture?.status],
    capturedQuestion: [capture?.question.id, capture?.question.revision],
    question: [question?.id, question?.revision],
    capturedMapping: [
      capture?.mapping?.id,
      capture?.mapping?.revision,
      capture?.mapping?.status,
      capture?.mapping?.answer_id,
    ],
    mapping: [
      question?.mapping?.id,
      question?.mapping?.revision,
      question?.mapping?.status,
      question?.mapping?.answer_id,
    ],
    selectedAnswer: [selectedAnswer?.id, selectedAnswer?.revision],
    currentAnswer: [
      capture?.answer?.id,
      capture?.answer?.revision,
      question?.answer?.id,
      question?.answer?.revision,
      currentAnswer?.id,
      currentAnswer?.revision,
    ],
    captureSummaries: question?.current_captures?.map((item) => [
      item.id,
      item.revision,
      item.status,
    ]),
  });
}

interface AnswerSnapshot {
  data: AnswerDetail | undefined;
  isError: boolean;
}

interface CaptureReviewReadiness {
  captureId: string;
  capture: CaptureDetail | undefined;
  question: QuestionDetail | undefined;
  captureFailed: boolean;
  questionFailed: boolean;
  currentAnswer: AnswerSnapshot;
  selectedAnswer: AnswerSnapshot;
  choiceQuestion: boolean;
  action: CaptureApply["action"] | "";
  label: string;
  key: string;
  bindings: Record<string, string>;
}

export function canReviewCapture({
  captureId,
  capture,
  question,
  captureFailed,
  questionFailed,
  currentAnswer,
  selectedAnswer,
  choiceQuestion,
  action,
  label,
  key,
  bindings,
}: CaptureReviewReadiness): boolean {
  const captureSummary = question?.current_captures?.find((item) => item.id === capture?.id);
  const coherentContext =
    !!capture &&
    !!question &&
    !captureFailed &&
    !questionFailed &&
    capture.id === captureId &&
    question.id === capture.question_id &&
    capture.question.id === question.id &&
    capture.question.revision === question.revision &&
    (capture.mapping?.id ?? null) === (question.mapping?.id ?? null) &&
    (capture.mapping?.revision ?? null) === (question.mapping?.revision ?? null) &&
    (capture.answer?.id ?? null) === (question.answer?.id ?? null) &&
    !!captureSummary &&
    capture.revision >= captureSummary.revision;

  const completeBindings =
    !choiceQuestion ||
    (action === "create_answer_and_map"
      ? question?.options
          .filter((option) => option.status === "active")
          .every((option) => !!answerKey(option.raw_label))
      : !!question &&
        !!selectedAnswer.data &&
        bindingsComplete(question.options, selectedAnswer.data.choices, bindings));
  return !!(
    coherentContext &&
    !!capture?.value &&
    capture.status === "current" &&
    !capture.question.capture_conflict &&
    !!question &&
    !question.capture_conflict &&
    (!capture.answer ||
      (!!currentAnswer.data &&
        !currentAnswer.isError &&
        currentAnswer.data.id === capture.answer.id &&
        currentAnswer.data.revision >=
          Math.max(capture.answer.revision, question.answer?.revision ?? 0))) &&
    !!action &&
    completeBindings &&
    (action === "create_answer_and_map"
      ? !!label.trim() && !!key.trim()
      : !!selectedAnswer.data && !selectedAnswer.isError) &&
    (action === "retarget_mapping" || action === "replace_option_bindings"
      ? !!capture.mapping
      : true)
  );
}
