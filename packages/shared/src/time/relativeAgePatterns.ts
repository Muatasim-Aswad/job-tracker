// Scraped and legacy evidence is untrusted. Keep these patterns linear independently
// of the whitespace normalization at their call sites.
export const AGE_RE =
  /\b(\d{1,5}|an?|one)(?:\s+|\s*\+\s*)?(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?)\b/;

export const BARE_AGE_REMAINDER_RE = /^(?:posted|reposted|listed)?[^a-z]*$/;
