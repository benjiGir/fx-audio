// Minified and compressed size of the same job ("load a file and play it") with each library.
//   pnpm bench:size
import { readdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { brotliCompressSync, gzipSync } from "node:zlib"
import { build } from "tsdown"

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, ".out", "size")
rmSync(out, { recursive: true, force: true })

const entries = {
  "howler (full, with 3D and stereo)": "howler",
  "howler (core: no 3D, no stereo)": "howler-core",
  "fx-audio (promise facade, Effect included)": "fx-promise",
  "fx-audio (Effect core, Effect included)": "fx-effect",
  "fx-audio (Effect core alone, Effect shared with the app)": ["fx-effect", { external: true }]
}

const kb = (bytes) => (bytes / 1024).toFixed(1)
const rows = []
for (const [label, entry] of Object.entries(entries)) {
  const [name, { external = false } = {}] = Array.isArray(entry) ? entry : [entry]
  const dir = join(out, external ? `${name}-external` : name)
  await build({
    config: false,
    entry: { [name]: resolve(here, "entries", `${name}.ts`) },
    outDir: dir,
    format: "esm",
    platform: "browser",
    minify: true,
    dts: false,
    clean: true,
    logLevel: "silent",
    deps: external ? { neverBundle: [/^effect(\/|$)/] } : { alwaysBundle: [/./] }
  })
  const file = readdirSync(dir).find((f) => f.endsWith(".js"))
  const code = readFileSync(join(dir, file))
  rows.push({
    label,
    min: code.length,
    gzip: gzipSync(code).length,
    brotli: brotliCompressSync(code).length
  })
}

console.log("| Bundle | minified | gzip | brotli |")
console.log("| --- | --- | --- | --- |")
for (const r of rows)
  console.log(`| ${r.label} | ${kb(r.min)} kB | ${kb(r.gzip)} kB | ${kb(r.brotli)} kB |`)
