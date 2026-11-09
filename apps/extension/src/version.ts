import { copy } from "./copy";
import type { BuildInfo } from "../../../scripts/build-metadata.mjs";

declare const __BUILD_INFO__: BuildInfo;
export const extensionBuild = __BUILD_INFO__;

export type BuildIdentity = Pick<BuildInfo, "version" | "revision" | "dev">;

export function parseBuildIdentity(value: unknown): BuildIdentity {
  if (!value || typeof value !== "object") throw new Error("Invalid server build");
  const info = value as Record<string, unknown>;
  if (
    typeof info.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(info.version) ||
    typeof info.revision !== "string" ||
    typeof info.dev !== "boolean" ||
    (info.dev ? info.revision !== "dev" : !/^[0-9a-f]{40,64}$/.test(info.revision))
  )
    throw new Error("Invalid server build");
  return { version: info.version, revision: info.revision, dev: info.dev };
}

export function buildsDiffer(extension: BuildIdentity, server: BuildIdentity | null): boolean {
  return (
    server !== null &&
    (extension.version !== server.version ||
      (!extension.dev && !server.dev && extension.revision !== server.revision))
  );
}

export function toolbarStatus(reachable: boolean, mismatch: boolean) {
  if (!reachable)
    return {
      text: "!",
      color: "#e53e3e",
      title: copy.version.jobTrackerCanTReachTheServerChangesAren,
    };
  if (mismatch)
    return {
      text: "↑",
      color: "#b45309",
      title: copy.version.jobTrackerExtensionAndServerVersionsDiffer,
    };
  return { text: "", color: "#b45309", title: copy.version.jobTracker };
}
