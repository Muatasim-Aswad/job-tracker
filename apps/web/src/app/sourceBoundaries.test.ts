import { posix } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Public source only: overlay discovery is checked without opening installed private modules.
const sources = import.meta.glob<string>(
  [
    "../**/*.ts",
    "../**/*.tsx",
    "!../**/*.test.*",
    "!../**/*.d.ts",
    "!../**/local/**",
    "!../test/**",
    "!../**/testFixtures.ts",
  ],
  { eager: true, query: "?raw", import: "default" },
);

type Layer = "app" | "features" | "infra" | "shared" | "config" | "platforms";
const allowed: Record<Layer, readonly Layer[]> = {
  app: ["app", "features", "infra", "shared", "config", "platforms"],
  features: ["features", "infra", "shared", "config", "platforms"],
  infra: ["infra", "shared", "config"],
  shared: ["shared"],
  config: ["config", "shared"],
  platforms: ["platforms", "shared", "config"],
};

function layer(path: string): Layer | undefined {
  const owner = path.split("/")[0].replace(/\.[^.]+$/, "");
  return Object.hasOwn(allowed, owner) ? (owner as Layer) : undefined;
}

function imports(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      if (ts.isStringLiteral(node.argument.literal)) specifiers.push(node.argument.literal.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return specifiers;
}

function violations(path: string, source: string): string[] {
  const owner = layer(path);
  if (!owner) return [];
  return imports(path, source).flatMap((specifier) => {
    if (!specifier.startsWith(".")) return [];
    const target = posix.normalize(posix.join(posix.dirname(path), specifier));
    const dependency = layer(target);
    if (dependency && allowed[owner].includes(dependency)) return [];
    if (!dependency && !target.startsWith("..") && target.startsWith("assets/")) return [];
    return [`${path}: ${specifier} (${owner} -> ${dependency ?? "outside layers"})`];
  });
}

describe("dashboard source boundaries", () => {
  it("keeps app composition above features, infra, and shared code", () => {
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(50);
    expect(files.some(([path]) => path === "../platforms/index.ts")).toBe(true);
    expect(
      files.flatMap(([path, source]) => violations(path.replace(/^\.\.\//, ""), source)),
    ).toEqual([]);
  });

  it.each([
    ["features/example/view.tsx", 'import type { Shell } from "../../app/Shell"'],
    ["infra/client.ts", 'export { feature } from "../features/example/client"'],
    ["shared/value.ts", 'const load = () => import("../infra/client")'],
    ["config.ts", 'type Value = import("./features/example/model").Value'],
    ["platforms/index.ts", 'const feature = require("../features/example/client")'],
  ])("rejects a reverse dependency in %s", (path, source) => {
    expect(violations(path, source)).toHaveLength(1);
  });

  it("allows feature collaboration and the public platform integration", () => {
    expect(
      violations(
        "features/jobs/Card.tsx",
        'import "../documents/client"; import "../../platforms"; import "@job-tracker/shared/api"',
      ),
    ).toEqual([]);
    expect(
      violations(
        "platforms/index.ts",
        'import "@job-tracker/shared/platforms"; import.meta.glob("./local/*.ts")',
      ),
    ).toEqual([]);
  });
});
