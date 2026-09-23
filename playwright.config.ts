import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  outputDir: "test-results/browser",
  reporter: [["list"]],
  use: {
    baseURL: "https://127.0.0.1:4175",
    ignoreHTTPSErrors: true,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm preview",
    env: { PORT: "4175" },
    url: "https://127.0.0.1:4175",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  },
});
