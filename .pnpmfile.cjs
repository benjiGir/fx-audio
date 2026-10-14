// Stryker and TypeDoc load the TypeScript compiler API (`import("typescript")`), which TypeScript 7
// does not ship. Give them TypeScript 5.9 of their own while the project itself builds with TypeScript 7.
const compilerApiPackages = new Set([
  "@stryker-mutator/core",
  "@stryker-mutator/typescript-checker",
  "typedoc"
])

function readPackage(pkg) {
  if (compilerApiPackages.has(pkg.name)) {
    delete pkg.peerDependencies?.typescript
    pkg.dependencies = { ...pkg.dependencies, typescript: "5.9.3" }
  }
  return pkg
}

module.exports = { hooks: { readPackage } }
