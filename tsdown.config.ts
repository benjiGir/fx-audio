import { defineConfig } from "tsdown"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    node: "src/node.ts",
    promise: "src/promise.ts",
    react: "src/react.ts",
    testing: "src/testing.ts"
  },
  format: "esm",
  platform: "neutral",
  dts: true,
  clean: true,
  target: "es2022",
  deps: { neverBundle: [/^effect(\/|$)/, "node-web-audio-api", "react"] }
})
