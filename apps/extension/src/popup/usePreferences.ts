import { useCallback, useEffect, useState } from "react";
import type { PreferencesPatch, PreferencesState } from "@job-tracker/shared/api";
import { loadPreferences, onPreferencesChanged, savePreferences } from "../preferences";

export function usePreferences() {
  const [state, setState] = useState<PreferencesState | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const reload = useCallback(() => {
    setError("");
    return loadPreferences()
      .then(setState)
      .catch((cause) => setError(String(cause.message || cause)));
  }, []);
  useEffect(() => {
    let active = true;
    void loadPreferences()
      .then((value) => {
        if (active) setState(value);
      })
      .catch((cause) => {
        if (active) setError(String(cause.message || cause));
      });
    const unsubscribe = onPreferencesChanged((value) => {
      if (active) setState(value);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const save = async (
    changes: PreferencesPatch,
    expectedRevision: string | null = state?.revision ?? null,
  ): Promise<boolean> => {
    if (!state || saving) return false;
    setSaving(true);
    setError("");
    try {
      setState(await savePreferences(changes, expectedRevision));
      return true;
    } catch (cause) {
      setError(String((cause as Error).message || cause));
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { state, settings: state?.settings, save, saving, error, reload };
}

export type PreferencesEditor = ReturnType<typeof usePreferences>;
