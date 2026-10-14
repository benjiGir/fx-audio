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
| `fx-audio` | Effect core (`Audio` service with `load`, `decode`, `play`, `playSprite`, `master`, `group`; `Sound`, `PlayOptions`, `SpriteSheet`, `LoadError`) and the browser layers |
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

## Groups

A group is a mixer bus: every voice played through it shares one gain, so music, effects and voice-over
can each be turned down, faded or muted at once. Groups are named: `audio.group("music")` creates the group
the first time and returns the same one afterwards. Every sound, grouped or not, ends up in the master group,
which plays the role of Howler's global volume and mute.

```ts
const music = yield* audio.group("music")
yield* music.setVolume(0.4)
yield* music.play(theme, { loop: true })

yield* music.fadeTo(0, Duration.seconds(2)) // linear fade, scheduled on the audio thread
yield* music.mute // remembers the volume
yield* music.unmute

yield* audio.master.mute // silence everything
```

`setVolume` cancels a fade in progress. While a group is muted, `setVolume` and `fadeTo` only change the volume
that `unmute` restores. A negative or non-finite volume is a defect. Groups live as long as the layer and are released with it, whichever scope asked for them first.
The promise facade has the same methods (`group(name)`, `master`, and the group methods on the facade itself).

## Stereo pan

`PlayOptions.pan` places a voice between the left speaker (-1) and the right one (1); 0 is centred.
`voice.setPan(pan)` moves it afterwards, also for a voice that started without a pan.
The stereo panner is only built for voices that use one. A value outside -1 to 1 is rejected when options are decoded
and is a defect for `setPan`.

```ts
const voice = yield* audio.play(sound, { pan: -1 })
yield* voice.setPan(1)
```

## 3D position

`PlayOptions.spatial` puts a voice in 3D space, heard from the listener. Axes are Web Audio's: x to the right, y up, z towards the listener.
Only `position` is required; every other attribute keeps the Web Audio default (equal-power panning, inverse distance model, reference distance 1, rolloff 1, omnidirectional source).
`voice.setPosition(position)` moves the voice afterwards, also one that started without `spatial`. `audio.listener` moves the listener, which starts at the origin facing -z with +y up.
Positions are unitless: scale them as you like and tune `refDistance` to match.
Firefox does not expose the listener as `AudioParam`s yet, so the listener falls back to the older `setPosition` and `setOrientation` methods there.

```ts
const voice = yield* audio.play(sound, {
  spatial: { position: { x: 4, y: 0, z: -2 }, distanceModel: "linear", maxDistance: 30 }
})
yield* voice.setPosition({ x: -4, y: 0, z: -2 })
yield* audio.listener.setPosition({ x: 1, y: 0, z: 0 })
yield* audio.listener.setOrientation({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
```

Attributes: `orientation`, `panningModel` (`"equalpower"` or `"HRTF"`), `distanceModel` (`"linear"`, `"inverse"` or `"exponential"`),
`refDistance`, `maxDistance`, `rolloffFactor`, `coneInnerAngle`, `coneOuterAngle` and `coneOuterGain`.
A non-finite coordinate is a defect for the setters. `pan` and `spatial` can be combined: the stereo pan is applied first.
The panner is only built for voices that use one.

## Autoplay policy

Browsers keep a new `AudioContext` suspended until the page has seen a user gesture. The browser layer resumes it on the first click, key press or touch, then stops listening;
a gesture the browser refuses leaves the listeners in place for the next one. To be sure sound starts at once, call `audio.resume` from your own handler
(a `Promise<void>` method on the promise facade). It does nothing on a running context.

```ts
button.addEventListener("click", () => audio.resume())
```

A voice started before the first gesture waits on the suspended context and starts playing when it runs.

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
