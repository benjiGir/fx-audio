// Code samples of the "Testing your code" page, compiled by `pnpm typecheck`.
import { strict as assert } from "node:assert"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Audio, AudioLive, Sound } from "fx-audio"
import { FakeAudioContextLive, makeFakeContext } from "fx-audio/testing"

// #region test
// The code under test.
const playTwice = (sound: Sound) =>
  Effect.gen(function* () {
    const audio = yield* Audio
    yield* audio.play(sound, { rate: 2 })
    yield* audio.play(sound, { loop: true })
  }).pipe(Effect.scoped)

export const test = async () => {
  const buffer = { duration: 1 } as AudioBuffer
  const sound = new Sound({ buffer, source: "hit.wav" })
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(Layer.provide(FakeAudioContextLive(ctx)))

  await Effect.runPromise(playTwice(sound).pipe(Effect.provide(layer)))

  assert.equal(ctx.sources.length, 2)
  assert.equal(ctx.sources[0]?.playbackRate.value, 2)
  assert.equal(ctx.sources[1]?.loop, true)
  // The scope closed: every source was stopped and disconnected.
  assert.equal(ctx.sources[0]?.stops, 1)
  assert.equal(ctx.sources[0]?.disconnects, 1)
}
// #endregion test

// #region decode
export const decoding = async () => {
  const buffer = { duration: 1 } as AudioBuffer
  const ctx = makeFakeContext({ decodeAudioData: () => Promise.resolve(buffer) })
  const layer = AudioLive.pipe(Layer.provide(FakeAudioContextLive(ctx)))

  const sound = await Effect.runPromise(
    Effect.gen(function* () {
      const audio = yield* Audio
      return yield* audio.decode(new ArrayBuffer(8), "a.wav")
    }).pipe(Effect.provide(layer))
  )
  assert.equal(sound.buffer, buffer)
}
// #endregion decode

// #region end
export const end = async () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(Layer.provide(FakeAudioContextLive(ctx)))
  const sound = new Sound({ buffer: { duration: 1 } as AudioBuffer, source: "a.wav" })

  await Effect.runPromise(
    Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      ctx.sources[0]?.end() // the engine reports the end of playback
      yield* voice.ended // completes now
    }).pipe(Effect.scoped, Effect.provide(layer))
  )
}
// #endregion end
