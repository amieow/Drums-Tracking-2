import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Use the automatic JSX runtime so `.tsx` components that rely on the
  // Next.js/TS automatic runtime (no explicit `import React`) can be rendered
  // in tests without a "React is not defined" error. `.ts` tests are unaffected.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
