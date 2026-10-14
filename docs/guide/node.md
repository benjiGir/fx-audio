# Node

`NodeAudioContextLive` plays through `node-web-audio-api`, or through no device at all with `{ silent: true }`
(CI, servers without a sound card). Under Node, `load` reads a path (relative to the working directory)
or a `file:` URL from disk, and still fetches `http:` and `https:` URLs.

```sh
pnpm add node-web-audio-api
```

<<< @/examples/node.ts#layer{ts}

A file that cannot be read fails with `LoadError` whose `reason` is `NetworkFailure`, and `cause` holds the
system error (`ENOENT`, `EACCES`...). A file that is not valid audio fails with `DecodeFailure`, as anywhere.
Streaming needs a media element, so `stream` fails with `StreamingUnavailable` under Node: load the file instead.

## Promise facade

The Node layer builds its context on demand, so the facade is created asynchronously there:

<<< @/examples/node.ts#promise{ts}

## Runnable examples

Two examples live in the repository, both checked by `tsc` in CI:
[`examples/node-play.ts`](https://github.com/benjiGir/fx-audio/blob/main/examples/node-play.ts) plays a file, and
[`examples/node-server.ts`](https://github.com/benjiGir/fx-audio/blob/main/examples/node-server.ts) is an HTTP server
that plays sounds from a folder. Build first (`pnpm build`), then `node examples/node-play.ts path/to/sound.wav`.
