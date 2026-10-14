# fx-audio

Audio library for the browser and Node, built on [Effect](https://effect.website).
It aims to replace Howler.js with a fully typed, thoroughly tested core, and typed errors instead of callbacks.

> Status: pre-alpha. The API is not stable yet.

**Documentation: <https://benjigir.github.io/fx-audio/>**

## Install

```sh
pnpm add fx-audio effect
pnpm add node-web-audio-api # only to play or decode audio under Node
```

ESM only, Node 22 or later, `effect` 4.x as a peer dependency.

## Use

With Effect:

```ts
import * as Effect from "effect/Effect"
import { Audio, AudioBrowserLive } from "fx-audio"

const program = Effect.gen(function* () {
  const audio = yield* Audio
  const sound = yield* audio.load("/sounds/hit.mp3")
  const voice = yield* audio.play(sound, { volume: 0.8 })
  yield* voice.ended
}).pipe(Effect.scoped, Effect.provide(AudioBrowserLive))

Effect.runPromise(program)
```

Without Effect, through the promise facade:

```ts
import { createAudio } from "fx-audio/promise"

const audio = createAudio()
const sound = await audio.load("/sounds/hit.mp3")
const voice = audio.play(sound, { volume: 0.8 })
await voice.ended
```

## What it does

Sprites, named groups with fades and a master volume, stereo pan, 3D positioning with a listener,
streaming for long sounds, and the browser autoplay policy handled for you. The same engine runs in the browser
and under Node. Loading fails with typed errors you can recover from one case at a time.

| Import | Content |
| --- | --- |
| `fx-audio` | Effect core and the browser layers |
| `fx-audio/node` | `NodeAudioContextLive`, on top of `node-web-audio-api`: loads sounds from disk |
| `fx-audio/promise` | Promise facade for code that does not use Effect |
| `fx-audio/testing` | An audio context double for tests |

Import Effect modules by subpath (`effect/Effect`), never from the `effect` barrel, to keep bundles small.

Moving from Howler? See [Migrating from Howler](https://benjigir.github.io/fx-audio/guide/migrating-from-howler).

## Size

Effect is part of the bundle. A page that does not use Effect pays about 34 kB gzip for fx-audio, against 9.5 kB for
Howler; an app that already ships Effect pays 3.3 kB. Playing a sound costs the same as Howler within the noise.
Method and numbers: [bench/README.md](bench/README.md).

## Development

```sh
pnpm install
pnpm lint && pnpm format:check && pnpm typecheck
pnpm coverage     # unit tests, coverage thresholds: 95%
pnpm test:browser # Chromium, Firefox and WebKit through Playwright
pnpm api          # public API against the reports committed in api/
pnpm docs:dev     # the documentation site
```

More in the [contributing guide](https://benjigir.github.io/fx-audio/contributing): mutation testing, the frozen API,
how the docs are built.

## License

MIT
