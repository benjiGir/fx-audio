import { existsSync, readFileSync } from "node:fs"
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
  lastUpdated: true,
  // The reference is generated, so there is no file to edit.
  transformPageData(pageData) {
    if (pageData.relativePath.startsWith("api/")) pageData.frontmatter.editLink = false
  },
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
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
            { text: "Groups and master", link: "/guide/groups" },
            { text: "Stereo pan", link: "/guide/pan" },
            { text: "3D position", link: "/guide/spatial" },
            { text: "Streaming", link: "/guide/streaming" },
            { text: "Autoplay policy", link: "/guide/autoplay" },
            { text: "Node", link: "/guide/node" },
            { text: "Errors", link: "/guide/errors" },
            { text: "Codecs", link: "/guide/codecs" }
          ]
        },
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
