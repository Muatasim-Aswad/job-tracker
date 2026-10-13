// Prefer captured URLs; reconstruct stub links through the platform registry.
// Private overlays register their own platform-specific link behavior.
import { platformMeta } from "../platforms";

export function postingUrl(
  platform: string,
  platformId: string,
  storedUrl?: string | null,
): string | null {
  if (storedUrl) return storedUrl;
  return platformMeta(platform)?.buildUrl?.(platformId) ?? null;
}

// Whether the link is the real captured page rather than a reconstructed or search
// fallback, so the UI can hint that a fallback may need a click-through.
export function isDirectLink(platform: string, storedUrl?: string | null): boolean {
  return !!storedUrl || (platformMeta(platform)?.directLink ?? false);
}
