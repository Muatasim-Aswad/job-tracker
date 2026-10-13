import { defineConfig } from "vite-plus";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import manifest from "./manifest.config";
import { buildInfo, identityPlugin } from "../../scripts/build-metadata.mjs";
import { noticesPlugin } from "../../scripts/third-party-notices.mjs";
import { createRequire } from "node:module";

const BUILD_INFO = buildInfo();
const require = createRequire(import.meta.url);
// Generated loader/polyfill code and Tailwind's preflight also ship as assets.
const assetNoticeInputs = ["vite", "@crxjs/vite-plugin", "tailwindcss"].map((name) =>
  require.resolve(name),
);

// CRXJS bundles MV3 entries into dist/. React and Fast Refresh apply only to the popup.
export default defineConfig({
  define: { __BUILD_INFO__: JSON.stringify(BUILD_INFO) },
  plugins: [
    react(),
    tailwindcss(),
    crx({ manifest }),
    identityPlugin(BUILD_INFO),
    noticesPlugin("", assetNoticeInputs),
  ],
  build: {
    target: "esnext",
  },
  test: {
    environment: "jsdom",
    passWithNoTests: true,
  },
});
