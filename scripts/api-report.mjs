// Compares the public API of every entry point with the reports committed in `api/`.
// `pnpm api` fails when they differ, `pnpm api:update` rewrites them after a deliberate change.
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Extractor, ExtractorConfig } from "@microsoft/api-extractor"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const update = process.argv.includes("--update")
const entries = ["index", "node", "promise", "react", "testing"]

let failed = false
for (const entry of entries) {
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: root,
      mainEntryPointFilePath: `<projectFolder>/dist/${entry}.d.ts`,
      compiler: { tsconfigFilePath: "<projectFolder>/tsconfig.json" },
      apiReport: {
        enabled: true,
        reportFileName: `${entry}.api.md`,
        reportFolder: "<projectFolder>/api",
        reportTempFolder: "<projectFolder>/node_modules/.cache/api-extractor"
      },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      messages: {
        extractorMessageReporting: {
          "ae-missing-release-tag": { logLevel: "none" },
          "ae-forgotten-export": { logLevel: "none" }
        },
        tsdocMessageReporting: { default: { logLevel: "none" } }
      }
    },
    configObjectFullPath: resolve(root, "api-extractor.json"),
    packageJsonFullPath: resolve(root, "package.json")
  })
  mkdirSync(resolve(root, "api"), { recursive: true })
  const result = Extractor.invoke(config, {
    localBuild: update,
    showVerboseMessages: false
  })
  if (!result.succeeded) failed = true
}
if (failed) {
  console.error(
    "\nThe public API changed. If that is intended, run `pnpm api:update` and commit `api/`."
  )
  process.exit(1)
}
console.log(update ? "API reports updated." : "Public API matches the committed reports.")
