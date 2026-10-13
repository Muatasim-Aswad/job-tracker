import type { KeyboardEvent } from "react";

// Use Cmd/Ctrl+Enter so multiline fields retain Enter. Stop Escape propagation
// so cancelling an inner edit does not also close its drawer.
export function formKeys(onSave: (() => void) | undefined, onCancel: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSave?.();
    }
  };
}
