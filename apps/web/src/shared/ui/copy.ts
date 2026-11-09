export const copy = {
  confirmation: { prompt: "Sure?", action: "Delete" },
  headerSearch: {
    clearFilters: "Clear filters",
  },
  inlineConfirm: {
    cancel: "Cancel",
  },
  toaster: {
    dismiss: "Dismiss",
  },

  expandableTextMessages: {
    showLess: "Show less",
    showMore: "Show more",
  },
  filterPopoverMessages: {
    filtersApplied: "Filters applied",
    filters: "Filters",
  },
  sectionHeader: {
    disclosure: (collapsed: boolean, title: string) =>
      collapsed ? `Expand ${title}` : `Collapse ${title}`,
    about: (title: string) => `About ${title}`,
  },
} as const;
