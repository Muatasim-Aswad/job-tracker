export const copy = {
  shortcuts: {
    global: "Global",
    jumpToSearch: "Jump to search",
    addAJob: "Add a job",
    toggleStarredOnlyView: "Toggle starred-only view",
    toggleNeedsAttentionView: "Toggle needs-attention view",
    toggleHideHiddenFilter: "Toggle hide-hidden filter",
    toggleHideBlockedCompaniesFilter: "Toggle hide-blocked-companies filter",
    toggleEasyApplyOnlyView: "Toggle Easy Apply-only view",
    cycleThemeSystemLightDark: "Cycle theme (system / light / dark)",
    showThisHelp: "Show this help",
    closeAMenuDialogOrClearSearch: "Close a menu / dialog, or clear search",
    board: "Board",
    enterTheBoardThenMoveBetweenCards: "Enter the board, then move between cards",
    openDetails: "Open details",
    openThePostingLink: "Open the posting link",
    starUnstar: "Star / unstar",
    hideUnhide: "Hide / unhide",
    changeStatusOpensTheMenu: "Change status (opens the menu)",
    fromACardButtonBackToTheCard: "From a card button, back to the card",
    changeStatusMenu: "Change-status menu",
    moveBetweenOptions: "Move between options",
    applyTheHighlightedMove: "Apply the highlighted move",
    closeTheMenu: "Close the menu",
    formsEditingAJobNoteOrCustomField: "Forms — editing a job, note, or custom field",
    cancelTheEdit: "Cancel the edit",
    save: "Save",
  },

  aboutDialog: {
    version: "Version",
    revision: "Revision",
    commitTime: "Commit time",
    buildTime: "Build time",
    buildState: "Build state",
    aboutJobTracker: "About Job Tracker",
    close: "Close",
    trackJobOpportunitiesApplicationHistoryAndReusableAnswersIn:
      "Track job opportunities, application history, and reusable answers in one place.",
    runningBuild: "Running build",
    developmentBuildsCannotIdentifySourceChangesReliably:
      "Development builds cannot identify source changes reliably.",
    currentBuildCheck: "Current build check",
    serverBuild: "Server build",
    reload: "Reload",
    saveUnsavedChangesBeforeReloading: "Save unsaved changes before reloading.",
  },
  app: {
    jobTracker: "Job Tracker",
    addAJobN: "Add a job (n)",
    loadingJobs: "Loading jobs…",
    apiUnavailable: (error: string) =>
      `Couldn’t reach the API (${error}). Is the server running on :3456?`,
    isnTCapturedYet: (platform: string | undefined, platformId: string) =>
      `“${platform}:${platformId}” isn’t captured yet.`,
  },
  errorBoundary: {
    somethingBrokeWhileRendering: "Something broke while rendering.",
    reload: "Reload",
  },
  formFillNav: {
    primaryWorkspace: "Primary workspace",
    itemsNeedReview: "Items need review",
    chooseTheAnswersJobTrackerCanReuseInApplication:
      "Choose the answers Job Tracker can reuse in application forms. Review new questions here; edit your saved answers anytime.",
  },
  headerMenu: {
    navigationAndSettings: "Navigation and settings",
    itemsNeedReview: "Items need review",
    companies: "Companies",
    blockedCompanies: "Blocked companies…",
    settings: "Settings",
    extensionSettings: "Extension settings…",
    theme: "Theme: ",
    t: "t",
    keyboardShortcuts: "Keyboard shortcuts",
    about: "About",
    system: "System",
    light: "Light",
    dark: "Dark",
  },
  shortcutsDialog: {
    keyboardShortcuts: "Keyboard shortcuts",
    close: "Close",
  },

  aboutDialogMessages: {
    unverified: "Unverified",
    developmentUnverifiedSource: "Development (unverified source)",
    verifiedSource: "Verified source",
    checkingTheServersCurrentBuild: "Checking the server’s current build…",
    couldntCheckTheCurrentBuildCheckYourConnectionAnd:
      "Couldn’t check the current build. Check your connection and try again.",
    theServerHasADifferentBuildReloadToLoad: "The server has a different build. Reload to load it.",
    theServerReportsTheSameDevelopmentIdentitySourceChanges:
      "The server reports the same development identity; source changes may still differ.",
    youreRunningTheCurrentBuild: "You’re running the current build.",
    retry: "Retry",
    checkAgain: "Check again",
  },
  appMessages: {
    refreshingData: "Refreshing data…",
    refreshData: "Refresh data",
  },
  formFillNavMessages: {
    jobs: "Jobs",
    formFill: "Form Fill",
  },
  headerMenuMessages: {
    jobs: "Jobs",
    formFill: "Form Fill",
    addAJob: "Add a job",
    newAnswer: "New answer",
    refreshing: "Refreshing…",
    refreshData: "Refresh data",
  },
  buildInfoMessages: {
    invalidBuildIdentity: "Invalid build identity",
    buildCheckStopped: "Build check stopped",
    buildCheckFailed: "Build check failed",
  },
  useBuildCheck: {
    aDifferentJobTrackerBuildIsAvailableOpenAbout: (version: string) =>
      `A different Job Tracker build (${version}) is available. Open About in the menu to check and reload.`,
  },
} as const;
