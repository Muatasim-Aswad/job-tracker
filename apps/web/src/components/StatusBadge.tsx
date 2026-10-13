import { STATUS_ACCENT, labelOf } from "@job-tracker/shared/funnel";
import type { Status } from "@job-tracker/shared/funnel";

const SIZE = {
  sm: "px-1.5 py-0.5 text-micro",
  md: "px-2 py-0.5 text-xs",
} as const;

// Unknown and untracked statuses retain a neutral badge.
const UNKNOWN = { bg: "bg-slate-500/15", text: "text-ink-soft" };

interface Props {
  status: string;
  size?: keyof typeof SIZE;
  className?: string;
}

export function StatusBadge({ status, size = "sm", className = "" }: Props) {
  const accent = STATUS_ACCENT[status as Status] ?? UNKNOWN;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded font-medium ${SIZE[size]} ${accent.bg} ${accent.text} ${className}`}
    >
      {labelOf(status)}
    </span>
  );
}
