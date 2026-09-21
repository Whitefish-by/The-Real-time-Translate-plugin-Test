import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/module2-ai/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    sequence: { concurrent: false },
  },
});
