import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { bundledNotices } from "./third-party-notices.mjs";
import { buildInfo } from "./build-metadata.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

execFileSync("python3", [
  "-c",
  "import ast,sys; from pathlib import Path; [ast.parse(Path(file).read_text(), feature_version=(3,11)) for file in sys.argv[1:]]",
  ...["../apps/api/app/core/build_info.py", "./build-metadata.py", "./third-party-notices.py"].map(
    (file) => fileURLToPath(new URL(file, import.meta.url)),
  ),
]);

const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const extension = createRequire(new URL("../apps/extension/package.json", import.meta.url));
const { inventory, text } = bundledNotices([
  web.resolve("react"),
  web.resolve("lucide-react"),
  extension.resolve("lucide-static/icons/external-link.svg"),
]);
assert.deepEqual(
  inventory.map((item) => item.name),
  ["lucide-react", "lucide-static", "react"],
);
assert(text.includes("ISC License") && text.includes("Cole Bemis") && text.includes("MIT License"));
assert(
  inventory.every((entry) =>
    entry.licenses.every((license) => /^[0-9a-f]{64}$/.test(license.sha256)),
  ),
);
assert.equal(typeof buildInfo().dev, "boolean");
console.log("identity and bundled license input tests OK");
