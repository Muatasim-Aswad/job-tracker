import { useEffect, useState } from "react";
import { type KeywordPolicy, SIGNAL_CATALOG } from "../engine/keywords.js";
import { loadKeywordPolicy, resetKeywordPolicy, saveKeywordPolicy } from "../engine/settings.js";
import { BUTTON, FOCUS } from "./ui";

// Edit opt-in rules by description/title scope; engine settings and matchers own persistence.
// Enter, comma, and blur add words; empty-field Backspace removes the last chip.
// Settings mode isolates those keys from search shortcuts. Reset requires a second click.

export function KeywordSettings() {
  const [policy, setPolicy] = useState<KeywordPolicy>([]);
  // In-progress add-a-word text per signal id.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    loadKeywordPolicy(setPolicy);
  }, []);

  function commit(next: KeywordPolicy) {
    setPolicy(next);
    saveKeywordPolicy(next, setPolicy);
  }

  function setEnabled(id: string, enabled: boolean) {
    commit(policy.map((s) => (s.id === id ? { ...s, enabled } : s)));
  }

  // Commit the draft text as new term(s) — comma-separated paste still works.
  function addTerms(id: string, raw: string) {
    setDrafts((d) => {
      const { [id]: _drop, ...rest } = d;
      return rest;
    });
    const added = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!added.length) return;
    commit(
      policy.map((s) => {
        if (s.id !== id) return s;
        const terms = [...s.terms];
        for (const t of added) {
          if (!terms.some((x) => x.toLowerCase() === t.toLowerCase())) terms.push(t);
        }
        return { ...s, terms };
      }),
    );
  }

  function removeTerm(id: string, term: string) {
    commit(
      policy.map((s) => (s.id === id ? { ...s, terms: s.terms.filter((t) => t !== term) } : s)),
    );
  }

  function reset() {
    setDrafts({});
    setConfirmReset(false);
    resetKeywordPolicy(setPolicy);
  }

  function row(def: (typeof SIGNAL_CATALOG)[number]) {
    const sig = policy.find((s) => s.id === def.id);
    if (!sig) return null;
    return (
      <li key={def.id} className="flex flex-col gap-1">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            className="size-[15px] shrink-0 accent-popup-accent"
            type="checkbox"
            checked={sig.enabled}
            onChange={(e) => setEnabled(def.id, e.target.checked)}
          />
          <span className="text-[13px] text-popup-fg">{def.label}</span>
        </label>
        <p className="m-0 pl-6 text-[11px] leading-snug text-popup-faint">{def.help}</p>
        {sig.enabled && (
          <div className="ml-6 flex flex-wrap items-center gap-1 rounded-md border border-popup-border bg-popup-surface px-1.5 py-1 focus-within:border-popup-accent">
            {sig.terms.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-0.5 rounded-full border border-popup-border-subtle bg-popup-hover py-px pr-0.5 pl-1.5 text-[11px] text-popup-fg"
              >
                {t}
                <button
                  className="cursor-pointer border-0 bg-transparent px-1 text-xs leading-none text-popup-faint hover:text-popup-danger"
                  aria-label={`Remove “${t}”`}
                  onClick={() => removeTerm(def.id, t)}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              className="min-w-[72px] flex-1 border-0 bg-transparent p-0.5 text-xs text-popup-fg outline-none"
              type="text"
              value={drafts[def.id] ?? ""}
              placeholder="add word…"
              aria-label={`Add a ${def.label} word`}
              onChange={(e) => setDrafts((d) => ({ ...d, [def.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTerms(def.id, e.currentTarget.value);
                } else if (e.key === "Backspace" && !e.currentTarget.value && sig.terms.length) {
                  removeTerm(def.id, sig.terms[sig.terms.length - 1]);
                }
              }}
              onBlur={(e) => addTerms(def.id, e.target.value)}
            />
          </div>
        )}
      </li>
    );
  }

  const banner = SIGNAL_CATALOG.filter((d) => d.default.action === "banner");
  const standalone = SIGNAL_CATALOG.filter((d) => d.default.action !== "banner");

  return (
    <details className="mt-1 border-t border-popup-border-subtle pt-1.5">
      <summary className="cursor-pointer list-none py-1.5 text-[10px] font-semibold uppercase tracking-wider text-popup-faint marker:hidden before:mr-1.5 before:inline-block before:content-['▸'] open:before:rotate-90">
        Keyword actions
      </summary>
      <div className="mt-1.5">
        <h4 className="mb-2.5 text-[11px] font-semibold text-popup-muted">In descriptions</h4>
        <ul className="m-0 flex list-none flex-col gap-3.5 p-0">{banner.map(row)}</ul>

        <div className="mt-3.5 border-t border-popup-border-subtle pt-3.5">
          <h4 className="mb-2.5 text-[11px] font-semibold text-popup-muted">On titles</h4>
          <ul className="m-0 flex list-none flex-col gap-3.5 p-0">{standalone.map(row)}</ul>
        </div>

        <div className="mt-3 flex justify-end">
          <button
            className={
              confirmReset
                ? "rounded border border-popup-danger-border bg-popup-danger-bg px-2 py-0.5 text-[10px] text-popup-danger " +
                  FOCUS
                : BUTTON +
                  " px-2 py-0.5 text-[10px] hover:border-popup-accent hover:text-popup-accent " +
                  FOCUS
            }
            onClick={() => (confirmReset ? reset() : setConfirmReset(true))}
            onBlur={() => setConfirmReset(false)}
            title="Turn signals off and restore the default words"
          >
            {confirmReset ? "Reset all?" : "Reset"}
          </button>
        </div>
      </div>
    </details>
  );
}
