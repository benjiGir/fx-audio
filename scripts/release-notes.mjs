// Prints the CHANGELOG.md section of a version: the body of its GitHub release.
// Usage: node scripts/release-notes.mjs [version]   (defaults to the version in package.json)
import { readFileSync } from "node:fs"

const root = new URL("../", import.meta.url)
const version =
  process.argv[2] ?? JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version
const changelog = readFileSync(new URL("CHANGELOG.md", root), "utf8")

const lines = changelog.split("\n")
const start = lines.findIndex((line) => line === `## ${version}`)
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}`)
  process.exit(1)
}
const end = lines.findIndex((line, i) => i > start && line.startsWith("## "))
const section = lines
  .slice(start + 1, end === -1 ? undefined : end)
  .join("\n")
  .trim()
if (section === "") {
  console.error(`The ${version} section of CHANGELOG.md is empty`)
  process.exit(1)
}
console.log(section)
