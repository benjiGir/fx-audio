import { brotliCompressSync, gzipSync } from "node:zlib"
import { rolldown } from "rolldown"

const entries = [
  { name: "baseline: Effect.runPromise(succeed)", input: "src/entry-baseline.ts" },
  { name: "core (Effect-native API + browser layer)", input: "src/entry-core.ts" },
  { name: "promise facade (+ browser layer)", input: "src/entry-promise.ts" }
]

const kB = (n: number) => (n / 1024).toFixed(1).padStart(6)

console.log("| Entry | min | gzip | brotli |")
console.log("| --- | ---: | ---: | ---: |")
for (const entry of entries) {
  const bundle = await rolldown({
    input: entry.input,
    external: ["node-web-audio-api"],
    platform: "browser",
    logLevel: "silent"
  })
  const { output } = await bundle.generate({ format: "esm", minify: true })
  await bundle.close()
  const code = Buffer.from(output.map((chunk) => ("code" in chunk ? chunk.code : "")).join("\n"))
  console.log(
    `| ${entry.name} | ${kB(code.length)} kB | ${kB(gzipSync(code, { level: 9 }).length)} kB | ${kB(brotliCompressSync(code).length)} kB |`
  )
}
