import { copy } from "./copy";
import type { DescriptionHighlight, Preferences, TitleRule } from "@job-tracker/shared/api";

export const HIGHLIGHTS: ReadonlyArray<{ id: DescriptionHighlight["id"]; label: string }> = [
  { id: "experience-years", label: copy.model.experienceInYears },
  { id: "language", label: copy.model.languageRequirements },
  { id: "pay", label: copy.model.pay },
  { id: "custom-words", label: copy.model.roleAndCustomWords },
];
export const CONDITIONS = {
  contains: copy.model.contains,
  starts_with: copy.model.startsWith,
  not_contains: copy.model.doesNotContain,
};
export const ACTIONS = {
  outline_job_card: copy.model.outlineJobCard,
  hide: copy.model.hide,
  star: copy.model.star,
  skip: copy.model.skip,
};
export const FIELD =
  "w-full min-w-0 rounded border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-line-strong focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";
export const BUTTON =
  "inline-flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-default";
export const PRIMARY_BUTTON =
  "inline-flex items-center justify-center gap-1.5 rounded border border-violet-600 bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-default";

export type KeywordDraft = { terms: string[]; input: string };
export type HighlightDraft = DescriptionHighlight & { input: string };
export type RuleDraft = TitleRule & { input: string };
export type SettingsDraft = Omit<Preferences, "description_highlights" | "title_rules"> & {
  description_highlights: HighlightDraft[];
  title_rules: RuleDraft[];
};
export function keywordTerms(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[,\n]/)
    .map((term) => term.trim())
    .filter((term) => {
      const key = term.toLowerCase();
      if (!term || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export function keywordValue(value: KeywordDraft): string[] {
  return keywordTerms([...value.terms, value.input].join("\n"));
}
export function settingsDraft(settings: Preferences): SettingsDraft {
  return {
    ...settings,
    search_diagnostics: { ...settings.search_diagnostics },
    description_highlights: settings.description_highlights.map((item) => ({
      ...item,
      terms: [...item.terms],
      input: "",
    })),
    title_rules: settings.title_rules.map((item) => ({
      ...item,
      terms: [...item.terms],
      input: "",
    })),
  };
}
export function settingsValue(draft: SettingsDraft): Preferences {
  return {
    ...draft,
    description_highlights: draft.description_highlights.map(({ input, ...item }) => ({
      ...item,
      terms: keywordValue({ ...item, input }),
    })),
    title_rules: draft.title_rules.map(({ input, ...item }) => ({
      ...item,
      terms: keywordValue({ ...item, input }),
    })),
  };
}
export function settingsValidation(settings: Preferences): string | null {
  if (settings.title_rules.some((rule) => !rule.terms.length))
    return copy.model.addAtLeastOneKeywordToEachTitleRule;
  const lists = [...settings.description_highlights, ...settings.title_rules];
  if (lists.some((item) => item.terms.length > 200 || item.terms.some((term) => term.length > 200)))
    return copy.model.useUpTo200KeywordsPerListAnd200;
  return null;
}
