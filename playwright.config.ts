import { defineConfig, devices } from "@playwright/test";

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
    trace: "retain-on-failure",
  },
  // Every supported engine runs every test; README "Supported browsers" names any exception.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "pnpm preview",
    env: { PORT: "4175" },
    url: "https://127.0.0.1:4175",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  },
});
