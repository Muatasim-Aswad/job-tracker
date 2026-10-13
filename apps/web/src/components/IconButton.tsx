import type { ButtonHTMLAttributes, ReactNode } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  // The tooltip also supplies the accessible name.
  label: string;
  active?: boolean;
  // Use pressed for toggles and expanded for disclosures so active state is accessible.
  activeMeans?: "pressed" | "expanded";
  // `field` matches 38px inputs; `md` fits toolbars and `sm` fits dense headers.
  size?: "sm" | "md" | "field";
  children: ReactNode;
}

// Compact controls meet WCAG 2.2 §2.5.8 and grow for coarse pointers.
const SIZE: Record<"sm" | "md" | "field", string> = {
  sm: "h-6 w-6 pointer-coarse:h-9 pointer-coarse:w-9",
  md: "h-8 w-8 pointer-coarse:h-9 pointer-coarse:w-9",
  field: "h-[38px] w-[38px]",
};

// Callers own text color to avoid competing Tailwind tone classes.
export function IconButton({
  label,
  active,
  activeMeans = "pressed",
  size = "md",
  className = "",
  children,
  ...rest
}: Props) {
  // Plain actions must not announce a toggle state.
  const state =
    active === undefined
      ? {}
      : activeMeans === "expanded"
        ? { "aria-expanded": active }
        : { "aria-pressed": active };
  return (
    <button
      {...rest}
      {...state}
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 ${
        SIZE[size]
      } ${active ? "bg-surface-hover" : ""} ${className}`}
    >
      {children}
    </button>
  );
}
