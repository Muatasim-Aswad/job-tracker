import type { ReactNode } from "react";

export function KnowledgeBadge({
  children,
  warning = false,
  secondary = false,
}: {
  children: ReactNode;
  warning?: boolean;
  secondary?: boolean;
}) {
  return (
    <span
      className={`w-fit rounded-full px-2.5 py-1 text-xs ${secondary ? "font-normal" : "font-medium"} ${warning ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200" : secondary ? "bg-sunken text-ink-muted" : "bg-sunken text-ink-soft"}`}
    >
      {children}
    </span>
  );
}
