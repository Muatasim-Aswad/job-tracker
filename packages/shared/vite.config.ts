import { defineConfig } from "vite-plus";

// Consumers import TypeScript source; this config runs the shared package's Node tests.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
