import type { BuildInfo } from "../../../../scripts/build-metadata.mjs";

declare const __BUILD_INFO__: BuildInfo;
export const runningBuild = __BUILD_INFO__;
export type { BuildInfo };

const REVISION = /^[0-9a-f]{40,64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const NOTICE_KEY = "jt.buildNotices.v1";
const sessionNotices = new Set<string>();
export const BUILD_CHECK_TIMEOUT_MS = 5_000;

function isTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    TIME.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value.replace("Z", ".000Z")
  );
}

export function parseBuildInfo(value: unknown): BuildInfo {
  if (!value || typeof value !== "object") throw new Error("Invalid build identity");
  const info = value as Record<string, unknown>;
  if (
    Object.keys(info).sort().join(",") !== "build_time,commit_time,dev,revision,version" ||
    typeof info.version !== "string" ||
    !VERSION.test(info.version) ||
    typeof info.revision !== "string" ||
    typeof info.dev !== "boolean" ||
    (info.dev ? info.revision !== "dev" : !REVISION.test(info.revision)) ||
    (info.dev ? info.commit_time !== null : !isTime(info.commit_time)) ||
    !isTime(info.build_time)
  ) {
    throw new Error("Invalid build identity");
  }
  return {
    version: info.version,
    revision: info.revision,
    commit_time: info.commit_time as string | null,
    build_time: info.build_time,
    dev: info.dev,
  };
}

export function sameBuild(left: BuildInfo, right: BuildInfo): boolean {
  return (
    left.version === right.version &&
    left.revision === right.revision &&
    left.commit_time === right.commit_time &&
    left.build_time === right.build_time &&
    left.dev === right.dev
  );
}

export async function fetchCurrentBuild(signal: AbortSignal): Promise<BuildInfo> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, BUILD_CHECK_TIMEOUT_MS);
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new Error("Build check stopped"));
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch("/version.json", {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Build check failed");
        return parseBuildInfo(await response.json());
      })(),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}

export function shouldNotifyBuild(info: BuildInfo): boolean {
  if (info.dev || sessionNotices.has(info.revision)) return false;
  let revisions: string[] = [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(NOTICE_KEY) ?? "[]");
    if (Array.isArray(stored)) {
      revisions = stored.filter(
        (item): item is string => typeof item === "string" && REVISION.test(item),
      );
    }
  } catch {
    // Blocked or malformed storage falls back to one notice per page session.
  }
  sessionNotices.add(info.revision);
  if (revisions.includes(info.revision)) return false;
  try {
    localStorage.setItem(NOTICE_KEY, JSON.stringify([...revisions, info.revision]));
  } catch {
    // The in-memory set still suppresses repeat notices.
  }
  return true;
}
