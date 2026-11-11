export const copy = {
  settingsErrors: {
    unavailable: "Could not load settings.",
  },

  version: {
    jobTrackerCanTReachTheServerChangesAren:
      "Job Tracker — can't reach the server; changes aren't being saved",
    jobTrackerExtensionAndServerVersionsDiffer:
      "Job Tracker — extension and server versions differ",
    jobTracker: "Job Tracker",
  },
  config: {
    enterACompleteHttpOrHttpsServerAddress: "Enter a complete http:// or https:// server address.",
    useAnHttpOrHttpsServerAddressWithoutCredentials:
      "Use an http:// or https:// server address without credentials, a path, query, or fragment.",
    serverAccessWasNotGrantedYourCurrentServerIs:
      "Server access was not granted. Your current server is unchanged.",
    serverReturnedHTTP: (status: number) => `Server returned HTTP ${status}.`,
    thisAddressDidNotReturnAJobTrackerHealth:
      "This address did not return a Job Tracker health response.",
  },
  background: {
    serverChangedRetryThisAction: "Server changed; retry this action.",
  },
  preferencesStore: {
    settingsChangedElsewhereReloadAndSaveAgain:
      "Settings changed elsewhere. Reload and save again.",
    couldNotSaveOrLoadSettingsHTTP: (status: number) =>
      `Could not save or load settings (HTTP ${status}).`,
    serverChangedReloadSettings: "Server changed; reload settings.",
    settingsAreBeingSavedTryAgainShortly: "Settings are being saved; try again shortly.",
  },
  preferences: {
    serverChangedReloadSettings: "Server changed; reload settings.",
  },
} as const;
