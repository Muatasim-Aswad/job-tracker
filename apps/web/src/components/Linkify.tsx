import { Fragment, type ReactNode } from "react";

// The capturing group retains URLs as separate renderable segments.
const URL_SPLIT = /(https?:\/\/[^\s]+)/g;

function isUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

export function Linkify({ text }: { text: string }): ReactNode {
  return text.split(URL_SPLIT).map((part, i) =>
    isUrl(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="break-all text-violet-600 hover:underline dark:text-violet-400"
      >
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
