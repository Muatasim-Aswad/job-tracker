import { defineConfig } from "vite-plus";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import manifest from "./manifest.config";

// CRXJS bundles MV3 entries into dist/. React and Fast Refresh apply only to the popup.
export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  build: {
    target: "esnext",
  },
  test: {
    environment: "jsdom",
    passWithNoTests: true,
  },
});
