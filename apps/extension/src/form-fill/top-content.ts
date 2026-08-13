// Keep the existing job-card/detail engine in the manifest's top-frame entry.
// This exported wrapper prevents the bundler from coalescing two side-effect-only
// content entries while leaving content.ts and its boot sentinel unchanged.
import "../content.js";

export const topFrameContentEntry = true;
