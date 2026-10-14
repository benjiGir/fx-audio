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
| `fx-audio` | Effect core (`load`, `decode`, `play`, `LoadError`) and the browser layer |
| `fx-audio/node` | Node layer on top of `node-web-audio-api` |
| `fx-audio/promise` | Promise facade for code that does not use Effect |
| `fx-audio/testing` | Audio context double for tests |

Import Effect modules by subpath (`effect/Effect`), never from the `effect` barrel, to keep bundles small.

## Development

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm coverage     # coverage thresholds: 95%
pnpm build
pnpm check:package
```

## License

MIT
