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
| `fx-audio` | Effect core (`Audio` service with `load`, `decode`, `play`; `Sound`, `PlayOptions`, `LoadError`) and the browser layers |
| `fx-audio/node` | `NodeAudioContextLive`, on top of `node-web-audio-api` |
| `fx-audio/promise` | Promise facade for code that does not use Effect |
| `fx-audio/testing` | `makeFakeContext` and `FakeAudioContextLive`, an audio context double for tests |

Import Effect modules by subpath (`effect/Effect`), never from the `effect` barrel, to keep bundles small.

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

Browser tests run on Chromium, Firefox and WebKit. Locally, install them with
`pnpm exec playwright install`, or restrict the run with `FX_BROWSERS=chromium`
(and `CHROMIUM_PATH` to use an existing Chromium binary).

## License

MIT
