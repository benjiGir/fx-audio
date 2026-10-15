import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig, type DefaultTheme } from "vitepress"

// Written by `typedoc` (see typedoc.json) before every build of the site.
const apiSidebarPath = new URL("../api/typedoc-sidebar.json", import.meta.url)
const apiSidebar: DefaultTheme.SidebarItem[] = existsSync(apiSidebarPath)
  ? JSON.parse(readFileSync(apiSidebarPath, "utf8"))
  : []

export default defineConfig({
  title: "fx-audio",
  description: "Audio for the browser and Node, built on Effect. Meant to replace Howler.js.",
  lang: "en-US",
  // Served from https://benjigir.github.io/fx-audio/
  base: "/fx-audio/",
  cleanUrls: true,
  // The playground runs the library from source, as the type-checker resolves it (see tsconfig paths).
  vite: {
    resolve: {
      alias: [
        {
          find: /^fx-audio$/,
          replacement: fileURLToPath(new URL("../../src/index.ts", import.meta.url))
        },
        {
          find: /^fx-audio\/(.*)$/,
          replacement: fileURLToPath(new URL("../../src/$1.ts", import.meta.url))
        }
      ]
    }
  },
  lastUpdated: true,
  // The reference is generated, so there is no file to edit.
  transformPageData(pageData) {
    if (pageData.relativePath.startsWith("api/")) pageData.frontmatter.editLink = false
  },
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Playground", link: "/playground" },
      { text: "API", link: "/api/" },
      { text: "Contributing", link: "/contributing" }
    ],
    sidebar: {
      "/api/": [{ text: "Reference", items: [{ text: "Overview", link: "/api/" }] }, ...apiSidebar],
      "/": [
        {
          text: "Introduction",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Migrating from Howler", link: "/guide/migrating-from-howler" }
          ]
        },
        {
          text: "Guides",
          items: [
            { text: "Sprites", link: "/guide/sprites" },
            { text: "Controlling a voice", link: "/guide/voices" },
            { text: "Scheduling", link: "/guide/scheduling" },
            { text: "Groups and master", link: "/guide/groups" },
            { text: "Level meters", link: "/guide/analyser" },
            { text: "Effects", link: "/guide/effects" },
            { text: "Stereo pan", link: "/guide/pan" },
            { text: "3D position", link: "/guide/spatial" },
            { text: "Streaming", link: "/guide/streaming" },
            { text: "Autoplay policy", link: "/guide/autoplay" },
            { text: "Node", link: "/guide/node" },
            { text: "Using Effect", link: "/guide/effect" },
            { text: "Testing your code", link: "/guide/testing" },
            { text: "Errors", link: "/guide/errors" },
            { text: "Codecs", link: "/guide/codecs" }
          ]
        },
        { text: "Try it", items: [{ text: "Playground", link: "/playground" }] },
        { text: "Benchmark", items: [{ text: "Against Howler.js", link: "/guide/benchmark" }] },
        { text: "Reference", items: [{ text: "API reference", link: "/api/" }] },
        { text: "Project", items: [{ text: "Contributing", link: "/contributing" }] }
      ]
    },
    socialLinks: [{ icon: "github", link: "https://github.com/benjiGir/fx-audio" }],
    editLink: {
      pattern: "https://github.com/benjiGir/fx-audio/edit/main/docs/:path",
      text: "Edit this page on GitHub"
    },
    search: { provider: "local" },
    footer: { message: "Released under the MIT license." }
  }
})
