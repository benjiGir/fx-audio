import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as TestClock from "effect/testing/TestClock"
import { Audio, AudioLive, Sound } from "../src/index.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"
import { gainAt } from "./helpers/graph.ts"

const sound = new Sound({ buffer: { duration: 4 } as AudioBuffer, source: "test.wav" })

const setup = () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(Layer.provide(FakeAudioContextLive(ctx)))
  return { ctx, layer }
}

describe("fadeOut", () => {
  it.effect("fades to silence, then stops the voice at the end of the fade", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      const fading = yield* Effect.forkChild(voice.fadeOut(2000))
      yield* Effect.yieldNow
      assert.deepStrictEqual(gainAt(ctx, 1).gain.calls.at(-1), { kind: "ramp", value: 0, time: 2 })
      assert.strictEqual(ctx.sources[0]?.stops, 0)
      yield* TestClock.adjust(1999)
      assert.strictEqual(ctx.sources[0]?.stops, 0)
      yield* TestClock.adjust(1)
      yield* Fiber.join(fading)
      assert.strictEqual(ctx.sources[0]?.stops, 1)
      yield* voice.ended
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("completes at once when the voice is stopped during the fade", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      const fading = yield* Effect.forkChild(voice.fadeOut(2000))
      yield* Effect.yieldNow
      yield* voice.stop
      yield* Fiber.join(fading)
      assert.strictEqual(ctx.sources[0]?.stops, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("does nothing to a voice that has already ended", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      ctx.sources[0]?.end()
      yield* voice.ended
      const callsBefore = gainAt(ctx, 1).gain.calls.length
      yield* voice.fadeOut(2000)
      assert.strictEqual(gainAt(ctx, 1).gain.calls.length, callsBefore)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("crossfade", () => {
  it.effect("starts the new voice silent and fades it up while the old one fades down", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const old = yield* audio.play(sound, { loop: true })
      ctx.currentTime = 10
      const next = yield* audio.crossfade(old, sound, 3000, { volume: 0.8, loop: true })
      // The new voice: silent at first, then up to 0.8 over three seconds.
      assert.strictEqual(gainAt(ctx, 2).gain.value, 0)
      assert.deepStrictEqual(gainAt(ctx, 2).gain.calls.slice(-2), [
        { kind: "set", value: 0, time: 10 },
        { kind: "ramp", value: 0.8, time: 13 }
      ])
      assert.strictEqual(ctx.sources[1]?.loop, true)
      // The old one: down to zero over the same time, then stopped.
      yield* Effect.yieldNow
      assert.deepStrictEqual(gainAt(ctx, 1).gain.calls.at(-1), { kind: "ramp", value: 0, time: 13 })
      assert.strictEqual(ctx.sources[0]?.stops, 0)
      yield* TestClock.adjust(3000)
      yield* old.ended
      assert.strictEqual(ctx.sources[0]?.stops, 1)
      // The new one plays on.
      assert.strictEqual(ctx.sources[1]?.stops, 0)
      assert.isFalse(yield* next.paused)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("fades up to 1 by default, on the group it is called on", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      const old = yield* music.play(sound)
      yield* music.crossfade(old, sound, 1000)
      // Gain 0 is the master, 1 the music group, 2 the old voice, 3 the new one.
      assert.deepStrictEqual(gainAt(ctx, 3).gain.calls.at(-1), { kind: "ramp", value: 1, time: 1 })
      assert.strictEqual(ctx.sources.length, 2)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("stops the old voice at once when the scope closes mid-fade", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const old = yield* audio.play(sound)
      yield* Effect.gen(function* () {
        yield* audio.crossfade(old, sound, 5000)
        yield* Effect.yieldNow
      }).pipe(Effect.scoped)
      yield* old.ended
      assert.strictEqual(ctx.sources[0]?.stops, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})
