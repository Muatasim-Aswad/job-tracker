// Complete utility strings live here so Tailwind can scan shared popup controls
// without runtime class construction. Colors stay semantic popup tokens.
export const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-popup-focus focus-visible:outline-offset-1";
export const BUTTON =
  "rounded border border-popup-border bg-popup-surface px-3 py-1.5 text-xs text-popup-button transition-colors hover:bg-popup-hover disabled:cursor-default disabled:bg-popup-sunken disabled:text-popup-faint";
export const PRIMARY_BUTTON =
  "rounded border border-popup-primary bg-popup-primary px-3 py-1.5 text-xs text-white transition-colors hover:bg-popup-primary-hover disabled:cursor-default disabled:border-popup-primary-disabled disabled:bg-popup-primary-disabled";
export const INPUT =
  "box-border w-full rounded-md border border-popup-border bg-popup-surface px-2 py-1.5 text-[13px] text-popup-fg outline-none focus:border-popup-border-strong focus-visible:outline-2 focus-visible:outline-popup-focus focus-visible:outline-offset-1";
export const ACTION_BUTTON =
  "inline-flex items-center gap-1.5 rounded-md border border-popup-border bg-popup-surface px-2.5 py-1.5 text-xs text-popup-muted transition-colors hover:border-popup-accent hover:bg-popup-hover hover:text-popup-accent";
export const ICON = "inline-flex [&_svg]:size-3.5";
const ICON_CONTROL =
  "flex size-7 shrink-0 items-center justify-center rounded border disabled:cursor-default [&_svg]:size-3.5 " +
  FOCUS;
export const ICON_BUTTON =
  ICON_CONTROL +
  " border-popup-border bg-popup-surface text-popup-button hover:bg-popup-hover disabled:text-popup-faint";
export const PRIMARY_ICON_BUTTON =
  ICON_CONTROL +
  " border-popup-primary bg-popup-primary text-white hover:bg-popup-primary-hover disabled:border-popup-primary-disabled disabled:bg-popup-primary-disabled";
