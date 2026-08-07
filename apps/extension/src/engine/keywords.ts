// Pure keyword-policy and matching logic shared by cards and detail banners.
// Informational banners are enabled by default; highlighting and persistent hiding
// require explicit opt-in.

// One keyword finding in JD text: the normalized `label` chip plus the exact `match`
// and its `before`/`after` context, split so the banner can wrap `match` in <mark>
// without innerHTML. `before`/`after` carry a "…" when the line was clipped.
export interface KeywordFinding {
  ruleId: string;
  label: string;
  before: string;
  match: string;
  after: string;
}

// Where a signal looks. `both` = title and description.
export type SignalScope = "title" | "description" | "both";
// What a signal does when it matches. `hide` is the only PERSISTENT action — it
// records a real `hidden` event — hence off by default and gated behind the
// title-opens rule.
export type SignalAction = "banner" | "highlight" | "hide";

// The serializable, user-owned shape stored in chrome.storage. `terms` is the
// editable vocabulary, ignored for signals whose matcher is a fixed built-in
// pattern (see SIGNAL_CATALOG).
export interface KeywordSignal {
  id: string;
  enabled: boolean;
  scope: SignalScope;
  action: SignalAction;
  terms: string[];
}

export type KeywordPolicy = KeywordSignal[];

// ── Signal catalog ───────────────────────────────────────────────────────────
// The fixed set of signals a user can turn on, plus how each matches and labels.
// `default` carries only the mutable settings. Every signal reads its vocabulary from
// the editable `terms`; the optional flags below decide what may surround them.
interface SignalDef {
  id: string;
  // Human-facing name and one-line help for the settings UI.
  label: string;
  help: string;
  // true → match a count or range before the term; the label reads back the full
  // numeric value and unit (for example, "5+ years" or "3-5 years"). Otherwise
  // whole-word match, label is the word.
  numeric?: boolean;
  // true → also take an adjacent amount into the match, before or after the term, so
  // both "€2.800" and "2.800 euro" surface the figure the user is scanning for. The
  // amount is optional: a bare "euro" is still worth flagging, and a phrase that
  // restates itself ("€4500-€6000 euro") matches whole.
  currency?: boolean;
  // true → exempt from PER_RULE_CAP, for a signal whose vocabulary is open-ended and
  // so outgrows a budget sized for a focused one. Honored only while the signal sorts
  // last among the banner signals, where TOTAL_CAP is already the binding limit.
  uncapped?: boolean;
  deriveLabel: (m: RegExpMatchArray) => string;
  default: Omit<KeywordSignal, "id">;
}

export const SIGNAL_CATALOG: SignalDef[] = [
  {
    id: "experience-years",
    label: "Experience in years",
    help: "Words that follow the number e.g. years.",
    numeric: true,
    deriveLabel: (m) => `${normalizeNumericValue(m[1])} ${m[2].toLowerCase()}`,
    default: {
      enabled: true,
      scope: "description",
      action: "banner",
      terms: ["years", "year", "jaar"],
    },
  },
  {
    id: "language",
    label: "Language requirements",
    help: "Required-language wording.",
    deriveLabel: (m) => m[0].toLowerCase(),
    default: {
      enabled: true,
      scope: "description",
      action: "banner",
      terms: ["dutch", "nederlandse"],
    },
  },
  {
    id: "pay",
    label: "Pay",
    help: "Currency words or signs.",
    currency: true,
    // Whitespace between sign and figure is cosmetic, so it collapses into the chip.
    deriveLabel: (m) => m[0].replace(/\s+/g, " ").toLowerCase(),
    default: {
      enabled: true,
      scope: "description",
      action: "banner",
      terms: ["euro", "€"],
    },
  },
  {
    id: "custom-words",
    label: "Role & custom words",
    help: "e.g. “senior” or “intern” and any words you add.",
    // Seniority wording plus whatever the user adds. Must stay last among the `banner`
    // signals, which is what `uncapped` rests on.
    uncapped: true,
    deriveLabel: (m) => m[0].toLowerCase(),
    default: {
      enabled: true,
      scope: "description",
      action: "banner",
      terms: [
        "senior",
        "medior",
        "junior",
        "lead",
        "principal",
        "staff",
        "intern",
        "internship",
        "trainee",
      ],
    },
  },
  {
    id: "outline-titles",
    label: "Outline job cards",
    help: "Red-outlines a card whose title contains a word.",
    deriveLabel: (m) => m[0].toLowerCase(),
    default: {
      enabled: false,
      scope: "title",
      action: "highlight",
      terms: ["senior"],
    },
  },
  {
    id: "auto-hide-titles",
    label: "Auto-hide jobs",
    help: "Hides a job whose title starts with a word — undo under Hidden jobs.",
    deriveLabel: (m) => m[0].toLowerCase(),
    default: { enabled: false, scope: "title", action: "hide", terms: ["senior"] },
  },
];

