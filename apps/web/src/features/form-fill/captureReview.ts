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
