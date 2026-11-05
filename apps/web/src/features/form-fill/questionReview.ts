import type { AnswerDetail, CaptureDetail, QuestionDetail } from "./model";

interface ReviewContext {
  draft: string;
  question: QuestionDetail | undefined;
  selectedAnswer: AnswerDetail | undefined;
  currentAnswer: AnswerDetail | undefined;
  captures: { data: CaptureDetail | undefined }[];
}

export function questionReviewContext({
  draft,
  question,
  selectedAnswer,
  currentAnswer,
  captures,
}: ReviewContext): string {
  return JSON.stringify({
    draft,
    question: [question?.id, question?.revision],
    mapping: [question?.mapping?.id, question?.mapping?.revision],
    answer: [selectedAnswer?.id, selectedAnswer?.revision],
    currentAnswer: [
      question?.answer?.id,
      question?.answer?.revision,
      currentAnswer?.id,
      currentAnswer?.revision,
    ],
    captureSummaries: question?.current_captures?.map((capture) => [capture.id, capture.revision]),
    captures: captures.map((capture) => [capture.data?.id, capture.data?.revision]),
  });
}
