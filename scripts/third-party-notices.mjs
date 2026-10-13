import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

function packageRoot(id) {
  const path = id.replace(/^\0/, "").split("?")[0];
  if (!path.includes("/node_modules/") || !existsSync(path)) return null;
  let directory = dirname(realpathSync(path));
  while (directory !== dirname(directory)) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name) return directory;
    directory = dirname(directory);
  }
  return null;
}

export function bundledNotices(ids) {
  const roots = new Set([...ids].map(packageRoot).filter(Boolean));
  const entries = [...roots]
    .map((root) => {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      const licenses = readdirSync(root)
        .filter((name) => /^(licen[cs]e|notice|copying)(\.|$)/i.test(name))
        .sort()
        .map((name) => {
          const text = readFileSync(join(root, name), "utf8");
          return { file: name, sha256: createHash("sha256").update(text).digest("hex"), text };
        });
      if (!licenses.length)
        throw new Error(`Bundled dependency ${pkg.name}@${pkg.version} has no license input`);
      return {
        name: pkg.name,
        version: pkg.version,
        license: pkg.license ?? "see license text",
        licenses,
      };
    })
    .sort((a, b) => (`${a.name}@${a.version}` < `${b.name}@${b.version}` ? -1 : 1));
  const inventory = entries.map(({ licenses, ...entry }) => ({
    ...entry,
    licenses: licenses.map(({ text: _text, ...license }) => license),
  }));
  const text = entries
    .map(
      (entry) =>
        `## ${entry.name}@${entry.version} (${entry.license})\n\n${entry.licenses.map((license) => `### ${license.file}\n\n${license.text.trim()}\n`).join("\n")}`,
    )
    .join("\n");
  return { inventory, text: "Bundled JavaScript and asset dependency notices\n\n" + text };
}

export function noticesPlugin(suffix = "", additionalModules = []) {
  return {
    name: "job-tracker-dependency-notices" + suffix,
    generateBundle() {
      const { inventory, text } = bundledNotices([...this.getModuleIds(), ...additionalModules]);
      this.emitFile({ type: "asset", fileName: `THIRD_PARTY_NOTICES${suffix}.txt`, source: text });
      this.emitFile({
        type: "asset",
        fileName: `THIRD_PARTY_INVENTORY${suffix}.json`,
        source: JSON.stringify(inventory, null, 2) + "\n",
      });
    },
  };
}
