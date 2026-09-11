import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: "line",
  webServer: {
    command: "HOST=127.0.0.1 PORT=18787 GATEWAY_CLIENT_TOKEN=playwright-secret SPEECH_PROVIDER=fake npm run dev:gateway",
    cwd: resolve(import.meta.dirname, "../.."),
    url: "http://127.0.0.1:18787/healthz",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
