import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "api/**/*.test.ts", ".claude/hooks/*.test.mjs"],
    exclude: ["**/node_modules/**", "tests/e2e/**"],
  },
});
