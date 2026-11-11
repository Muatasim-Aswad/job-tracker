export const copy = {
  actions: {
    previousApplications: (count: number, company: string | null | undefined) =>
      `${count} previous application${count > 1 ? "s" : ""} to ${company} — open the dashboard filtered to this company`,
    hidden: (hidden: boolean, shortcut?: string) =>
      `${hidden ? "Unhide" : "Hide"}${shortcut ? ` (${shortcut})` : ""}`,
    duplicates: (count: number) =>
      `${count} possible duplicate${count > 1 ? "s" : ""} — you may have already seen this job`,
    overlap: (percent: number) =>
      `${percent}% job-description overlap with the posting you're viewing`,
    same: (labels: string[]) => `✓ Same ${labels.join(" · ")}`,
    differing: (label: string, current: string, candidate: string) =>
      `✗ ${label}: ${current} vs ${candidate}`,
    differenceDetails: (label: string, current: string, candidate: string) =>
      `${label}\nThis posting: ${current}\nCandidate: ${candidate}`,
    seen: (date: string) => `seen ${date}`,
    closed: (date: string) => `closed ${date}`,
  },
  keywords: {
    experienceInYears: "Experience in years",
    languageRequirements: "Language requirements",
    pay: "Pay",
    roleCustomWords: "Role & custom words",
    outlineJobCards: "Outline job cards",
    autoHideJobs: "Auto-hide jobs",
    wordsThatFollowTheNumberEGYears: "Words that follow the number e.g. years.",
    requiredLanguageWording: "Required-language wording.",
    currencyWordsOrSigns: "Currency words or signs.",
    eGSeniorOrInternAndAnyWordsYou: "e.g. “senior” or “intern” and any words you add.",
    redOutlinesACardWhoseTitleContainsAWord: "Red-outlines a card whose title contains a word.",
    hidesAJobWhoseTitleStartsWithAWord:
      "Hides a job whose title starts with a word — undo under Hidden jobs.",
  },
  matches: {
    possibleDuplicatesOfThisJob: "Possible duplicates of this job",
    noDescriptionCapturedYetToCompare: "No description captured yet to compare",
    view: "view",
    link: "link",
    sameJobFoldThisPostingIntoIt: "Same job — fold this posting into it",
    notAMatch: "not a match",
    differentJobStopSuggestingThisOne: "Different job — stop suggesting this one",
    postings: (listingCount: number) => ` · ${listingCount} postings`,
  },
  statusSelect: {
    applicationStatus: "Application status",
  },
  bars: {
    openInDashboard: "Open in dashboard",
    removeStar: "Remove star",
    star: "Star",
    isBlockedClickToUnblock: (name: string) => `${name} is blocked — click to unblock`,
    blockEverywhereStopCapturingAndShowingIt: (name: string) =>
      `Block “${name}” everywhere (stop capturing and showing it)`,
    skipJob: "Skip job",
    blockCompany: "Block company",
  },
  bridge: {
    serverChangedRetryThisAction: "Server changed; retry this action.",
  },
  menu: {
    openInDashboard: "Open in dashboard",
    block: (company: string) => `Block “${company}”`,
    blockCompany: "Block company",
    stopCapturingAndShowingEverywhereManageInTheDashboard: (company: string) =>
      `Stop capturing and showing ${company} everywhere (manage in the dashboard)`,
    thisCardHasNoCompanyToBlock: "This card has no company to block",
  },
  offline: {
    jobTrackerCanTReachTheServerAtChanges: (SERVER_URL: string) =>
      `Job Tracker can't reach the server at ${SERVER_URL} — changes aren't being saved`,
  },
} as const;
