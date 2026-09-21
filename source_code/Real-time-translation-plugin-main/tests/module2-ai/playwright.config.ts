import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 15_000,
  outputDir: "results/browser-artifacts",
  reporter: [
    ["line"],
    ["json", { outputFile: "results/browser.json" }],
  ],
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
