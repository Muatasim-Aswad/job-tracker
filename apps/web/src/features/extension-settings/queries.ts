import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PreferencesState } from "@job-tracker/shared/api";
import { api } from "./client";

const SETTINGS_KEY = ["extension-settings"];

export function useExtensionSettings() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: api.getExtensionSettings,
    retry: false,
    gcTime: 0,
  });
  return {
    query,
    saveCached: (value: PreferencesState) => client.setQueryData(SETTINGS_KEY, value),
  };
}
