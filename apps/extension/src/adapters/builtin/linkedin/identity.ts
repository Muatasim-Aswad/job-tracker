// LinkedIn web and Gmail cards share this extension-local render-key prefix.
// Shared platform metadata owns canonical URLs, not DOM render keys.
export const LINKEDIN_PREFIX = "LI-";

// Bare, SEO-slug, and /comm/jobs/view/ URLs must resolve to the same trailing numeric ID.
// Anchor the ID at the segment end so digits inside a slug cannot win.
const JOB_PATH = /\/jobs\/view\/(?:[^/?#]*-)?(\d+)(?=[/?#]|$)/;

/** The numeric platform id in a LinkedIn job URL or path. Null when there is none. */
export function linkedinJobId(source: string): string | null {
  return source.match(JOB_PATH)?.[1] ?? null;
}

/** The prefixed render key ("LI-4444945220") for a LinkedIn job URL or path. */
export function linkedinRenderKey(source: string): string | null {
  const id = linkedinJobId(source);
  return id ? LINKEDIN_PREFIX + id : null;
}
