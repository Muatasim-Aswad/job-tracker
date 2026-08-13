interface Props {
  view: "jobs" | "form-fill";
  hasReview: boolean;
  onChange: (view: "jobs" | "form-fill") => void;
}

export function FormFillNav({ view, hasReview, onChange }: Props) {
  return (
    <nav
      aria-label="Primary workspace"
      className="flex rounded-md border border-line bg-surface p-0.5"
    >
      {(["jobs", "form-fill"] as const).map((item) => {
        const selected = view === item;
        return (
          <button
            key={item}
            type="button"
            aria-current={selected ? "page" : undefined}
            onClick={() => onChange(item)}
            className={`relative rounded px-3 py-1.5 text-sm font-medium ${
              selected ? "bg-surface-hover text-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            {item === "jobs" ? "Jobs" : "Form Fill"}
            {item === "form-fill" && hasReview && (
              <span
                className="ml-1.5 inline-block size-2 rounded-full bg-amber-500"
                aria-label="Items need review"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
