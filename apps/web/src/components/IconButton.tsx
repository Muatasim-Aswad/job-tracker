import type { ButtonHTMLAttributes, ReactNode } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  // Doubles as the tooltip and the accessible name — every icon button needs one.
  label: string;
  // Highlighted state (e.g. an open panel, or an active flag like starred).
  active?: boolean;
  // What `active` MEANS to assistive tech. `pressed` (the default) is a sticky on/off
  // state like hidden or starred; `expanded` is a disclosure opening a panel below —
  // Move, Correct, Undo, the listing edit/relink toggles. Without one of these,
  // `active` is a background colour and nothing more, leaving a screen-reader user
  // with no state at all.
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

// The one icon-button primitive: a square hit area with a centered icon, a shared
// focus ring, and a hover/active background. It deliberately sets no text color —
// the caller passes the tone via className, so a colored state (starred amber,
// copied green…) can never lose a Tailwind class-order fight with a base color.
// Using this everywhere keeps size, padding, alignment, focus, and the required
// tooltip identical across the UI.
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
