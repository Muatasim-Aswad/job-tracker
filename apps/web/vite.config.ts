import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { buildInfo, identityPlugin } from "../../scripts/build-metadata.mjs";
import { noticesPlugin } from "../../scripts/third-party-notices.mjs";
import { createRequire } from "node:module";

const BACKEND = process.env.VITE_SERVER_URL ?? "http://localhost:3456";
const BUILD_INFO = buildInfo();
const require = createRequire(import.meta.url);
// Generated registration/polyfill code and Tailwind's preflight also ship as assets.
const assetNoticeInputs = ["vite", "vite-plugin-pwa", "tailwindcss"].map((name) =>
  require.resolve(name),
);

export default defineConfig({
  define: { __BUILD_INFO__: JSON.stringify(BUILD_INFO) },
  // Exclude tsc metadata to avoid self-invalidating independent build/typecheck caches.
  run: {
    tasks: {
      typecheck: {
        command: "tsc -b",
        input: [{ auto: true }, "!node_modules/.tmp/**"],
        output: [{ auto: true }, "!node_modules/.tmp/**"],
      },
      build: { command: "vp build" },
    },
  },
  plugins: [
    identityPlugin(BUILD_INFO),
    noticesPlugin("", assetNoticeInputs),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: "script",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
        globIgnores: ["**/version.json"],
        buildPlugins: { vite: [noticesPlugin(".sw")] },
      },
      manifest: {
        id: "/",
        name: "Job Tracker",
        short_name: "Job Tracker",
        description: "Track jobs and review reusable application answers.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f8fafc",
        theme_color: "#7c3aed",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    }),
  ],
  // Match the server dashboard resource path.
  build: {
    outDir: "dist",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": BACKEND,
      "/docs": BACKEND,
      "/openapi.json": BACKEND,
      "/version.json": BACKEND,
    },
  },
  test: {
    environment: "jsdom",
    passWithNoTests: true,
  },
});
