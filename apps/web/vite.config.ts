import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const BACKEND = process.env.VITE_SERVER_URL ?? "http://localhost:3456";

export default defineConfig({
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
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: "script",
      injectManifest: { globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"] },
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
    },
  },
  test: {
    environment: "jsdom",
    passWithNoTests: true,
  },
});
