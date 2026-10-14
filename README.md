# fx-audio

Audio library for the browser and Node, built on [Effect](https://effect.website).
It aims to replace Howler.js with a smaller, faster, fully typed and thoroughly tested core.

> Status: pre-alpha. The API is not stable yet.

## Requirements

- ESM only, Node 22 or later.
- `effect` 4.x as a peer dependency.
- `node-web-audio-api` (optional peer dependency) to play or decode audio under Node.

## Entry points

| Import | Content |
| --- | --- |
| `fx-audio` | Effect core (`Audio` service with `load`, `decode`, `play`, `playSprite`; `Sound`, `PlayOptions`, `SpriteSheet`, `LoadError`) and the browser layers |
| `fx-audio/node` | `NodeAudioContextLive`, on top of `node-web-audio-api` |
| `fx-audio/promise` | Promise facade for code that does not use Effect |
| `fx-audio/testing` | `makeFakeContext` and `FakeAudioContextLive`, an audio context double for tests |

Import Effect modules by subpath (`effect/Effect`), never from the `effect` barrel, to keep bundles small.

## Sprites

A sprite sheet cuts one decoded sound into named segments, so a whole set of effects loads as one file.
Times are in milliseconds, as in Howler.

```ts
import { Audio, SpriteSegment, SpriteSheet } from "fx-audio"

const sheet = new SpriteSheet({
  sound,
  segments: {
    hit: new SpriteSegment({ start: 0, duration: 400 }),
    engine: new SpriteSegment({ start: 500, duration: 2000, loop: true })
  }
})

const voice = yield* audio.playSprite(sheet, "hit", { volume: 0.8 })
```

`playSprite` fails with `UnknownSprite` (listing the available names) when the sheet has no such segment.
A looping segment loops inside its own bounds. `PlayOptions.loop`, when given, overrides the segment's `loop` flag.

## Codecs

The browser decodes whatever the browser supports. Under Node, `node-web-audio-api` decodes WAV, MP3, Ogg Vorbis, FLAC and AAC in M4A (when the `moov` atom comes first),
but not Opus: decoding Opus there fails with `LoadError` whose `reason` is `UnsupportedFormat`,
so you can catch it with `Effect.catchReason` and load another codec.

## Development

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm coverage     # unit tests, coverage thresholds: 95%
pnpm test:browser # real browsers through Playwright (all three engines by default)
pnpm build
pnpm check:package
```

Browser tests run on Chromium, Firefox and WebKit. Sound is rendered with an `OfflineAudioContext`, so no output device is needed. Locally, install them with
`pnpm exec playwright install`, or restrict the run with `FX_BROWSERS=chromium`
(and `CHROMIUM_PATH` to use an existing Chromium binary).

## License

MIT
