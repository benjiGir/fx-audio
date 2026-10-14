// Cost of one play() call on the calling thread, Howler against fx-audio, in a real Chromium.
// The audio contexts run for real (autoplay allowed by a flag), so voices are actually started.
//   CHROMIUM_PATH=/path/to/chrome pnpm bench:play
import { rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { build } from "tsdown"

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, ".out", "play")
rmSync(out, { recursive: true, force: true })

await build({
  config: false,
  entry: { page: resolve(here, "page.ts") },
  outDir: out,
  format: "iife",
  globalName: "bench",
  platform: "browser",
  minify: true,
  dts: false,
  clean: true,
  logLevel: "silent",
  deps: { alwaysBundle: [/./] }
})

const RUNS = 3
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--autoplay-policy=no-user-gesture-required"]
})
const runs = []
let contextState = ""
for (let i = 0; i < RUNS; i++) {
  // A fresh page each time: new audio contexts, nothing carried over.
  const page = await browser.newPage()
  await page.goto("about:blank")
  await page.addScriptTag({ path: join(out, "page.iife.js") })
  const result = await page.evaluate(() => globalThis.bench.run())
  contextState = result.contextState
  runs.push(result.results)
  await page.close()
}
const version = browser.version()
await browser.close()

console.log(`Chromium ${version}, audio context: ${contextState}, ${RUNS} fresh pages`)
console.log("Median cost of one call (range of the medians over the pages):\n")
console.log("| Scenario | Howler 2.2.4 | fx-audio (promise facade) |")
console.log("| --- | --- | --- |")
const range = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return `${sorted[Math.floor(sorted.length / 2)].toFixed(0)} µs (${sorted[0].toFixed(0)} to ${sorted.at(-1).toFixed(0)})`
}
runs[0].forEach((first, index) => {
  const pick = (lib) => runs.map((run) => run[index][lib].median)
  console.log(`| ${first.scenario} | ${range(pick("howler"))} | ${range(pick("fx"))} |`)
})
