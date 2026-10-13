import { ExternalLink } from "lucide-react";

// Use a compact hostname; invalid URLs retain their raw text.
function prettyHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Use Linkify for URLs embedded in prose.
export function UrlLink({
  href,
  label,
  title,
  className = "",
}: {
  href: string;
  label?: string;
  title?: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title ?? href}
      className={`inline-flex max-w-full items-center gap-1 text-violet-600 hover:underline dark:text-violet-400 ${className}`}
    >
      <span className="truncate">{label ?? prettyHost(href)}</span>
      <ExternalLink size={12} className="shrink-0" />
    </a>
  );
}
