import { defineConfig } from "vitest/config"

// What Stryker runs against every mutant: the unit tests only, since browser tests are far too slow for that.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] }
})
