import type { PreferencesPatch, PreferencesState } from "@job-tracker/shared/api";
import { SERVER_URL, onServerChanged, serverScope } from "./config.js";
import type { BridgeRequest, BridgeResponse } from "./messages.js";

function request(message: BridgeRequest): Promise<PreferencesState> {
  const server = SERVER_URL;
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ ...message, ...serverScope() }, (response: BridgeResponse) => {
        if (server !== SERVER_URL) return reject(new Error("Server changed; reload settings."));
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response?.ok) return reject(new Error(response?.error || "Could not load settings."));
        resolve(response.result as PreferencesState);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function loadPreferences(): Promise<PreferencesState> {
  return request({ type: "settings-get" });
}

export function savePreferences(
  changes: PreferencesPatch,
  expected_revision: string | null,
): Promise<PreferencesState> {
  return request({ type: "settings-update", changes, expected_revision });
}

export function onPreferencesChanged(
  listener: (state: PreferencesState | null) => void,
): () => void {
  const receive = (message: { type?: string; serverUrl?: string; state?: PreferencesState }) => {
    if (message.type === "settingsChanged" && message.serverUrl === SERVER_URL && message.state)
      listener(message.state);
  };
  chrome.runtime.onMessage.addListener(receive);
  const unsubscribe = onServerChanged(() => {
    listener(null);
    void loadPreferences()
      .then(listener)
      .catch(() => {});
  });
  return () => {
    chrome.runtime.onMessage.removeListener(receive);
    unsubscribe();
  };
}
