export const copy = {
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
} as const;
