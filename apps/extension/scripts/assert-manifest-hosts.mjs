#!/usr/bin/env node
// Public-build guard: allow only the API origin and shipped LinkedIn/Gmail hosts.
// Run against a checkout without the private adapter overlay; local hosts intentionally fail.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const manifestPath = fileURLToPath(new URL("../dist/manifest.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const serverUrl = process.env.VITE_SERVER_URL ?? "http://localhost:3456";
const allowed = new Set([
  `${serverUrl}/api/*`,
  "https://www.linkedin.com/*",
  "https://mail.google.com/*",
]);

const hosts = manifest.host_permissions ?? [];
const unexpected = hosts.filter((h) => !allowed.has(h));
const missing = [...allowed].filter((h) => !hosts.includes(h));

if (unexpected.length || missing.length) {
  console.error("Public extension manifest host_permissions mismatch.");
  if (unexpected.length) console.error("  Unexpected:", unexpected);
  if (missing.length) console.error("  Missing:", missing);
  process.exit(1);
}

console.log(`Manifest host allowlist OK (${hosts.length} hosts): ${hosts.join(", ")}`);
