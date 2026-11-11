import { copy } from "./copy";
// Help text lives here; update it with handlers in App, JobCard, and dialogs.

export interface Shortcut {
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: copy.shortcuts.global,
    items: [
      { keys: ["/"], label: copy.shortcuts.jumpToSearch },
      { keys: ["n"], label: copy.shortcuts.addAJob },
      { keys: ["S"], label: copy.shortcuts.toggleStarredOnlyView },
      { keys: ["A"], label: copy.shortcuts.toggleNeedsAttentionView },
      { keys: ["H"], label: copy.shortcuts.toggleHideHiddenFilter },
      { keys: ["B"], label: copy.shortcuts.toggleHideBlockedCompaniesFilter },
      { keys: ["E"], label: copy.shortcuts.toggleEasyApplyOnlyView },
      { keys: ["t"], label: copy.shortcuts.cycleThemeSystemLightDark },
      { keys: ["?"], label: copy.shortcuts.showThisHelp },
      { keys: ["Esc"], label: copy.shortcuts.closeAMenuDialogOrClearSearch },
    ],
  },
  {
    title: copy.shortcuts.board,
    items: [
      { keys: ["↑", "↓", "←", "→"], label: copy.shortcuts.enterTheBoardThenMoveBetweenCards },
      { keys: ["Enter"], label: copy.shortcuts.openDetails },
      { keys: ["o"], label: copy.shortcuts.openThePostingLink },
      { keys: ["s"], label: copy.shortcuts.starUnstar },
      { keys: ["h"], label: copy.shortcuts.hideUnhide },
      { keys: ["m"], label: copy.shortcuts.changeStatusOpensTheMenu },
      { keys: ["Esc"], label: copy.shortcuts.fromACardButtonBackToTheCard },
    ],
  },
  {
    title: copy.shortcuts.changeStatusMenu,
    items: [
      { keys: ["↑", "↓"], label: copy.shortcuts.moveBetweenOptions },
      { keys: ["Enter"], label: copy.shortcuts.applyTheHighlightedMove },
      { keys: ["Esc"], label: copy.shortcuts.closeTheMenu },
    ],
  },
  {
    title: copy.shortcuts.formsEditingAJobNoteOrCustomField,
    items: [
      { keys: ["Esc"], label: copy.shortcuts.cancelTheEdit },
      { keys: ["⌘/Ctrl", "Enter"], label: copy.shortcuts.save },
    ],
  },
];
