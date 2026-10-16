# Getting started

fx-audio is ESM only and needs Node 22 or later. It has `effect` 4.x as a peer dependency, and
`node-web-audio-api` as an optional peer dependency to play or decode audio under Node.

fx-audio is not on npm yet. Each [GitHub release](https://github.com/benjiGir/fx-audio/releases) carries the package as a tarball,
which any package manager installs from its URL (here for 1.0.0, replace the version for another release):

::: code-group

```sh [pnpm]
pnpm add https://github.com/benjiGir/fx-audio/releases/download/v1.0.0/fx-audio-1.0.0.tgz effect
```

```sh [npm]
npm install https://github.com/benjiGir/fx-audio/releases/download/v1.0.0/fx-audio-1.0.0.tgz effect
```

```sh [yarn]
yarn add https://github.com/benjiGir/fx-audio/releases/download/v1.0.0/fx-audio-1.0.0.tgz effect
```

:::

Add `node-web-audio-api` to play or decode audio under Node, and `react` for the hooks if your app does not have it yet.
The URL is written to your `package.json`, so a later install gets the same file. To upgrade, install the URL of the newer release.

::: warning Do not install from the Git repository
`pnpm add github:benjiGir/fx-audio` does not work: the build output is not committed, so the package would have no `dist/` folder.
:::

## Entry points

| Import | Content |
| --- | --- |
| `fx-audio` | Effect core (`Audio` service with `load`, `decode`, `play`, `playSprite`, `master`, `group`; `Sound`, `PlayOptions`, `SpriteSheet`, `LoadError`) and the browser layers |
| `fx-audio/node` | `NodeAudioContextLive`, on top of `node-web-audio-api`: loads sounds from disk |
| `fx-audio/promise` | Promise facade for code that does not use Effect (`createAudio`, and `createAudioAsync` for Node) |
| `fx-audio/testing` | `makeFakeContext` and `FakeAudioContextLive`, an audio context double for tests |
| `fx-audio/react` | `AudioProvider`, `useAudio`, `useGroup` and `useSound`, for React 18 or later (optional peer dependency) |

Import Effect modules by subpath (`effect/Effect`), never from the `effect` barrel, to keep bundles small.

## Play a sound with Effect

`play` needs a `Scope`: the voice's audio nodes are released when the scope closes.

<<< @/examples/getting-started.ts#effect{ts}

## Play a sound with Promises

The facade has the same engine and no Effect types. Methods that can fail in a way you handle (`load`, `stream`) return
promises; the others throw.

<<< @/examples/getting-started.ts#promise{ts}

Browsers keep audio suspended until the user interacts with the page, see [Autoplay policy](./autoplay).
