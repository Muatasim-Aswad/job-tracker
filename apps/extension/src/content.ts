// Assemble built-in and optional local adapters, then start the shared engine.
import { initializeServerConfig } from "./config.js";
import type { Adapter } from "./adapters/types";
import { setAdapters } from "./registry.js";
import { start } from "./engine.js";
import { linkedinAdapter } from "./adapters/builtin/linkedin/web.js";
import { gmailAdapter } from "./adapters/builtin/linkedin/gmail.js";

// Exclude colocated tests and their Node-only imports from the content bundle.
const localAdapterModules = import.meta.glob<Record<string, unknown>>(
  ["./adapters/local/**/*.{js,ts}", "!./adapters/local/**/*.test.{js,ts}"],
  { eager: true },
);
const localAdapters = Object.values(localAdapterModules).flatMap((mod) =>
  Object.values(mod).filter(
    (v): v is Adapter => !!v && typeof (v as Adapter).matches === "function",
  ),
);

// Local adapters take precedence over generic built-in host matches.
async function boot() {
  await initializeServerConfig();
  setAdapters([...localAdapters, linkedinAdapter, gmailAdapter]);
  start();
}

// Declarative and navigation-triggered injection can reach the same document.
// Guard against duplicate engines and allow injection before <body> exists.
const w = window as Window & { __jobTrackerBooted?: boolean };
if (!w.__jobTrackerBooted) {
  w.__jobTrackerBooted = true;
  if (document.body) void boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });
}
