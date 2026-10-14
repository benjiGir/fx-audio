import { defineConfig } from "vitepress"

export default defineConfig({
  title: "fx-audio",
  description: "Audio for the browser and Node, built on Effect. Meant to replace Howler.js.",
  lang: "en-US",
  // Served from https://benjigir.github.io/fx-audio/
  base: "/fx-audio/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Contributing", link: "/contributing" }
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [{ text: "Getting started", link: "/guide/getting-started" }]
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
      { text: "Project", items: [{ text: "Contributing", link: "/contributing" }] }
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/benjiGir/fx-audio" }],
    editLink: {
      pattern: "https://github.com/benjiGir/fx-audio/edit/main/docs/:path",
      text: "Edit this page on GitHub"
    },
    search: { provider: "local" },
    footer: { message: "Released under the MIT license." }
  }
})
