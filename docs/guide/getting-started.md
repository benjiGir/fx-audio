# Getting started

fx-audio is ESM only and needs Node 22 or later. It has `effect` 4.x as a peer dependency, and
`node-web-audio-api` as an optional peer dependency to play or decode audio under Node.

```sh
pnpm add fx-audio effect
```

## Entry points

| Import | Content |
| --- | --- |
| `fx-audio` | Effect core (`Audio` service with `load`, `decode`, `play`, `playSprite`, `master`, `group`; `Sound`, `PlayOptions`, `SpriteSheet`, `LoadError`) and the browser layers |
| `fx-audio/node` | `NodeAudioContextLive`, on top of `node-web-audio-api`: loads sounds from disk |
| `fx-audio/promise` | Promise facade for code that does not use Effect (`createAudio`, and `createAudioAsync` for Node) |
| `fx-audio/testing` | `makeFakeContext` and `FakeAudioContextLive`, an audio context double for tests |

Import Effect modules by subpath (`effect/Effect`), never from the `effect` barrel, to keep bundles small.

## Play a sound with Effect

`play` needs a `Scope`: the voice's audio nodes are released when the scope closes.

<<< @/examples/getting-started.ts#effect{ts}

## Play a sound with Promises

The facade has the same engine and no Effect types. Methods that can fail in a way you handle (`load`, `stream`) return
promises; the others throw.

<<< @/examples/getting-started.ts#promise{ts}

Browsers keep audio suspended until the user interacts with the page, see [Autoplay policy](./autoplay).
