import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineManifest } from "@crxjs/vite-plugin";

// The worker needs API host permission because content scripts proxy requests to it.
const SERVER_URL = process.env.VITE_SERVER_URL ?? "http://localhost:3456";
const API_ORIGIN = `${SERVER_URL}/api/*`;

// Local adapter hosts are optional and gitignored.
const resolve = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// The root VERSION file is the product's one release authority; package.json
// declares no version so the manifest cannot drift from the server or the tag.
const VERSION = readFileSync(resolve("../../VERSION"), "utf8").trim();
const readHosts = (rel: string): string[] =>
  existsSync(resolve(rel)) ? JSON.parse(readFileSync(resolve(rel), "utf8")) : [];
const contentMatches = [
  ...readHosts("./src/adapters/local/hosts.json"),
  ...readHosts("./src/adapters/builtin/hosts.json"),
];

export default defineManifest({
  manifest_version: 3,
  name: "Job Tracker",
  version: VERSION,
  icons: {
    16: "icons/icon16.png",
    32: "icons/icon32.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  },
  // Pinned public key → stable extension id across reloads (dev + unpacked installs).
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1Zt3fnQzOGTIsooPzMqofGIEWiq5l5XuAh1huw27MMmm/pyix4iZQV9KdQ9MlhNOwb5pxMpmT7fGmkAoZpKJBpc0ORdxoEL/TUEoH7zSCRoPLoaSdvBjMwxbrH0CMAcg8fGKQUryMKCupj0FB4ojW7wx2YXsGEqLU2R/uKZt+gOvl9umzPEbttDGJbKHlmrQvU8fSSv6355oV6mzjobJTFdHvFlLe0ewDWO9RuiZdKlLmbzQG9fnusuzmLTZBB11HRh+LeSZEvfBxgfob+ZgeDa+BM9gJ6yrppmT5YleZXBRMJWD9K9Mo8WY5EWNljBMVLo2/MTD0e6W24UaziDVrQIDAQAB", // gitleaks:allow (public key, not a secret)
  description: "Capture and triage job listings from the sites you browse — into your Job Tracker.",
  // Navigation permissions support SPA reinjection; alarms drive health checks.
  permissions: ["storage", "activeTab", "scripting", "webNavigation", "alarms"],
  host_permissions: [API_ORIGIN, ...contentMatches],
  action: { default_popup: "src/popup/index.html" },
  // Users can rebind this at chrome://extensions/shortcuts.
  commands: {
    _execute_action: {
      suggested_key: { default: "Alt+J" },
      description: "Open Job Tracker",
    },
  },
  background: { service_worker: "src/background.ts" },
  content_scripts: [
    {
      matches: contentMatches,
      // The wrapper gives CRXJS a distinct exported entry while preserving the
      // existing content engine unchanged and top-frame-only.
      js: ["src/form-fill/top-content.ts"],
      css: ["src/content.css"],
      run_at: "document_idle",
    },
    {
      // Standalone Easy Apply renders in a same-origin /preload frame, so the
      // entry covers LinkedIn frames broadly and stays inert until it finds a form.
      matches: ["https://www.linkedin.com/*"],
      js: ["src/form-fill/content.ts"],
      css: ["src/content.css"],
      run_at: "document_idle",
      all_frames: true,
    },
  ],
});
