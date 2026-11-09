export const copy = {
  manualField: {
    applicationStep: "Application step",
  },
  summary: {
    tally: (counts: {
      filled: number;
      matching: number;
      attention: number;
      manual: number;
      remembered: number;
      cleared: number;
      kept: number;
      reverted: number;
    }) => {
      let text = `${counts.filled} filled · ${counts.matching} already match · ${counts.attention} needs attention · ${counts.manual} manual`;
      if (counts.remembered > 0) text += ` · ${counts.remembered} remembered`;
      if (counts.cleared > 0) text += ` · ${counts.cleared} cleared`;
      if (counts.kept > 0) text += ` · ${counts.kept} kept`;
      if (counts.reverted > 0) text += ` · ${counts.reverted} reverted`;
      return text;
    },
    field: (prompt: string, label: string) => `${prompt}: ${label}`,
    detail: (text: string) => ` — ${text}`,
  },
  presentation: {
    jobTrackerNeverContinuesOrSubmitsThisApplication:
      "Job Tracker never continues or submits this application.",
    undoAllFills: "Undo all fills",
    openInDashboard: "Open in dashboard",
    ariaLabel: "aria-label",
    jobTracker: (label: string) => `Job Tracker: ${label}`,
    jobTracker2: "Job Tracker",
  },
  scanner: {
    completeThisManually: "Complete this manually",
    waitingForNumericValidation: "Waiting for numeric validation",
    couldNotRememberThisChoice: "Could not remember this choice",
    couldNotCheckThisField: "Could not check this field",
    fieldChangedBeforeFilling: "Field changed before filling",
    filledValueNeedsAttention: "Filled value needs attention",
    filledFromARememberedValue: "Filled from a remembered value",
    filledFromVerifiedAnswer: "Filled from verified answer",
    alreadyMatchesRememberedValue: "Already matches remembered value",
    alreadyMatchesYourAnswer: "Already matches your answer",
    existingValueKept: "Existing value kept",
    existingValueDiffers: "Existing value differs",
    useMyAnswer: "Use my answer",
    keepExisting: "Keep existing",
    rememberExisting: "Remember existing",
    noFillActionIsAvailable: "No fill action is available",
    fillInstructionIsIncompatible: "Fill instruction is incompatible",
    couldNotVerifyTheFilledValue: "Could not verify the filled value",
    noExactSuggestionToSelect: "No exact suggestion to select",
    waitingToRememberThisChange: "Waiting to remember this change",
    confirmBeforeFilling: "Confirm before filling",
    confirm: "Confirm",
    reviewRememberedValues: "Review remembered values",
    notFilledReviewNeeded: "Not filled — review needed",
    ignoredInJobTracker: "Ignored in Job Tracker",
    existingValuePreserved: "Existing value preserved",
    needsYourAnswer: "Needs your answer",
    revert: "Revert",
    jobTrackerFillReverted: "Job Tracker fill reverted",
    rememberedValueCleared: "Remembered value cleared",
    rememberedForThisExactQuestion: "Remembered for this exact question",
    couldNotRememberThisValue: "Could not remember this value",
    thisValueWillBeRememberedOnlyAfterValidationSucceeds:
      "This value will be remembered only after validation succeeds.",
    itsCurrentOptionIdentityIsIncomplete: "Its current option identity is incomplete.",
    theHostReportedAValidationErrorJobTrackerWill:
      "The host reported a validation error. Job Tracker will not retry it.",
    theCurrentValueWasPreserved: "The current value was preserved.",
    theLatestFormValueWasPreserved: "The latest form value was preserved.",
    completeThisFieldManually: "Complete this field manually.",
    jobTrackerWillNotRetryThisField: "Job Tracker will not retry this field.",
    changeThisFieldAgainToRetry: "Change this field again to retry.",
    waitingForThisNewQuestionToFinishRendering:
      "Waiting for this new question to finish rendering.",
    jobTrackerCouldNotIdentifyThisJobSafely: "Job Tracker could not identify this job safely.",
    existingValuesWereLeftUntouched: "Existing values were left untouched.",
  },
  linkedin: {
    thisControlShapeIsNotSupported: "This control shape is not supported.",
    questionTextCouldNotBeIdentifiedSafely: "Question text could not be identified safely.",
    profileEntriesMustBeReviewedManually: "Profile entries must be reviewed manually.",
    chooseATypeaheadSuggestionManually: "Choose a typeahead suggestion manually.",
    thisSensitiveControlIsNeverFilled: "This sensitive control is never filled.",
    multipleSelectionControlsMustBeReviewedManually:
      "Multiple-selection controls must be reviewed manually.",
    theSelectedOptionCouldNotBeIdentifiedSafely:
      "The selected option could not be identified safely.",
    noSelectableOptionsAreAvailableYet: "No selectable options are available yet.",
    thisListHasTooManyOptionsToCheck: "This list has too many options to check.",
    thisRadioGroupIsUnclassified: "This radio group is unclassified.",
    thisRadioGroupCouldNotBeIdentifiedSafely: "This radio group could not be identified safely.",
  },
} as const;
