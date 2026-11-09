import type { AnswerValueKind, QuestionDetail } from "./model";

export const VALUE_KIND_LABEL: Record<AnswerValueKind, string> = {
  text: "Text",
  long_text: "Long text",
  decimal: "Number",
  boolean: "Yes / No",
  date: "Date",
  single_choice: "Single choice",
  multi_choice: "Multiple choice",
};

export const POLICY_LABEL = {
  auto: "Automatic",
  confirm_each_time: "Ask every time",
  never: "Never fill",
} as const;

export const CONTROL_LABEL: Record<QuestionDetail["control_kind"], string> = {
  text: "Short answer",
  textarea: "Long answer",
  integer: "Whole number",
  decimal: "Number",
  date: "Date",
  checkbox_boolean: "Yes or no",
  radio: "Single choice",
  select: "Dropdown",
  checkbox_group: "Multiple choices",
  multi_select: "Multiple choices",
};

export const SOURCE_LABEL = {
  user_input: "You typed this",
  confirmed_external: "You chose to remember this",
  unattributed_change: "Changed outside Job Tracker — source uncertain",
} as const;

export function fillExplanation(policy: keyof typeof POLICY_LABEL, status = "active"): string {
  if (status !== "active") return "Filling is paused for this answer.";
  if (policy === "never") return "This answer will not fill forms.";
  if (policy === "confirm_each_time") return "You will be asked before each fill.";
  return "Fills empty matched fields automatically. Existing form values stay unchanged.";
}

