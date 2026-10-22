import { useRef } from "react";
import { X } from "lucide-react";
import { keywordValue, type KeywordDraft } from "./model";

export function KeywordField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: KeywordDraft;
  onChange: (value: KeywordDraft) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const commit = () => onChange({ terms: keywordValue(value), input: "" });
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-h-11 cursor-text flex-wrap items-center gap-1.5 rounded border border-line bg-surface p-2 focus-within:border-line-strong focus-within:ring-2 focus-within:ring-accent"
      onClick={(event) => {
        if (event.target === event.currentTarget) input.current?.focus();
      }}
    >
      {value.terms.map((term, index) => (
        <span
          key={term}
          className="inline-flex max-w-full items-center gap-1 rounded-full bg-violet-500/15 pl-2.5 pr-1 py-1 text-xs font-medium text-accent"
        >
          <span className="wrap-anywhere">{term}</span>
          <button
            type="button"
            aria-label={`Remove ${term}`}
            disabled={disabled}
            className="shrink-0 rounded-full p-0.5 hover:bg-violet-500/20 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
            onClick={() => {
              onChange({ ...value, terms: value.terms.filter((_, at) => at !== index) });
              input.current?.focus();
            }}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        ref={input}
        aria-label={label}
        value={value.input}
        disabled={disabled}
        placeholder="Add keyword…"
        className="min-w-24 flex-1 bg-transparent px-1 py-1 text-sm text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
        onChange={(event) => {
          const next = { ...value, input: event.target.value };
          onChange(/[,\n]/.test(next.input) ? { terms: keywordValue(next), input: "" } : next);
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text");
          if (!/[,\n]/.test(text)) return;
          event.preventDefault();
          onChange({
            terms: keywordValue({ terms: [...value.terms, value.input], input: text }),
            input: "",
          });
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Backspace" && !value.input && value.terms.length)
            onChange({ ...value, terms: value.terms.slice(0, -1) });
        }}
      />
    </div>
  );
}
