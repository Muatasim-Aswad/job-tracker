import { copy } from "./copy";
import { ApiError, request } from "../../infra/http";
import type { PreferencesState, PreferencesPatch } from "@job-tracker/shared/api";

async function extensionSettingsRequest(init?: RequestInit): Promise<PreferencesState> {
  try {
    return await request<PreferencesState>("/settings", { ...init, cache: "no-store" });
  } catch (error) {
    throw new Error(
      error instanceof ApiError && error.status === 409
        ? copy.clientMessages.settingsChangedElsewhereReloadSettingsBeforeSavingAgain
        : copy.clientMessages.couldntLoadOrSaveExtensionSettingsCheckYourConnection,
    );
  }
}

export const api = {
  clearSearchLog: (): Promise<void> =>
    request("/search-log", { method: "DELETE", cache: "no-store" }),

  getExtensionSettings: (): Promise<PreferencesState> => extensionSettingsRequest(),

  updateExtensionSettings: (
    changes: PreferencesPatch,
    expected_revision: string,
  ): Promise<PreferencesState> =>
    extensionSettingsRequest({
      method: "PATCH",
      body: JSON.stringify({ changes, expected_revision }),
    }),
};
