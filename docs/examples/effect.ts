// Code samples of the "Using Effect" page, compiled by `pnpm typecheck`.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
  Audio,
  AudioBrowserLive,
  AudioLive,
  BrowserAudioContextLive,
  PlayOptions,
  type Sound
} from "fx-audio"
import { NodeAudioContextLive } from "fx-audio/node"

// #region layers
// In the browser: the Audio service on top of the browser's audio context.
export const browser = AudioBrowserLive
// Which is the same as building it yourself.
export const sameBrowser = AudioLive.pipe(Layer.provide(BrowserAudioContextLive))
// Under Node: the same service on top of node-web-audio-api.
export const node = AudioLive.pipe(Layer.provide(NodeAudioContextLive({ silent: true })))
// #endregion layers

// #region scope
export const playUntilItEnds = (sound: Sound) =>
  Effect.gen(function* () {
    const audio = yield* Audio
    const voice = yield* audio.play(sound)
    yield* voice.ended
  }).pipe(Effect.scoped) // the voice is stopped and its nodes released when the scope closes
// #endregion scope

// #region interrupt
export const loadWithTimeout = Effect.gen(function* () {
  const audio = yield* Audio
  // Interrupting `load` aborts the request.
  return yield* audio.load("/sounds/hit.mp3").pipe(Effect.timeout("3 seconds"))
})
// #endregion interrupt

// #region decode
export const fromBytes = (bytes: ArrayBuffer) =>
  Effect.gen(function* () {
    const audio = yield* Audio
    return yield* audio.decode(bytes, "from-the-cache.mp3")
  })
// #endregion decode

// #region validate
export const fromUntrustedInput = (input: unknown, sound: Sound) =>
  Effect.gen(function* () {
    const audio = yield* Audio
    const options = Schema.decodeUnknownSync(PlayOptions)(input) // throws on volume: -1
    return yield* audio.play(sound, options)
  })
// #endregion validate