export const copy = {
  collectionOrder: "Order",
  questionDetails: {
    applicationForm: "Application form",
    status: { active: "active", disabled: "disabled", retired: "retired" },
  },
  answerUsage: {
    questions: (count: number) => `${count} ${count === 1 ? "question" : "questions"}`,
    seen: (site: string, count: number) =>
      `${site} • Seen ${count} ${count === 1 ? "time" : "times"}`,
    choiceValue: (label: string, index: number) =>
      `Use ${label || `choice ${index + 1}`} as the value`,
  },
  collectionSearch: {
    description: (
      count: number | null,
      loading: boolean,
      item: "question" | "answer",
      more: boolean,
    ) => {
      if (count === null)
        return loading
          ? item === "question"
            ? "Loading questions"
            : "Loading answers"
          : "Count unavailable";
      const noun =
        item === "question"
          ? count === 1
            ? "question"
            : "questions"
          : count === 1
            ? "answer"
            : "answers";
      return `${count} ${noun} ${more ? "loaded; more available" : "shown"}.`;
    },
  },
  client: {
    conflict: "This changed while you were looking at it. Your change was not applied.",
    failed: "The form-fill request could not be completed.",
  },
  answerDrawer: {
    answerName: "Answer name",
    done: "Done",
    cancel: "Cancel",
    editAnswerName: "Edit answer name",
    saveThisAnswerAndMatchThenOpenTheNext:
      "Save this answer and match, then open the next question.",
    saveAndReviewNext: "Save and review next",
    noChanges: "No changes",
    loadingAnswer: "Loading Answer…",
    couldntLoadThisAnswer: "Couldn’t load this Answer.",
    retry: "Retry",
    pausedMatches: (count: number) =>
      `This stops ${count} matched ${count === 1 ? "Question" : "Questions"} from filling. Matches and history are preserved.`,
    manageAnswer: "Manage answer ·",
    answerState: "Answer state",
    active: "Active",
    paused: "Paused",
    questionsUsingThisAnswer: (count: number) => `Questions using this answer (${count})`,
    noQuestionsUseThisAnswer: "No Questions use this Answer.",
    match: " · Match ",
    noSavedAnswerForThisQuestion: "No saved answer for this question",
  },
  answerEditor: {
    answerName: "Answer name",
    value: "Value",
    searchChoices: "Search choices",
    active: "Active",
    disabled: "Disabled",
    remove: "Remove",
    noChoicesMatchThisSearch: "No choices match this search.",
    addChoice: "Add choice",
    enterYourAnswer: "Enter your answer",
    answerDetails: "Answer details",
    valueType: "Value type",
    stableKey: "Stable key",
    generatedFromTheLabelChangeItOnlyToDistinguish:
      "Generated from the label. Change it only to distinguish answers with the same label.",
    description: "Description",
    choice: (value: number) => `Choice ${value}`,
    noValueSelected: "No value selected",
    selected: (value: string) => `Selected: ${value}`,
    selectedCount: (count: number) => `${count} selected`,
    choices: (count: number, selectedSummary: string) => `${count} choices · ${selectedSummary}`,

    choiceLabel: (value: number) => `Choice ${value} label`,
    choiceStatus: (value: number) => `Choice ${value} status`,
  },
  answerFillBehavior: {
    fillBehavior: "Fill behavior",
    automatic: "Automatic",
    askEveryTime: "Ask every time",
    neverFill: "Never fill",
  },
  answerList: {
    newAnswer: "New answer",
    savedAnswers: "Saved answers",
    searchSavedAnswers: "Search saved answers",
    savedAnswerFilters: "Saved answer filters",
    status: "Status",
    allStatuses: "All statuses",
    active: "Active",
    paused: "Paused",
    valueType: "Value type",
    allTypes: "All types",
    display: "Display",
    showDetails: "Show details",
    loadingAnswers: "Loading Answers…",
    couldntLoadAnswers: "Couldn’t load Answers.",
    retry: "Retry",
    mostRecent: "Most recent",
    mostMatchedQuestions: "Most matched questions",
    aZ: "A–Z",
    orderSavedAnswers: "Order saved answers",
  },
  answerPicker: {
    noCandidates: (searching: boolean, canCreate: boolean) => {
      if (searching)
        return canCreate
          ? "No compatible answers match your search. Try another search or create a new answer."
          : "No compatible answers match your search. Try another search.";
      return canCreate
        ? "No suggested matches. Search for another answer or create a new answer."
        : "No suggested matches. Search for another answer.";
    },
    usage: (policy: string, count: number) =>
      `${policy} · ${count} ${count === 1 ? "question" : "questions"}`,
    chooseASavedAnswer: "Choose a saved answer",
    findASavedAnswer: "Find a saved answer",
    suggestedAnswersMatchTheFieldTypeAndOptionsSearch:
      "Suggested answers match the field type and options. Search other answers with a compatible type and option count. Check the value and bindings before saving.",
    searchMatchingExistingAnswers: "Search matching existing answers",
    newAnswer: "New answer",
    loadingAnswers: "Loading answers…",
    couldntLoadAnswers: "Couldn’t load answers.",
    retry: "Retry",
    cancelAnswerSelection: "Cancel answer selection",
    loadingAnswerPreview: "Loading answer preview…",
    couldntLoadThisAnswer: "Couldn’t load this answer.",
  },
  captureDrawer: {
    reviewRememberedAnswer: "Review remembered answer",
    checkTheValueAndAffectedQuestionsBeforeSaving:
      "Check the value and affected questions before saving.",
    reviewChanges: "Review changes",
    saveTheseChangesThenOpenTheNextQuestion: "Save these changes, then open the next question.",
    saveAndReviewNext: "Save and review next",
    chooseAnActionAndCompleteAnyMissingChoiceMatches:
      "Choose an action and complete any missing choice matches.",
    loadingRememberedAnswer: "Loading remembered answer…",
    couldntLoadThisRememberedAnswer: "Couldn’t load this remembered answer.",
    retry: "Retry",
    backToQuestion: "Back to question",
    loadingQuestionAndChoices: "Loading question and choices…",
    couldntLoadTheFormChoices: "Couldn’t load the form choices.",
    rememberedValue: "Remembered value",
    thisValueHasBeenClearedOpenTheQuestionReopen:
      "This value has been cleared. Open the question, reopen it if dismissed, then enter a new value in an application form to remember it again.",
    savingReactivatesThisQuestionsMatch: "Saving reactivates this question’s match.",
    everyQuestionUsingThisSavedAnswerWillUseThe:
      "Every question using this saved answer will use the new value. No other answer is changed.",
    theSavedAnswersValueStaysUnchangedThisRememberedValue:
      "The saved answer’s value stays unchanged. This remembered value is cleared after saving.",
    thisQuestionHasConflictingRememberedValues: "This question has conflicting remembered values.",
    chooseWhichValueToKeepBeforeSavingAnAnswer:
      "Choose which value to keep before saving an answer.",
    reviewConflictingValues: "Review conflicting values",
    howToUseThisValue: "How to use this value",
    action: "Action",
    answerDetails: "Answer details",
    valueType: "Value type",
    fillBehavior: "Fill behavior",
    automatic: "Automatic",
    askEveryTime: "Ask every time",
    neverFill: "Never fill",
    answerName: "Answer name",
    stableKey: "Stable key",
    generatedFromTheLabelChangeItOnlyToDistinguish:
      "Generated from the label. Change it only to distinguish answers with the same label.",
    description: "Description",
    loadingSavedAnswer: "Loading saved answer…",
    couldntLoadTheSavedAnswer: "Couldn’t load the saved answer.",
    useASavedAnswer: "Use a saved answer",
    manageRememberedValue: "Manage remembered value",
    clearingRemovesThisRememberedValueAndStopsItsReuse:
      "Clearing removes this remembered value and stops its reuse. Your saved answer stays unchanged. Enter it again in an application form to remember it later.",
    dismissAndClearValue: "Dismiss and clear value",
    sourceDetails: "Source details",
    questionDetails: "Question details",
  },
  captureList: {
    clearedValueHistory: "Cleared value history",
    searchClearedValueHistory: "Search cleared value history",
    noClearedValuesMatchYourSearch: "No cleared values match your search.",
    noClearedValues: "No cleared values.",
    valueCleared: "Value cleared",
    viewQuestion: "View question",
    loadingClearedValueHistory: "Loading cleared value history…",
    couldnTLoadClearedValueHistory: "Couldn’t load cleared value history.",
    valuesYouDismissAppearHereWithTheirQuestionAnd:
      "Values you dismiss appear here with their question and activity history.",
  },
  changeReview: {
    affected: (count: number) =>
      `${count} ${count === 1 ? "question affected" : "questions affected"}`,
    whatWillChange: "What will change",
    before: "Before",
    afterSaving: "After saving",
  },
  collectionToolbar: {
    filters: "Filters",
  },
  drawer: {
    closeDetails: "Close details",
  },
  formFillWorkspace: {
    formFillSections: "Form Fill sections",
    reviewInbox: "Review inbox",
    reviewARememberedValueOrChooseWhatShouldFill:
      "Review a remembered value or choose what should fill this question. Each question appears once.",
    savedAnswers: "Saved answers",
    reusableAnswersAndTheQuestionsThatUseThemPaused:
      "Reusable answers and the questions that use them. Paused answers are hidden by default.",
  },
  knowledgeHistory: {
    activityHistory: "Activity history",
    previousAnswerValuesAreNotRetained: "Previous answer values are not retained.",
    noActivityYet: "No activity yet.",
  },
  listContinuation: {
    loading: "Loading…",
    couldntLoadMore: "Couldn’t load more.",
    retry: "Retry",
    loadMore: "Load more",
  },
  optionBindingEditor: {
    selectAnAnswerChoice: "Select an Answer choice",
    matchFormChoicesToAnswerChoices: "Match form choices to answer choices",
    everyFormOptionNeedsADifferentAnswerChoice:
      "Every form option needs a different Answer choice.",
    choiceMatches: "Choice matches",
    eachFormChoiceNeedsADifferentAnswerChoiceIdentical:
      "Each form choice needs a different answer choice. Identical labels can be suggested; review every match before saving.",
    suggestIdenticalLabels: "Suggest identical labels",
    searchFormChoices: "Search form choices",
    onlyUnmatchedChoices: "Only unmatched choices",
    formChoice: "Form choice",
    savedChoice: "Saved choice",
    meaningOf: (rawLabel: string) => `Meaning of ${rawLabel}`,
    ofChoicesMatched: (selectedCount: number, count: number) =>
      `${selectedCount} of ${count} choices matched`,
  },
  questionDrawer: {
    reviewQuestion: "Review question",
    reviewRememberedValue: "Review remembered value",
    checkTheAnswerValueAndFillBehaviorBeforeSaving:
      "Check the answer value and fill behavior before saving.",
    reviewMatch: "Review match",
    saveThisMatchThenOpenTheNextQuestion: "Save this match, then open the next question.",
    saveAndReviewNext: "Save and review next",
    matchEveryFormChoiceBeforeSaving: "Match every form choice before saving.",
    loadingQuestion: "Loading question…",
    couldntLoadThisQuestion: "Couldn’t load this question.",
    retry: "Retry",
    thisQuestionIsDismissedAndWillNotFill: "This question is dismissed and will not fill.",
    reopenQuestion: "Reopen question",
    rememberedValues: "Remembered values",
    conflictingValuesBlockFillingKeepingOneClearsTheOther:
      "Conflicting values block filling. Keeping one clears the other retained values.",
    loadingRememberedValues: "Loading remembered values…",
    couldntLoadEveryRememberedValue: "Couldn’t load every remembered value.",
    useOrDismissThisValue: "Use or dismiss this value",
    keepSelectedValue: "Keep selected value",
    savedAnswerForThisQuestion: "Saved answer for this question",
    anIdenticalRememberedValueIsMarkedReviewedADiffering:
      "An identical remembered value is marked reviewed. A differing remembered value stays in the inbox.",
    manageQuestion: "Manage question",
    pausingStopsFillingAndKeepsTheMatch: "Pausing stops filling and keeps the match.",
    removeThisMatchYouCanChooseAnotherSavedAnswer:
      "Remove this match. You can choose another saved answer later.",
    removeMatch: "Remove match",
    dismissThisQuestionAndClearItsCurrentRememberedValues:
      "Dismiss this question and clear its current remembered values. It will not fill until reopened.",
    dismissQuestion: "Dismiss question",
    questionDetails: "Question details",
    section: "Section",
    fieldType: "Field type",
    source: "Source",
    seen: "Seen",
  },
  questionList: {
    includeQuestions: "Include questions",
    includeQuestionsAlreadyMatchedToASavedAnswer:
      "Include questions already matched to a saved answer.",
    matched: "Matched",
    includeDismissedQuestionsOpenOneToReopenIt:
      "Include dismissed questions. Open one to reopen it.",
    dismissed: "Dismissed",
    mostRecent: "Most recent",
    mostSeen: "Most seen",
    aZ: "A–Z",
    searchQuestions: "Search questions",
    searchQuestionsSectionsOrHelp: "Search questions, sections or help",
    orderQuestions: "Order questions",
    noQuestionsMatchYourSearch: "No questions match your search.",
    youReAllCaughtUp: "You’re all caught up.",
    noQuestionsHere: "No questions here.",
    tryAnotherSearch: "Try another search.",
    newQuestionsAndRememberedValuesWillAppearHereAfter:
      "New questions and remembered values will appear here after you use a supported application form.",
    questionsObservedByTheExtensionWillAppearHere:
      "Questions observed by the extension will appear here.",
    conflictingValues: "Conflicting values",
    rememberedValue: "Remembered value",
    chooseAnAnswer: "Choose an answer",
    fillingPaused: "Filling paused",
    valueCleared: "Value cleared",
    valuesCleared: (ignoredCaptureCount: number) => `${ignoredCaptureCount} values cleared`,

    choices: (optionCount: number) => `${optionCount} choices`,
    rememberedValues: (currentCaptureCount: number) => `${currentCaptureCount} remembered values`,
    loadingQuestions: "Loading questions…",
    couldnTLoadQuestions: "Couldn’t load questions.",
  },
  reviewList: {
    listOptions: "List options",
    display: "Display",
    showQuestionDetails: "Show question details",
    showSourceDetails: "Show source details",
    retry: "Retry",
  },
  revisionConflictPanel: {
    thisChangedWhileYouWereLookingAtIt: "This changed while you were looking at it.",
    yourChangeWasNotAppliedYourDraftIsStill:
      "Your change was not applied. Your draft is still here.",
    currentServerSummary: "Current server summary",
    reviewCurrentVersion: "Review current version",
    discardMine: "Discard mine",
  },

  answerDrawerMessages: {
    answerSaved: "Answer saved.",
    questionAnswerCreationReturnedNoAnswer: "Question Answer creation returned no Answer",
    answerAndMatchCreated: "Answer and Match created.",
    answerCreated: "Answer created.",
    theAnswerWasNotSaved: "The Answer was not saved.",
    editSavedAnswer: "Edit saved answer",
    newAnswer: "New answer",
    backToQuestion: "Back to question",
    enterAnAnswerNameAndValueToSave: "Enter an answer name and value to save.",
    saveThisAnswerAndMatchItToThisQuestion: "Save this answer and match it to this question.",
    saveThisAnswerAndItsFillBehavior: "Save this answer and its fill behavior.",
    saving: "Saving…",
    saveAnswer: "Save answer",
    saveAnswerAndMatch: "Save answer and match",
    question: "Question",
    questions: "Questions",
    paused: "Paused",
  },
  answerListMessages: {
    noAnswersMatchTheseFilters: "No Answers match these filters.",
    noAnswersYet: "No Answers yet.",
    clearAFilterToSeeMore: "Clear a filter to see more.",
    createOneHereOrPromoteARememberedValueFrom:
      "Create one here or promote a remembered value from Needs review.",

    paused: "Paused",
  },
  answerPickerMessages: {
    paused: "Paused",
    question: "question",
    questions: "questions",
  },
  captureDrawerMessages: {
    rememberedValueAppliedToVerifiedKnowledge: "Remembered value applied to verified knowledge.",
    rememberedValueApplied: "Remembered value applied.",
    theRememberedValueWasNotApplied: "The remembered value was not applied.",
    rememberedValueIgnored: "Remembered value ignored.",
    rememberedValueReopened: "Remembered value reopened.",
    rememberedValueDismissedAndCleared: "Remembered value dismissed and cleared.",
    theRememberedValueWasNotChanged: "The remembered value was not changed.",
    saving: "Saving…",
    saveChanges: "Save changes",
    saveAsANewAnswer: "Save as a new answer",
    useRememberedValue: "Use remembered value",
    paused: "Paused",
    question: "question",
    questions: "questions",
  },

  drawerMessages: {
    close: "Close",
  },
  knowledgeHistoryMessages: {
    rememberedValueCleared: "Remembered value cleared",
  },
  questionDrawerMessages: {
    answerMatchedToQuestion: "Answer matched to question.",
    theMatchWasNotSaved: "The match was not saved.",
    fillBehaviorSaved: "Fill behavior saved.",
    theFillBehaviorWasNotChanged: "The fill behavior was not changed.",
    questionDismissed: "Question dismissed.",
    questionReopened: "Question reopened.",
    theQuestionWasNotChanged: "The question was not changed.",
    rememberedValueSelected: "Remembered value selected.",
    theConflictWasNotResolved: "The conflict was not resolved.",
    saving: "Saving…",
    saveMatch: "Save match",
    chooseWhichRememberedValueToKeep: "Choose which remembered value to keep",
    rememberedValue: "Remembered value",
    matched: " · Matched",
    fillingPaused: " · Filling paused",
    pauseFilling: "Pause filling",
    resumeFilling: "Resume filling",
    time: "time",
    times: "times",
  },
  questionListMessages: {
    allMatchingQuestions: "All matching questions",
    questionsToReview: "Questions to review",
  },
  revisionConflictPanelMessages: {
    copied: "Copied",
    copyMyChanges: "Copy my changes",
  },
  draftGuardMessages: {
    discardYourUnsavedChanges: "Discard your unsaved changes?",
  },
  captureActionPanel: {
    newAnswer: "New answer",
    updateSavedValue: "Update saved value",
    useAnotherAnswer: "Use another answer",
    changeChoiceMatches: "Change choice matches",
  },
  captureChangeReview: {
    noSavedAnswerForThisQuestion: "No saved answer for this question",
    thisQuestionIsDismissedReopenItBeforeFilling:
      "This question is dismissed. Reopen it before filling.",
  },
  questionManagementPanels: {
    choices: (optionCount: number) => ` · ${optionCount} choices`,
  },
  questionMatchPanel: {
    noSavedAnswerMatched: "No saved answer matched",
    thisQuestionStaysDismissedAndWillNotFillUntil:
      "This question stays dismissed and will not fill until reopened.",
  },
  model: {
    noRetainedValue: "No retained value",
    linkedInEasyApply: "LinkedIn Easy Apply",
    optionNoLongerAvailable: "Option no longer available",
  },
} as const;
