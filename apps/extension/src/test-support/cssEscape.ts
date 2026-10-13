// jsdom lacks CSS.escape; these fixtures use render keys without CSS-special characters.
export function installCssEscape() {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s) => s };
}
