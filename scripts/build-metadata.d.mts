import type { Plugin } from "vite-plus";

export interface BuildInfo {
  version: string;
  revision: string;
  commit_time: string | null;
  build_time: string;
  dev: boolean;
}

export function buildInfo(): BuildInfo;
export function identityPlugin(info: BuildInfo): Plugin;
