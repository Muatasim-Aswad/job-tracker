import { SERVER_URL } from "../config";
import { FOCUS } from "./ui";

export function KeywordSettings() {
  return (
    <div className="mt-1 border-t border-popup-border-subtle pt-1.5">
      <a
        href={`${SERVER_URL}/?view=jobs&settings=extension`}
        target="_blank"
        rel="noopener noreferrer"
        className={
          "inline-flex items-center gap-1 py-1 text-xs text-popup-accent hover:underline " + FOCUS
        }
      >
        Manage keyword highlights and rules <span aria-hidden="true">↗</span>
      </a>
    </div>
  );
}
