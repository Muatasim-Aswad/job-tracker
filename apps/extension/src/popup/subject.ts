// Best-effort company extraction from Gmail tab titles. When diagnostics are
// enabled, the `gmail-subject` rule records whether the suggestion led to a result.

// Strip Gmail's chrome off the title, leaving just the subject. The account tail
// carries an "@", which is what lets it go without eating a subject that itself uses
// " - ". Inbox/list views ("Inbox (3) - …") fall through and match nothing.
export function subjectOf(title: string): string {
  let s = title.replace(/\s+-\s+Gmail\s*$/i, ""); // drop the trailing " - Gmail"
  s = s.replace(/\s+-\s+\S+@\S+\s*$/i, ""); // drop the trailing " - account@host"
  return s.trim();
}

// Gmail folder/list views whose title is a mailbox name, not a single email subject
// ("Inbox", "Sent", "Search results", often with an unread count) — never a seed.
const GMAIL_LIST_VIEW =
  /^(inbox|starred|snoozed|sent|drafts|spam|trash|important|scheduled|all mail|chats|search results?)\b/i;

// Fallback to a bounded cleaned subject, rejecting mailbox titles and reply/forward prefixes.
// Company-name filtering does not apply because this fallback is a search query.
export function fallbackSeedFromSubject(title: string): string {
  let s = subjectOf(title || "");
  // Reject a mailbox/list view, whether named ("Inbox") or just a trailing "(3)" count.
  if (!s || GMAIL_LIST_VIEW.test(s) || /\(\d+\)\s*$/.test(s)) return "";
  s = s.replace(/^((re|fwd|fw|aw)\s*:\s*)+/i, ""); // strip Re:/Fwd:/Fw:/Aw: prefixes
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length > 60) {
    // Truncate at the last word boundary within 60 chars (fall back to a hard cut).
    const cut = s.slice(0, 60);
    const sp = cut.lastIndexOf(" ");
    s = (sp > 0 ? cut.slice(0, sp) : cut).trim();
  }
  return s;
}

// Common contraction stems that precede "'s" — so the possessive pattern reads
// "Sample Company's" as a company but not "Let's" / "It's" / "Here's" as one.
const CONTRACTIONS = new Set([
  "let",
  "it",
  "that",
  "there",
  "here",
  "what",
  "who",
  "she",
  "he",
  "one",
  "today",
  "tonight",
  "everyone",
  "someone",
]);

// Reject obviously-bad candidates: empty, too long to be a company, an address,
// or a webmail/notification word. Length-cap doubles as a greedy-match guard.
function looksLikeCompany(s: string): boolean {
  if (!s || s.length > 50) return false;
  if (s.includes("@")) return false;
  if (/\b(gmail|inbox|notification|noreply|no-reply|newsletter|unsubscribe)\b/i.test(s))
    return false;
  return true;
}

// Trim separators/quotes/possessives off the edges of a raw capture.
function clean(s: string): string {
  return s
    .replace(/^[\s"'“”([{]+/, "")
    .replace(/[\s"'“”)\]}.,;:!|–—-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Job-title words. The leading-segment shape ("Company - …") collides with the
// trailing one ("… - Company"): "Alpine Cycles | Deine Bewerbung" leads with the
// company, "Full Stack Engineer - Stonebridge" with the role. A leading capture
// carrying a role word is the role half, so reject it and let the trailing rule take
// the last segment.
const ROLE_WORDS =
  /\b(engineer|developer|programmer|architect|analyst|consultant|manager|intern)\b/i;

// Reject process/role opening words and let the next rule try.
// Keep industry words that can begin real company names; expand from observed bad seeds.
const REJECT_SEED_HEADS = new Set([
  "application",
  "applications",
  "confirmation",
  "interview",
  "meeting",
  "invitation",
  "invite",
  "reminder",
  "reaction",
  "regarding",
  "response",
  "update",
  "request",
  "our",
  "your",
  "thanks",
  "thank",
  "engineer",
  "developer",
  "programmer",
  "architect",
  "analyst",
  "consultant",
  "intern",
]);
export const rejectedHead = (candidate: string): boolean =>
  REJECT_SEED_HEADS.has((candidate.split(/\s+/)[0] ?? "").toLowerCase());

// Keyword tails require a capital to reject ordinary phrases; bracketed/possessive
// leads do not. Try precise keyword tails, then leading segments, then trailing separators.
const PATTERNS: {
  re: RegExp;
  needsCapital: boolean;
  possessive?: boolean;
  rejectRoles?: boolean;
}[] = [
  { re: /^\[([^\]]+)\]/, needsCapital: false }, // [Company] ...
  { re: /^\(([^)]+)\)/, needsCapital: false }, // (Company) ...
  { re: /^(.+?)'s\b/, needsCapital: false, possessive: true }, // Company's ...
  { re: /.*\bat\s+(.+)$/i, needsCapital: true }, // ... at Company
  { re: /.*\bbij\s+(.+)$/i, needsCapital: true }, // ... bij Company (Dutch)
  { re: /.*\bfrom\s+(.+)$/i, needsCapital: true }, // ... from Company
  { re: /.*\bwith\s+(.+)$/i, needsCapital: true }, // ... with Company
  { re: /.*\bto\s+(.+)$/i, needsCapital: true }, // ... to Company
  // ... interest(ed) in [joining|the|a] Company. Scoped (not bare "in"); skips the
  // filler word, stops the capture at the first , - ( | (so "Nimbus, Jordan" →
  // "Nimbus" and "joining Northwind Partners - Full Stack Developer" → "Northwind
  // Partners"), and rejects a role phrase ("the Junior Software Engineer …").
  {
    re: /\binterest(?:ed)?\s+in\s+(?:(?:joining|the|a|an)\s+)?([^,\-–—(|]+)/i,
    needsCapital: true,
    rejectRoles: true,
  },
  { re: /.*\(([^)]+)\)\s*$/, needsCapital: true }, // ... (Company) — after keyword tails so "at Sample Company (Remote)" keeps Sample Company
  // Company | ...  /  Company - ...  (leading segment, after an optional "Prefix:").
  {
    re: /^(?:[^|｜\-–—:]+:\s+)?([^|｜\-–—]+?)\s+[|｜\-–—]\s+/,
    needsCapital: true,
    rejectRoles: true,
  },
  { re: /.*\s[|｜]\s*(.+)$/, needsCapital: true }, // ... | Company (last segment)
  { re: /.*\s[-–—]\s+(.+)$/, needsCapital: true }, // ... - Company (last segment)
];

export function companyFromSubject(title: string): string {
  const subject = subjectOf(title || "");
  if (!subject) return "";
  for (const { re, needsCapital, possessive, rejectRoles } of PATTERNS) {
    const m = re.exec(subject);
    if (!m) continue;
    const candidate = clean(m[1]);
    if (needsCapital && !/[A-Z]/.test(candidate)) continue;
    if (possessive && CONTRACTIONS.has(candidate.toLowerCase())) continue;
    if (rejectRoles && ROLE_WORDS.test(candidate)) continue;
    if (rejectedHead(candidate)) continue; // generic first word → try the next rule
    if (looksLikeCompany(candidate)) return candidate;
  }
  return "";
}
