import { defineConfig, devices } from "@playwright/test";

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const firefoxExecutablePath = process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "tests/smoke",
  timeout: 45_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEB_SERVER === "true" ? undefined : {
    command:
      "pnpm --filter @veel/config build && node scripts/run-local-tool.mjs web-build && node scripts/run-local-tool.mjs web-preview",
    env: {
      ENABLE_E2E_AUTH: "true",
      // Deliberately differ from the 127.0.0.1 browser URL. Browser transport
      // must normalize loopback aliases so the canonical SameSite cookie works.
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:4000",
      NEXT_PUBLIC_ENABLE_E2E_AUTH: "true"
    },
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 600_000
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined,
        viewport: { width: 1440, height: 1000 }
      }
    },
    {
      name: "desktop-firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: firefoxExecutablePath ? { executablePath: firefoxExecutablePath } : undefined,
        viewport: { width: 1440, height: 1000 }
      }
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined
      }
    },
    ...(process.platform === "darwin" ? [] : [
      {
        name: "desktop-webkit",
        use: {
          ...devices["Desktop Safari"],
          viewport: { width: 1440, height: 1000 }
        }
      },
      {
        name: "mobile-webkit",
        use: {
          ...devices["iPhone 13"]
        }
      }
    ])
  ]
});
