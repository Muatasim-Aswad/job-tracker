export const copy = {
  extensionSettingsDialog: {
    closeExtensionSettings: "Close settings",
    couldntLoadExtensionSettingsCheckYourConnectionAndTry:
      "Couldn’t load extension settings. Check your connection and try again.",
    retry: "Retry",
    loadingSettings: "Loading settings…",
  },
  keywordField: {
    addKeyword: "Add keyword…",
    remove: (term: string) => `Remove ${term}`,
  },
  searchDiagnostics: {
    searchDiagnostics: "Search diagnostics",
    captureSearchDiagnostics: "Capture search diagnostics",
    aboutSearchDiagnostics: "About search diagnostics",
    never: "Never",
    for30Minutes: "For 30 minutes",
    always: "Always",
    storedSearchDiagnosticsCleared: "Stored search diagnostics cleared.",
    couldnTClearSearchDiagnosticsCheckYourConnectionAnd:
      "Couldn’t clear search diagnostics. Check your connection and try again.",
    whenActiveStoresThePageHostAutomaticSearchSeed:
      "When active, stores the page host, automatic search seed and extraction rule, result counts, replacement query, and opened job on this server. Keeps the newest 1,000 diagnostic rows.",
  },
  settingsForm: {
    jobBrowsing: "Job browsing",
    fillEasyApplyForms: "Fill Easy Apply forms",
    filteredJobs: "Filtered jobs",
    dimJobCards: "Dim job cards",
    hideJobCards: "Hide job cards",
    descriptionHighlights: "Description highlights",
    highlightMatchingWordsInJobDescriptionsForExperienceLanguage:
      "Highlight matching words in job descriptions for experience, language, pay, and custom terms. These highlights do not change a job’s status or visibility.",
    applyThisRuleThenSaveSettingsToSyncYour:
      "Apply this rule, then Save settings to sync your changes.",
    cancelEditing: "Cancel editing",
    applyRule: "Apply rule",
    close: "Close",
    editTitleRule: "Edit title rule",
    newTitleRule: "New title rule",
    keywords: (label: string) => `${label} keywords`,
  },
  titleRules: {
    titleRuleEditor: "Title rule editor",
    ifTitle: "If title",
    titleCondition: "Title condition",
    anyOf: "any of",
    ruleKeywords: "Rule keywords",
    then: "Then",
    ruleAction: "Rule action",
    keywordActions: "Keyword actions",
    matchJobTitlesAgainstKeywordAlternativesToOutlineHide:
      "Match job titles against keyword alternatives to outline, hide, star, or skip jobs. Matching ignores case and respects word boundaries. Disabling a rule does not undo actions already recorded.",
    addRule: "Add rule",
    noTitleRulesAddOneToOutlineHideStar:
      "No title rules. Add one to outline, hide, star, or skip matching jobs.",
    ifTitle2: "If title ",
    anyOfTheseThen: " any of these, then",
    enableRule: (value: string) => `Enable rule: ${value}`,
    editRule: (value: string) => `Edit rule: ${value}`,
    deleteRule: (value: string) => `Delete rule: ${value}`,
  },

  extensionSettingsDialogMessages: {
    discardUnsavedExtensionSettings: "Discard unsaved extension settings?",
    settingsReloaded: "Settings reloaded.",
    couldntReloadSettingsCheckYourConnectionAndTryAgain:
      "Couldn’t reload settings. Check your connection and try again.",
    extensionSettings: "Settings",
    keywordActions: "Keyword actions",
    sharedWithExtensionsConnectedToThisServer:
      "Shared across dashboards and extensions connected to this server.",
  },
  searchDiagnosticsMessages: {
    clearAllStoredSearchDiagnosticsThisCannotBeUndone:
      "Clear all stored search diagnostics? This cannot be undone.",
    clearing: "Clearing…",
    clearStoredData: "Clear stored data",
  },
  settingsFormMessages: {
    couldntSaveSettingsTryAgain: "Couldn’t save settings. Try again.",
    reloading: "Reloading…",
    reloadSettings: "Reload settings",
    settingsSaved: "Settings saved.",
    unsavedChanges: "Unsaved changes",
    saving: "Saving…",
    saveSettings: "Save settings",
  },
  clientMessages: {
    settingsChangedElsewhereReloadSettingsBeforeSavingAgain:
      "Settings changed elsewhere. Reload settings before saving again.",
    couldntLoadOrSaveExtensionSettingsCheckYourConnection:
      "Couldn’t load or save extension settings. Check your connection and try again.",
  },
  model: {
    experienceInYears: "Experience in years",
    languageRequirements: "Language requirements",
    pay: "Pay",
    roleAndCustomWords: "Role and custom words",
    contains: "contains",
    startsWith: "starts with",
    doesNotContain: "does not contain",
    outlineJobCard: "Outline job card",
    hide: "Hide",
    star: "Star",
    skip: "Skip",
    addAtLeastOneKeywordToEachTitleRule: "Add at least one keyword to each title rule.",
    useUpTo200KeywordsPerListAnd200:
      "Use up to 200 keywords per list and 200 characters per keyword.",
  },
  sectionHelp: {
    about: (title: string) => `About ${title}`,
  },
} as const;