const DEF_BY_ID = new Map(SIGNAL_CATALOG.map((d) => [d.id, d]));

// Fresh policy: informational banners enabled, persistent and negative actions off.
export function defaultPolicy(): KeywordPolicy {
  return SIGNAL_CATALOG.map((d) => ({ id: d.id, ...d.default, terms: [...d.default.terms] }));
}

// Return one validated entry per catalog signal. Unknown ids are dropped and missing
// or invalid fields use that signal's declared default.
export function sanitizePolicy(raw: unknown): KeywordPolicy {
  const stored = Array.isArray(raw) ? (raw as unknown[]) : [];
  return SIGNAL_CATALOG.map((def) => {
    const base = { id: def.id, ...def.default, terms: [...def.default.terms] };
    const found = stored.find(
      (s): s is Record<string, unknown> =>
        !!s && typeof s === "object" && (s as Record<string, unknown>).id === def.id,
    );
    if (!found) return base;
    return {
      id: def.id,
      enabled: typeof found.enabled === "boolean" ? found.enabled : base.enabled,
      scope: isScope(found.scope) ? found.scope : base.scope,
      action: isAction(found.action) ? found.action : base.action,
      // A well-formed (even empty) array is the user's edited vocabulary; a missing
      // or non-array value falls back to the signal's default terms.
      terms: Array.isArray(found.terms) ? cleanTerms(found.terms) : base.terms,
    };
  });
}

