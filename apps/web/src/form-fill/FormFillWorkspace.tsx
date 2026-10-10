import { useCallback, useEffect, useRef, useState } from "react";
import { AnswerDrawer } from "./AnswerDrawer";
import { AnswerList } from "./AnswerList";
import { CaptureDrawer } from "./CaptureDrawer";
import { QuestionDrawer } from "./QuestionDrawer";
import { QuestionList } from "./QuestionList";
import { canLeaveFormFill } from "./draftGuard";
import { HelpTip } from "./HelpTip";
import type { QuestionDetail } from "./model";

const URL_KEYS = new Set([
  "view",
  "section",
  "type",
  "include",
  "history",
  "answer",
  "capture",
  "question",
]);
function removeNonViewState(url: URL): boolean {
  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (!URL_KEYS.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  return changed;
}
function readState() {
  const params = new URLSearchParams(window.location.search);
  const section = params.get("section");
  const included = new Set(params.get("include")?.split(",") ?? []);
  const legacyHistory =
    params.get("history") === "cleared" ||
    (section === "dismissed" && params.get("type") === "captures");
  const legacyAll = included.has("handled") || legacyHistory;
  return {
    section: section === "answers" ? ("answers" as const) : ("review" as const),
    includeMatched: included.has("matched") || legacyAll,
    includeDismissed: included.has("dismissed") || legacyAll || section === "dismissed",
    answerId: params.get("answer"),
    captureId: params.get("capture"),
    questionId: params.get("question"),
  };
}

function stateUrl(state: ReturnType<typeof readState>) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", "form-fill");
  url.searchParams.set("section", state.section);
  url.searchParams.delete("type");
  url.searchParams.delete("history");
  const included = [
    state.includeMatched ? "matched" : null,
    state.includeDismissed ? "dismissed" : null,
  ].filter(Boolean);
  if (included.length) url.searchParams.set("include", included.join(","));
  else url.searchParams.delete("include");
  for (const [key, value] of [
    ["answer", state.answerId],
    ["capture", state.captureId],
    ["question", state.questionId],
  ] as const) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  removeNonViewState(url);
  return url;
}

export function FormFillWorkspace({ toolbarHost }: { toolbarHost?: HTMLElement | null }) {
  const [state, setState] = useState(readState);
  const [creatingAnswer, setCreatingAnswer] = useState(false);
  const [answerQuestion, setAnswerQuestion] = useState<QuestionDetail | null>(null);
  const inboxIds = useRef<string[]>([]);
  const rememberItems = useCallback((ids: string[]) => {
    inboxIds.current = ids;
  }, []);
  useEffect(() => {
    const onPopState = () => {
      setCreatingAnswer(false);
      setAnswerQuestion(null);
      setState(readState());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const url = stateUrl(readState());
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, []);

  const navigate = useCallback(
    (next: Partial<ReturnType<typeof readState>>, replace = false, handled = false) => {
      if (!handled && !canLeaveFormFill()) return false;
      const merged = { ...state, ...next };
      const url = stateUrl(merged);
      window.history[replace ? "replaceState" : "pushState"](null, "", url);
      setState(merged);
      return true;
    },
    [state],
  );

  function openAnswer(answerId: string) {
    if (navigate({ section: "answers", answerId, captureId: null, questionId: null })) {
      setCreatingAnswer(false);
      setAnswerQuestion(null);
    }
  }
  function openQuestion(questionId: string) {
    navigate({ questionId, answerId: null, captureId: null });
  }
  function nextQuestion() {
    const next = inboxIds.current.find((id) => id !== (state.questionId ?? answerQuestion?.id));
    setCreatingAnswer(false);
    setAnswerQuestion(null);
    navigate(
      { section: "review", captureId: null, answerId: null, questionId: next ?? null },
      true,
      true,
    );
  }
  function createForQuestion(question: QuestionDetail) {
    if (!canLeaveFormFill()) return;
    setAnswerQuestion(question);
    setCreatingAnswer(true);
    navigate({ answerId: null, captureId: null, questionId: null }, true, true);
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end gap-x-2 border-b border-line">
        <div role="tablist" aria-label="Form Fill sections" className="flex flex-1 flex-wrap">
          {(
            [
              [
                "review",
                "Review inbox",
                "Review a remembered value or choose what should fill this question. Each question appears once.",
              ],
              [
                "answers",
                "Saved answers",
                "Reusable answers and the questions that use them. Paused answers are hidden by default.",
              ],
            ] as const
          ).map(([section, label, help]) => (
            <HelpTip key={section} text={help}>
              <button
                type="button"
                role="tab"
                aria-selected={state.section === section}
                onClick={() =>
                  navigate({ section, answerId: null, captureId: null, questionId: null })
                }
                className={`border-b-2 px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent ${state.section === section ? "border-accent text-ink" : "border-transparent text-ink-muted"}`}
              >
                {label}
              </button>
            </HelpTip>
          ))}
        </div>
      </div>
      {state.section === "answers" ? (
        <AnswerList
          toolbarHost={toolbarHost}
          onOpen={openAnswer}
          onCreate={() => {
            if (navigate({ answerId: null, captureId: null, questionId: null })) {
              setAnswerQuestion(null);
              setCreatingAnswer(true);
            }
          }}
        />
      ) : (
        <div className="space-y-4">
          <QuestionList
            toolbarHost={toolbarHost}
            includeMatched={state.includeMatched}
            includeDismissed={state.includeDismissed}
            onIncludeMatchedChange={(includeMatched) => navigate({ includeMatched })}
            onIncludeDismissedChange={(includeDismissed) => navigate({ includeDismissed })}
            onOpen={openQuestion}
            onItemsChange={rememberItems}
          />
        </div>
      )}

      {(state.answerId || creatingAnswer) && (
        <AnswerDrawer
          key={state.answerId ?? answerQuestion?.id ?? "new"}
          answerId={state.answerId}
          questionContext={answerQuestion}
          onClose={() => {
            setCreatingAnswer(false);
            const questionId = answerQuestion?.id ?? null;
            setAnswerQuestion(null);
            navigate({ answerId: null, questionId }, true, true);
          }}
          onCreated={(answerId, advance) => {
            if (advance) {
              nextQuestion();
              return;
            }
            setCreatingAnswer(false);
            if (answerQuestion) {
              const questionId = answerQuestion.id;
              setAnswerQuestion(null);
              navigate({ questionId, answerId: null }, true, true);
            } else navigate({ section: "answers", answerId }, true, true);
          }}
          onOpenQuestion={openQuestion}
        />
      )}
      {state.captureId && (
        <CaptureDrawer
          key={state.captureId}
          captureId={state.captureId}
          onClose={() => navigate({ captureId: null }, true, true)}
          onOpenQuestion={openQuestion}
          onNext={state.section === "review" ? nextQuestion : undefined}
        />
      )}
      {state.questionId && !state.captureId && !creatingAnswer && (
        <QuestionDrawer
          key={state.questionId}
          questionId={state.questionId}
          onClose={() => navigate({ questionId: null }, true, true)}
          onCreateAnswer={createForQuestion}
          onOpenCapture={(captureId) => navigate({ captureId })}
          onNext={state.section === "review" ? nextQuestion : undefined}
        />
      )}
    </div>
  );
}
