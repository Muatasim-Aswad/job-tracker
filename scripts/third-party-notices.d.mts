import type { Plugin } from "vite-plus";

export interface DependencyAttribution {
  name: string;
  version: string;
  license: string;
  licenses: { file: string; sha256: string }[];
}

export function bundledNotices(ids: Iterable<string>): {
  inventory: DependencyAttribution[];
  text: string;
};
export function noticesPlugin(suffix?: string, additionalModules?: Iterable<string>): Plugin;
