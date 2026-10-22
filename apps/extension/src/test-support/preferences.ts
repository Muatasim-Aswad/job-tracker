import type { PreferencesState } from "@job-tracker/shared/api";

export function preferencesFixture(): PreferencesState {
  return {
    revision: "settings-1",
    settings: {
      description_highlights: [
        { id: "experience-years", enabled: true, terms: ["years", "year", "jaar"] },
        { id: "language", enabled: true, terms: ["dutch", "nederlandse"] },
        { id: "pay", enabled: true, terms: ["euro", "€"] },
        { id: "custom-words", enabled: true, terms: ["senior"] },
      ],
      title_rules: [],
      easy_apply_enabled: true,
      hide_mode: "remove",
      search_diagnostics: { scope: "never", expires_at: null },
    },
  };
}
