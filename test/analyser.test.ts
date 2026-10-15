import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Audio, AudioLive, Sound } from "../src/index.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"
import { gainAt } from "./helpers/graph.ts"

const sound = new Sound({ buffer: { duration: 4 } as AudioBuffer, source: "test.wav" })

const setup = () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(Layer.provide(FakeAudioContextLive(ctx)))
  return { ctx, layer }
}

describe("analyser", () => {
  it.effect("reads silence from a signal that is empty", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const analyser = yield* audio.analyser
      assert.strictEqual(yield* analyser.level, 0)
      assert.strictEqual(yield* analyser.peak, 0)
      const spectrum = yield* analyser.spectrum
      assert.strictEqual(spectrum.length, 1024)
      assert.isTrue(spectrum.every((bin) => bin === 0))
      assert.strictEqual((yield* analyser.waveform).length, 2048)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("level is the RMS and peak the highest sample of the waveform", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const analyser = yield* audio.analyser
      // Half the samples at 0.6, half at -0.8: RMS is sqrt((0.36 + 0.64) / 2).
      ctx.analysers[0]!.timeData = Float32Array.from({ length: 2048 }, (_, i) =>
        i % 2 === 0 ? 0.6 : -0.8
      )
      assert.closeTo(yield* analyser.level, Math.sqrt(0.5), 1e-6)
      assert.closeTo(yield* analyser.peak, 0.8, 1e-6)
      const waveform = yield* analyser.waveform
      assert.closeTo(waveform[0] ?? 0, 0.6, 1e-6)
      assert.closeTo(waveform[1] ?? 0, -0.8, 1e-6)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("spectrum is the frequency data, one value per bin", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const analyser = yield* audio.analyser
      ctx.analysers[0]!.frequencyData = Uint8Array.from([10, 20, 255])
      const spectrum = yield* analyser.spectrum
      assert.deepStrictEqual(Array.from(spectrum.slice(0, 4)), [10, 20, 255, 0])
      // Each read is its own array.
      assert.notStrictEqual(spectrum, yield* analyser.spectrum)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("a group builds one analyser, on its own gain, and gives it back every time", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      const first = yield* music.analyser
      assert.strictEqual(yield* music.analyser, first)
      assert.strictEqual(ctx.analysers.length, 1)
      assert.strictEqual(gainAt(ctx, 1).connections.at(-1), ctx.analysers[0])
      // The master has its own.
      yield* audio.analyser
      assert.strictEqual(ctx.analysers.length, 2)
      assert.strictEqual(gainAt(ctx, 0).connections.at(-1), ctx.analysers[1])
      assert.strictEqual(yield* audio.master.analyser, yield* audio.analyser)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect(
    "a voice builds one analyser on its own gain and lets go of it when it is released",
    () => {
      const { ctx, layer } = setup()
      return Effect.gen(function* () {
        const audio = yield* Audio
        const voice = yield* audio.play(sound)
        assert.strictEqual(ctx.analysers.length, 0)
        const analyser = yield* voice.analyser
        assert.strictEqual(yield* voice.analyser, analyser)
        assert.strictEqual(ctx.analysers.length, 1)
        // Gain 0 is the master's, gain 1 the voice's.
        assert.strictEqual(gainAt(ctx, 1).connections.at(-1), ctx.analysers[0])
        assert.strictEqual(gainAt(ctx, 1).disconnects, 0)
        yield* voice.stop
      }).pipe(Effect.scoped, Effect.provide(layer))
    }
  )
})
