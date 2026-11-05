import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "scripts/**/*.test.mjs"],
    exclude: [
      ...configDefaults.exclude,
      "scripts/capture-audit-execution.test.mjs",
      "scripts/generate-audit-evidence.test.mjs"
    ],
    testTimeout: 15_000
  }
});
