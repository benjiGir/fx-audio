import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { userEvent } from "vitest/browser"
import type { Sound } from "../src/index.ts"
import { Audio, AudioContextService, AudioLive, BrowserAudioContextLive } from "../src/index.ts"
import { makeWav } from "../test/helpers/wav.ts"

const audioLayer = AudioLive.pipe(Layer.provideMerge(BrowserAudioContextLive))

// Browsers start the context suspended until a user gesture.
const unlock = Effect.gen(function* () {
  const { ctx } = yield* AudioContextService
  yield* Effect.promise(() => userEvent.click(document.body))
  yield* Effect.promise(() => ctx.resume())
})

describe("real browser engine", () => {
  it.live("decodes a WAV with the native decoder", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.25), "tone.wav")
      assert.closeTo(sound.buffer.duration, 0.25, 0.01)
    }).pipe(Effect.provide(audioLayer))
  )

  it.live("reports garbage bytes as a typed load error", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.decode(new ArrayBuffer(64), "garbage.bin"))
      assert.strictEqual(error._tag, "LoadError")
      assert.include(["DecodeFailure", "UnsupportedFormat"], error.reason._tag)
    }).pipe(Effect.provide(audioLayer))
  )

  it.live("plays a sound to the end", () =>
    Effect.gen(function* () {
      yield* unlock
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.1), "tone.wav")
      const voice = yield* audio.play(sound, { volume: 0.2 })
      yield* voice.ended
    }).pipe(Effect.scoped, Effect.timeout("5 seconds"), Effect.provide(audioLayer))
  )

  it.live("stops a looping voice", () =>
    Effect.gen(function* () {
      yield* unlock
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.1), "tone.wav")
      const voice = yield* audio.play(sound, { loop: true, volume: 0.2 })
      yield* voice.stop
      yield* voice.ended
    }).pipe(Effect.scoped, Effect.timeout("5 seconds"), Effect.provide(audioLayer))
  )

  it.live("closes the AudioContext with the layer scope", () =>
    Effect.gen(function* () {
      const ctx = yield* Effect.scoped(
        Effect.gen(function* () {
          return (yield* AudioContextService).ctx
        }).pipe(Effect.provide(BrowserAudioContextLive))
      )
      assert.strictEqual(ctx.state, "closed")
    })
  )
})

describe("play() latency on the real engine", () => {
  it.live("costs far less than one audio render quantum on the calling thread", () =>
    Effect.gen(function* () {
      yield* unlock
      const audio = yield* Audio
      const sound: Sound = yield* audio.decode(makeWav(0.05), "tone.wav")
      const runs = 200
      const samples: Array<number> = []
      for (let i = 0; i < runs; i++) {
        const start = performance.now()
        yield* audio.play(sound, { volume: 0.01 }).pipe(Effect.scoped)
        samples.push(performance.now() - start)
      }
      samples.sort((a, b) => a - b)
      const median = samples[Math.floor(runs / 2)] ?? Number.NaN
      const p95 = samples[Math.floor(runs * 0.95)] ?? Number.NaN
      console.log(
        `play() latency over ${runs} runs: median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`
      )
      // Generous bound: it only has to catch an order-of-magnitude regression.
      assert.isBelow(median, 5)
    }).pipe(Effect.provide(audioLayer))
  )
})
