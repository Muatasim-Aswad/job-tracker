// Seed private platform metadata before rendering; absent overlays register nothing
// and unknown platforms retain their raw tokens.
import { registerPlatform, type PlatformMeta } from "@job-tracker/shared/platforms";

const localModules = import.meta.glob<{ default?: Record<string, PlatformMeta> }>(
  ["./local/*.ts", "!./local/*.test.ts"],
  { eager: true },
);

for (const mod of Object.values(localModules)) {
  for (const [platform, meta] of Object.entries(mod.default ?? {})) {
    registerPlatform(platform, meta);
  }
}
