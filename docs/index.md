---
layout: home
hero:
  name: fx-audio
  text: Audio for the browser and Node
  tagline: Built on Effect. A smaller, fully typed and thoroughly tested replacement for Howler.js.
  actions:
    - theme: brand
      text: Getting started
      link: /guide/getting-started
    - theme: alt
      text: Try the playground
      link: /playground
    - theme: alt
      text: View on GitHub
      link: https://github.com/benjiGir/fx-audio
features:
  - title: Typed errors
    details: Loading fails with a tagged LoadError whose reason you can recover from one case at a time.
  - title: Effect or Promise
    details: Use the Effect API directly, or the Promise facade if your code does not use Effect.
  - title: Browser and Node
    details: The same engine in both. Node plays through node-web-audio-api, or through no device at all in CI.
  - title: Groups, sprites, pan, 3D, streaming
    details: Mixer buses with fades and mute, sprite sheets, stereo and 3D positioning, and streaming for long sounds.
  - title: Frozen public API
    details: The surface of every entry point is checked against committed reports and type tests.
  - title: Well tested
    details: Unit tests with 95% coverage, mutation testing, and real browsers (Chromium, Firefox, WebKit).
---
