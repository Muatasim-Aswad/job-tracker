import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function buildInfo() {
  return JSON.parse(
    execFileSync("python3", [fileURLToPath(new URL("./build-metadata.py", import.meta.url))], {
      encoding: "utf8",
    }),
  );
}

export function identityPlugin(info) {
  return {
    name: "job-tracker-build-identity",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify(info, null, 2) + "\n",
      });
    },
  };
}
