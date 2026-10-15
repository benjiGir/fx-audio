# Testing your code

`fx-audio/testing` has an audio context double. It records every node, param and call the core makes, so a test can
check what your code played without a sound card, a browser or an audio engine.

```ts
import { FakeAudioContextLive, makeFakeContext } from "fx-audio/testing"
```

`makeFakeContext` builds the double and `FakeAudioContextLive(ctx)` turns it into the platform layer that `AudioLive` needs.
Keep a reference to `ctx`: it is what you inspect afterwards.

## Check what was played

<<< @/examples/testing.ts#test{ts}

`ctx.sources` lists the sound sources in creation order, with their `buffer`, `loop`, `playbackRate`, and the number of
`starts`, `stops` and `disconnects`. `ctx.gains`, `ctx.panners` and `ctx.spatialPanners` do the same for the rest of the
graph, and every param (`gain`, `pan`...) records its scheduled changes in `calls`, which is how a fade can be checked.

## Decoding

By default every decode rejects, so loading fails with a `DecodeFailure`. Give the context a decoder to make it succeed:

<<< @/examples/testing.ts#decode{ts}

Anything that goes through `fetch` (the `load` of a URL) still needs a stub of `fetch` in your test. Use `decode` with
bytes, as above, to keep the test free of the network.

## End of playback

A fake source never ends on its own. Call `source.end()` to simulate the engine reporting the end of playback:

<<< @/examples/testing.ts#end{ts}

## What else the double offers

- `resumes` counts the calls to `resume`, and the `resume` option replaces what it returns (to test a refused gesture).
- `elements` and `mediaSources` record the media elements built for streaming; give `ctx.createMediaElement` to
  `FakeAudioContextLive` (second argument) so `stream` can build them, and set `ctx.playResult` to make `play` reject.
- `listener` is a fake listener (or `makeLegacyListener()` to mimic Firefox's older methods).
- `currentTime` is a plain number you can set to schedule against.

The double is what fx-audio's own unit tests use, and the [API reference](/api/) lists all of it.
