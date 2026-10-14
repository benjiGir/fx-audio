// Stryker loads the TypeScript compiler API (`import("typescript")`), which TypeScript 7 does
// not ship. Give it TypeScript 5.9 of its own while the project itself builds with TypeScript 7.
const strykerPackages = new Set(["@stryker-mutator/core", "@stryker-mutator/typescript-checker"])

function readPackage(pkg) {
  if (strykerPackages.has(pkg.name)) {
    delete pkg.peerDependencies?.typescript
    pkg.dependencies = { ...pkg.dependencies, typescript: "5.9.3" }
  }
  return pkg
}

module.exports = { hooks: { readPackage } }
