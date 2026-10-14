import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

type Engine = "chromium" | "firefox" | "webkit"

// Locally only Chromium may be installed: FX_BROWSERS=chromium CHROMIUM_PATH=/path/to/chrome.
const engines = (process.env.FX_BROWSERS ?? "chromium,firefox,webkit").split(",") as Array<Engine>
const executablePath = process.env.CHROMIUM_PATH

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 }
    },
    projects: [
      { test: { name: "unit", include: ["test/**/*.test.ts"] } },
      ...engines.map((engine) => ({
        test: {
          name: `browser-${engine}`,
          include: ["test-browser/**/*.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions:
                engine === "chromium" && executablePath !== undefined ? { executablePath } : {}
            }),
            instances: [{ browser: engine }]
          }
        }
      }))
    ]
  }
})
