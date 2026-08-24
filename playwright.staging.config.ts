import { defineConfig, devices } from "@playwright/test";

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "tests/staging",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.WEB_URL,
    headless: process.env.STAGING_ACCEPTANCE_HEADED !== "true",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "staging-desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined,
        viewport: { width: 1440, height: 1000 }
      }
    },
    {
      name: "staging-mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined
      }
    }
  ]
});
