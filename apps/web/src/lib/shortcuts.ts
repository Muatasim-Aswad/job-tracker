// The single source of truth for the keyboard help sheet. The handlers live next
// to the UI they drive (App for globals, JobCard for the board, the dialogs for
// their own traps); this list only describes them, so the cheat-sheet in
// ShortcutsDialog can never drift from what's documented here — edit both together.

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
    title: "Global",
    items: [
      { keys: ["/"], label: "Jump to search" },
      { keys: ["n"], label: "Add a job" },
      { keys: ["S"], label: "Toggle starred-only view" },
      { keys: ["A"], label: "Toggle needs-attention view" },
      { keys: ["H"], label: "Toggle hide-hidden filter" },
      { keys: ["B"], label: "Toggle hide-blocked-companies filter" },
      { keys: ["E"], label: "Toggle Easy Apply-only view" },
      { keys: ["t"], label: "Cycle theme (system / light / dark)" },
      { keys: ["?"], label: "Show this help" },
      { keys: ["Esc"], label: "Close a menu / dialog, or clear search" },
    ],
  },
  {
    title: "Board",
    items: [
      { keys: ["↑", "↓", "←", "→"], label: "Enter the board, then move between cards" },
      { keys: ["Enter"], label: "Open details" },
      { keys: ["o"], label: "Open the posting link" },
      { keys: ["s"], label: "Star / unstar" },
      { keys: ["h"], label: "Hide / unhide" },
      { keys: ["m"], label: "Change status (opens the menu)" },
      { keys: ["Esc"], label: "From a card button, back to the card" },
    ],
  },
  {
    title: "Change-status menu",
    items: [
      { keys: ["↑", "↓"], label: "Move between options" },
      { keys: ["Enter"], label: "Apply the highlighted move" },
      { keys: ["Esc"], label: "Close the menu" },
    ],
  },
  {
    title: "Forms — editing a job, note, or custom field",
    items: [
      { keys: ["Esc"], label: "Cancel the edit" },
      { keys: ["⌘/Ctrl", "Enter"], label: "Save" },
    ],
  },
];