function isScope(v: unknown): v is SignalScope {
  return v === "title" || v === "description" || v === "both";
}
function isAction(v: unknown): v is SignalAction {
  return v === "banner" || v === "highlight" || v === "hide";
}
function cleanTerms(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  for (const t of v) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

// ── Live policy (per-document singleton) ─────────────────────────────────────
// The active policy the no-argument consumers read. The settings loader replaces it
// once chrome.storage has been read, and on every change. A module-level singleton is
// per-document: one content script, one policy.
//
// ⚠ Must start EMPTY, not defaultPolicy(): storage is read asynchronously and a scan
// can run first (the MutationObserver fires on the page's own render). defaultPolicy()
// is not inert — its banner signals are enabled — so seeding with it makes that scan
// match the built-in words. Empty matches nothing until the real policy lands.
let activePolicy: KeywordPolicy = [];

// Bumped on every swap, for consumers caching something derived from the policy (the
// ⚠ banner) to fold into their cache key.
let policyRevision = 0;

export function setActivePolicy(policy: KeywordPolicy): void {
  activePolicy = policy;
  policyRevision++;
}
export function getActivePolicy(): KeywordPolicy {
  return activePolicy;
}
export function getPolicyRevision(): number {
  return policyRevision;
}

// ── Matching (pure) ──────────────────────────────────────────────────────────
// Every matcher takes the policy explicitly (defaulting to the live one) so tests
// drive them with a hand-built policy and never touch storage.

function scopeCovers(scope: SignalScope, target: "title" | "description"): boolean {
  return scope === "both" || scope === target;
}

// Unicode-aware word boundaries. JS \b only knows ASCII [A-Za-z0-9_], so a term
// starting or ending with a non-Latin letter ("år", "yıl", "χρόνια") would never
// match. Every matcher using these must compile with the `u` flag.
const B_START = "(?<![\\p{L}\\p{N}_])";
const B_END = "(?![\\p{L}\\p{N}_])";

// A money figure: digits with thousands/decimal separators and an optional "k". The
// trailing boundary keeps "2000km" from reading as 2000k, and requiring digits after
// each separator keeps a sentence-ending "." out of the match.
const AMOUNT = `\\d+(?:[.,]\\d+)*k?${B_END}`;

// Numeric signals accept decimal counts and an optional explicit range separator.
// Horizontal whitespace is optional around recognized separators to tolerate
// missing spacing; excluding newlines prevents separate list items from joining.
const COUNT = "\\d+(?:[.,]\\d+)?";
const HORIZONTAL_SPACE = "[^\\S\\r\\n]*";
const RANGE_SEPARATOR = "[-–—/]|tot|to";
const RANGE_SEPARATOR_RE = new RegExp(
  `${HORIZONTAL_SPACE}(?:${RANGE_SEPARATOR})${HORIZONTAL_SPACE}`,
  "iu",
);

function normalizeNumericValue(value: string): string {
  return value.replace(RANGE_SEPARATOR_RE, "-");
}

// What may join the halves of one money phrase: spacing, optionally around a range
// separator. Nothing else — a gap carrying a word ("€4500 base plus €500 bonus") means
// two figures, and excluding newlines keeps two list items apart.
const MONEY_GLUE = `${HORIZONTAL_SPACE}(?:(?:${RANGE_SEPARATOR})${HORIZONTAL_SPACE})?`;

// Alternation of the signal's terms, each escaped so a term like "c++" matches
// literally, and word-boundaried only on the edges that are word characters. A sign
// like "€" gets no boundary there, so it still matches flush against its figure.
function termAlternation(terms: string[]): string {
  return terms
    .map((t) => {
      const start = /^[\p{L}\p{N}_]/u.test(t) ? B_START : "";
      const end = /[\p{L}\p{N}_]$/u.test(t) ? B_END : "";
      return `${start}${escapeRegExp(t)}${end}`;
    })
    .join("|");
}

// A regex source matching the signal's terms, or null when it has none and so can
// never match. The `numeric`/`currency` flags on its SignalDef decide what gets folded
// in around a term; a plain signal matches the bare word.
function bodySource(sig: KeywordSignal): string | null {
  const def = DEF_BY_ID.get(sig.id);
  if (!def || !sig.terms.length) return null;
  if (def.numeric) {
    const value = `(?:${COUNT}${HORIZONTAL_SPACE}(?:${RANGE_SEPARATOR})${HORIZONTAL_SPACE})?${COUNT}\\+?`;
    return `(${value})${HORIZONTAL_SPACE}(${sig.terms.map(escapeRegExp).join("|")})${B_END}`;
  }
  const alt = termAlternation(sig.terms);
  if (!def.currency) return `(?:${alt})`;
  // One half of a money phrase: a currency term with an amount on either side. A pay
  // line restates its figure in several of these, so the phrase repeats the half and
  // one figure stays one finding.
  const half = `(?:${AMOUNT}${HORIZONTAL_SPACE})?(?:${alt})(?:${HORIZONTAL_SPACE}${AMOUNT})?`;
  return `${half}(?:${MONEY_GLUE}${half})*`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Red-outline test: does this card title match an enabled `highlight` signal that
// covers titles? Word-boundaried, so "Backstage"/"Full Stack" don't trip it.
export function titleHighlights(title: string, policy: KeywordPolicy = activePolicy): boolean {
  return policy.some((sig) => {
    if (!sig.enabled || sig.action !== "highlight" || !scopeCovers(sig.scope, "title"))
      return false;
    const src = bodySource(sig);
    return src != null && new RegExp(src, "iu").test(title);
  });
}

// Auto-hide test: does this title OPEN with an enabled `hide` signal's term? The
// strictest match on purpose, since the action persists — a title merely mentioning
// the word mid-string ("Engineer, works with a senior team") must not auto-hide.
export function titleAutoHides(title: string, policy: KeywordPolicy = activePolicy): boolean {
  return policy.some((sig) => {
    if (!sig.enabled || sig.action !== "hide" || !scopeCovers(sig.scope, "title")) return false;
    if (!sig.terms.length) return false;
    const prefix = `^\\s*(?:${sig.terms.map(escapeRegExp).join("|")})${B_END}`;
    return new RegExp(prefix, "iu").test(title);
  });
}

// How much context to show on each side of a matched keyword, and how many findings
// to surface — enough to disambiguate ("5+ years experience" vs "founded 125 years
// ago") without turning the banner into a wall. Each cap guards a different
// crowding-out: a repeated keyword over its signal's other terms, a signal over the
// signals sorted after it, the banner over the page.
const CONTEXT = 48;
const PER_KEYWORD_CAP = 3;
const PER_RULE_CAP = 5;
const TOTAL_CAP = 15;

// Every banner-worthy keyword match in `text`, each with the context on its own
// line. Returns all matches — deduped by identical snippet, then capped per keyword,
// per signal (except an `uncapped` signal sorted last) and overall — so a real
// requirement isn't silently dropped behind a coincidental one.
// Feed it elementToText() output, whose block boundaries are already newlined, so a
// snippet never bleeds across a paragraph break. Only enabled `banner` signals
// covering the description contribute, so an inert policy yields [].
export function keywordFindings(
  text: string,
  policy: KeywordPolicy = activePolicy,
): KeywordFinding[] {
  const found: Array<KeywordFinding & { group: number; index: number }> = [];
  // Resolve the contributing signals up front: a signal's rule budget depends on
  // whether anything sorts after it, which isn't knowable mid-iteration.
  const contributing = policy
    .filter(
      (sig) => sig.enabled && sig.action === "banner" && scopeCovers(sig.scope, "description"),
    )
    .map((sig) => ({ sig, src: bodySource(sig), def: DEF_BY_ID.get(sig.id)! }))
    .filter((c): c is { sig: KeywordSignal; src: string; def: SignalDef } => c.src != null);

  for (let group = 0; group < contributing.length; group++) {
    const { sig, src, def } = contributing[group];
    const ruleCap = def.uncapped && group === contributing.length - 1 ? TOTAL_CAP : PER_RULE_CAP;
    const re = new RegExp(src, "giu");
    const seen = new Set<string>();
    const perKeyword = new Map<string, number>();
    // Counts findings kept, not matches seen, so one dropped by the per-keyword cap
    // doesn't spend the signal's budget: the scan continues to its other terms.
    let kept = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && kept < ruleCap) {
      const f = buildFinding(sig.id, def.deriveLabel, m, text);
      const key = `${f.before} ${f.match} ${f.after}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const used = perKeyword.get(f.label) ?? 0;
      if (used >= PER_KEYWORD_CAP) continue;
      perKeyword.set(f.label, used + 1);
      found.push({ ...f, group, index: m.index });
      kept++;
    }
  }
  // Group by signal (catalog order), then by document position within it, so the
  // banner reads as per-signal blocks instead of interleaving unrelated keywords by
  // where they happen to appear.
  found.sort((a, b) => a.group - b.group || a.index - b.index);
  return found.slice(0, TOTAL_CAP).map(({ group: _group, index: _index, ...f }) => f);
}

function buildFinding(
  ruleId: string,
  deriveLabel: (m: RegExpMatchArray) => string,
  m: RegExpExecArray,
  text: string,
): KeywordFinding {
  const s = m.index;
  const e = s + m[0].length;
  // Clip to the keyword's own line first, then to a fixed context width within it.
  const lineStart = text.lastIndexOf("\n", s - 1) + 1;
  let lineEnd = text.indexOf("\n", e);
  if (lineEnd === -1) lineEnd = text.length;
  const from = Math.max(lineStart, s - CONTEXT);
  const to = Math.min(lineEnd, e + CONTEXT);
  let before = text.slice(from, s).trimStart();
  let after = text.slice(e, to).trimEnd();
  if (from > lineStart) before = "…" + before;
  if (to < lineEnd) after = after + "…";
  return { ruleId, label: deriveLabel(m), before, match: m[0], after };
}
