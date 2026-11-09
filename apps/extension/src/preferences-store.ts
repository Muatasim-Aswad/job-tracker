import { copy } from "./copy";
import type { PreferencesPatch, PreferencesState } from "@job-tracker/shared/api";

export function createPreferencesStore(
  fetchApi: (path: string, init?: RequestInit) => Promise<Response>,
  publish: (state: PreferencesState) => void,
) {
  let cached: PreferencesState | null = null;
  let pending: Promise<PreferencesState> | undefined;
  let writing: Promise<PreferencesState> | undefined;
  let generation = 0;

  async function api(path: string, init?: RequestInit): Promise<PreferencesState> {
    const response = await fetchApi(path, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? copy.preferencesStore.settingsChangedElsewhereReloadAndSaveAgain
          : copy.preferencesStore.couldNotSaveOrLoadSettingsHTTP(response.status),
      );
    return response.json();
  }

  function accept(state: PreferencesState, epoch: number): PreferencesState {
    if (epoch !== generation) throw new Error(copy.preferencesStore.serverChangedReloadSettings);
    const changed = JSON.stringify(cached) !== JSON.stringify(state);
    cached = state;
    if (changed) publish(state);
    return state;
  }

  function get(force = false): Promise<PreferencesState> {
    if (writing) return writing;
    if (pending) return pending;
    if (cached && !force) return Promise.resolve(cached);
    const epoch = generation;
    const operation = api("/settings").then((state) => accept(state, epoch));
    pending = operation;
    void operation
      .finally(() => {
        if (pending === operation) pending = undefined;
      })
      .catch(() => {});
    return operation;
  }

  function update(
    changes: PreferencesPatch,
    expected_revision: string | null,
  ): Promise<PreferencesState> {
    if (writing)
      return Promise.reject(new Error(copy.preferencesStore.settingsAreBeingSavedTryAgainShortly));
    const epoch = generation;
    const preceding = pending;
    const operation = (async () => {
      await preceding?.catch(() => {});
      if (epoch !== generation) throw new Error(copy.preferencesStore.serverChangedReloadSettings);
      const state = await api("/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes, expected_revision }),
      });
      return accept(state, epoch);
    })();
    writing = operation;
    void operation
      .finally(() => {
        if (writing === operation) writing = undefined;
      })
      .catch(() => {});
    return operation;
  }

  return {
    get,
    update,
    reset: () => {
      generation++;
      cached = null;
      pending = writing = undefined;
    },
  };
}
