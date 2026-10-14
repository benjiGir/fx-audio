import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

type Engine = "chromium" | "firefox" | "webkit"

// Locally only Chromium may be installed: FX_BROWSERS=chromium CHROMIUM_PATH=/path/to/chrome.
const engines = (process.env.FX_BROWSERS ?? "chromium,firefox,webkit").split(",") as Array<Engine>
const executablePath = process.env.CHROMIUM_PATH

// Each engine takes its own launch options: a flag unknown to one makes it refuse to start.
const launchOptions = (engine: Engine) => {
  switch (engine) {
    case "chromium":
      return {
        ...(executablePath === undefined ? {} : { executablePath }),
        args: ["--autoplay-policy=no-user-gesture-required"]
      }
    case "firefox":
      return {
        firefoxUserPrefs: { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 }
      }
    case "webkit":
      return {}
  }
}

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
            provider: playwright({ launchOptions: launchOptions(engine) }),
            instances: [{ browser: engine }]
          }
        }
      }))
    ]
  }
})
