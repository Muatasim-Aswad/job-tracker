// LinkedIn names a place two ways: cards write "City (Workplace)", while the detail
// top card writes the fuller "City, Region, Country" and shows the workplace as its
// own chip. The two wordings never overwrite each other: the detail page owns
// `location`, cards only `card_location`, and readers prefer `location`.

const WORKPLACES = ["Remote", "Hybrid", "On-site"] as const;
export type Workplace = (typeof WORKPLACES)[number];

export function parseWorkplace(text: string): Workplace | null {
  const wanted = text.trim().toLowerCase();
  return WORKPLACES.find((w) => w.toLowerCase() === wanted) ?? null;
}

// Card metadata for `jobMeta`. A key the card does not state is omitted, never sent
// as null, because card metadata is a patch and must not clear a known value.
export function cardLocationMeta(text: string | null | undefined): Record<string, string> | null {
  const raw = text?.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const suffix = raw.match(/^(.*?)\s*\(([^()]+)\)$/);
  const workplace = suffix ? parseWorkplace(suffix[2]) : null;
  const place = workplace ? suffix![1] : raw;
  const meta: Record<string, string> = {};
  if (place) meta.card_location = place;
  if (workplace) meta.workplace = workplace;
  return Object.keys(meta).length ? meta : null;
}

// Location text after the company in a "Company · Location (Workplace)" subtitle.
export function subtitlePlace(subtitle: string | undefined): string | null {
  const parts = subtitle?.split("·") ?? [];
  return parts.length > 1 ? parts.slice(1).join("·") : null;
}

export function tagCardLocation(card: HTMLElement, text: string | null | undefined) {
  const meta = cardLocationMeta(text);
  if (meta) card.dataset.jobMeta = JSON.stringify(meta);
}
