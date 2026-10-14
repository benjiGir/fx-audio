import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

// Locally only Chromium may be installed: FX_BROWSERS=chromium CHROMIUM_PATH=/path/to/chrome.
const browsers = (process.env.FX_BROWSERS ?? "chromium,firefox,webkit").split(",")
const executablePath = process.env.CHROMIUM_PATH

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 }
    },
    projects: [
      {
        test: { name: "unit", include: ["test/**/*.test.ts"] }
      },
      {
        test: {
          name: "browser",
          include: ["test-browser/**/*.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: {
                ...(executablePath === undefined ? {} : { executablePath }),
                args: ["--autoplay-policy=no-user-gesture-required"]
              }
            }),
            instances: browsers.map(
              (browser) => ({ browser }) as { browser: "chromium" | "firefox" | "webkit" }
            )
          }
        }
      }
    ]
  }
})
