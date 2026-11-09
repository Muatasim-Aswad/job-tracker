export const copy = {
  jobAlerts: {
    open: (count: number) => `Open new jobs (${count})`,
  },
  gmail: {
    openTheUnaffectedJobsInBackgroundTabs: "Open the unaffected jobs in background tabs",
  },
  web: {
    copyTheJobTitleCompanyLinkAndDescription: "Copy the job title, company, link and description",
    posted: "Posted ",
    closedToApplications: "closed to applications",
    applicationsUnavailable: "Applications unavailable",
    blockedCompany: "blocked company",
    applicationsHaveSaturatedLinkedInStopsCountingAt: (APPLY_CLICK_CAP: number) =>
      `Applications have saturated — LinkedIn stops counting at ${APPLY_CLICK_CAP}`,
    peopleClickedApply: (count: number | string) => `${count} people clicked apply`,
    copyJobDescription: "Copy Job Description",
    nothingToCopy: "Nothing to copy",
    copied: "Copied ✓",
    copyFailed: "Copy failed",
  },
} as const;
