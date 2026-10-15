import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { Audio, AudioEffect, AudioLive, Compressor, Echo, Filter, Reverb } from "../src/index.ts"
import type { FakeGain } from "../src/testing.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"
import { gainAt } from "./helpers/graph.ts"

const nodeAt = <T>(list: ReadonlyArray<T>, index = 0): T => {
  const node = list[index]
  if (node === undefined) throw new Error(`no node at ${index}`)
  return node
}

const setup = () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(Layer.provide(FakeAudioContextLive(ctx)))
  return { ctx, layer }
}

describe("a filter", () => {
  it.effect("sits between the group's gain and its output", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      yield* music.setEffects([new Filter({ type: "lowpass", frequency: 800 })])
      const [filter] = ctx.filters
      assert.strictEqual(filter?.type, "lowpass")
      assert.strictEqual(filter?.frequency.value, 800)
      assert.strictEqual(filter?.Q.value, 1)
      assert.strictEqual(filter?.gain.value, 0)
      // Gain 0 is the master's, gain 1 the music group's.
      const group = gainAt(ctx, 1)
      assert.deepStrictEqual(group.disconnectedFrom, [gainAt(ctx, 0)])
      assert.strictEqual(group.connections.at(-1), filter)
      assert.deepStrictEqual(filter?.connections, [gainAt(ctx, 0)])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("takes a sharpness and a gain for the shelving types", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setEffects([
        new Filter({ type: "highshelf", frequency: 6000, q: 0.7, gain: -6 })
      ])
      assert.strictEqual(ctx.filters[0]?.type, "highshelf")
      assert.strictEqual(ctx.filters[0]?.Q.value, 0.7)
      assert.strictEqual(ctx.filters[0]?.gain.value, -6)
      // The master's output is the destination of the context.
      assert.deepStrictEqual(gainAt(ctx, 0).disconnectedFrom, [ctx.destination])
      assert.deepStrictEqual(ctx.filters[0]?.connections, [ctx.destination])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("a compressor", () => {
  it.effect("keeps the Web Audio defaults for what is left out", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setEffects([new Compressor({})])
      const [compressor] = ctx.compressors
      for (const param of [
        compressor?.threshold,
        compressor?.knee,
        compressor?.ratio,
        compressor?.attack,
        compressor?.release
      ]) {
        assert.deepStrictEqual(param?.calls, [])
      }
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("sets what is given", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setEffects([
        new Compressor({ threshold: -30, knee: 10, ratio: 4, attack: 0.01, release: 0.5 })
      ])
      const [compressor] = ctx.compressors
      assert.strictEqual(compressor?.threshold.value, -30)
      assert.strictEqual(compressor?.knee.value, 10)
      assert.strictEqual(compressor?.ratio.value, 4)
      assert.strictEqual(compressor?.attack.value, 0.01)
      assert.strictEqual(compressor?.release.value, 0.5)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("an echo", () => {
  it.effect("adds a delayed, fed-back copy to the dry sound", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setEffects([new Echo({ time: 250, feedback: 0.5, mix: 0.25 })])
      const delay = nodeAt(ctx.delays)
      assert.strictEqual(delay.delayTime.value, 0.25)
      assert.strictEqual(delay.maxDelayTime, 5)
      // Gains: 0 is the master, then the echo's feedback, input, dry, wet and output.
      const [feedback, input, dry, wet, output] = [1, 2, 3, 4, 5].map((i) => gainAt(ctx, i)) as [
        FakeGain,
        FakeGain,
        FakeGain,
        FakeGain,
        FakeGain
      ]
      assert.strictEqual(dry.gain.value, 0.75)
      assert.strictEqual(wet.gain.value, 0.25)
      assert.strictEqual(feedback.gain.value, 0.5)
      assert.deepStrictEqual(input.connections, [dry, delay])
      assert.deepStrictEqual(dry.connections, [output])
      assert.deepStrictEqual(delay.connections, [wet, feedback])
      assert.deepStrictEqual(wet.connections, [output])
      assert.deepStrictEqual(feedback.connections, [delay])
      // The master feeds the echo and the echo feeds the destination.
      assert.strictEqual(gainAt(ctx, 0).connections.at(-1), input)
      assert.deepStrictEqual(output.connections, [ctx.destination])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("has a default feedback and mix", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setEffects([new Echo({ time: 0 })])
      assert.strictEqual(ctx.delays[0]?.delayTime.value, 0)
      assert.strictEqual(gainAt(ctx, 1).gain.value, 0.4)
      assert.strictEqual(gainAt(ctx, 3).gain.value, 0.5)
      assert.strictEqual(gainAt(ctx, 4).gain.value, 0.5)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("a reverb", () => {
  it.effect("convolves the sound with noise that dies away", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setEffects([new Reverb({ seconds: 0.5, decay: 3, mix: 0.4 })])
      const convolver = nodeAt(ctx.convolvers)
      const [buffer] = ctx.buffers
      assert.strictEqual(convolver.buffer, buffer as unknown)
      assert.strictEqual(buffer?.numberOfChannels, 2)
      assert.strictEqual(buffer?.sampleRate, 44100)
      assert.strictEqual(buffer?.length, 22050)
      for (const channel of [0, 1]) {
        const data = buffer?.getChannelData(channel) as Float32Array
        const loud = data.slice(0, 2000).reduce((max, v) => Math.max(max, Math.abs(v)), 0)
        const quiet = data.slice(-2000).reduce((max, v) => Math.max(max, Math.abs(v)), 0)
        assert.isAbove(loud, 0.5)
        assert.isBelow(quiet, 0.001)
        assert.isTrue(data.every((v) => Math.abs(v) <= 1))
      }
      // Gains: 0 master, then input, dry, wet, output.
      assert.strictEqual(gainAt(ctx, 2).gain.value, 0.6)
      assert.strictEqual(gainAt(ctx, 3).gain.value, 0.4)
      assert.deepStrictEqual(gainAt(ctx, 1).connections, [gainAt(ctx, 2), convolver])
      assert.deepStrictEqual(convolver.connections, [gainAt(ctx, 3)])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("lasts two seconds with a mix of 0.3 by default", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setEffects([new Reverb({})])
      assert.strictEqual(ctx.buffers[0]?.length, 88200)
      assert.strictEqual(gainAt(ctx, 3).gain.value, 0.3)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("setEffects", () => {
  it.effect("chains the effects in order", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setEffects([
        new Filter({ type: "highpass", frequency: 100 }),
        new Compressor({}),
        new Filter({ type: "lowpass", frequency: 9000 })
      ])
      const highpass = nodeAt(ctx.filters, 0)
      const lowpass = nodeAt(ctx.filters, 1)
      const compressor = nodeAt(ctx.compressors)
      assert.strictEqual(gainAt(ctx, 0).connections.at(-1), highpass)
      assert.deepStrictEqual(highpass.connections, [compressor])
      assert.deepStrictEqual(compressor.connections, [lowpass])
      assert.deepStrictEqual(lowpass.connections, [ctx.destination])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("replaces the earlier effects and lets go of their nodes", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const master = audio.master
      yield* master.setEffects([
        new Filter({ type: "lowpass", frequency: 500 }),
        new Echo({ time: 100 }),
        new Reverb({ seconds: 0.2 }),
        new Compressor({})
      ])
      const first = ctx.filters[0]
      yield* master.setEffects([new Filter({ type: "notch", frequency: 60 })])
      // The master gain stopped feeding the first effect, and every old node was let go.
      assert.strictEqual(gainAt(ctx, 0).disconnectedFrom.at(-1), first)
      // Nine gains: the echo's five and the reverb's four.
      const old = [
        first,
        ctx.delays[0],
        ctx.convolvers[0],
        ctx.compressors[0],
        ...ctx.gains.slice(1, 10)
      ]
      assert.strictEqual(old.length, 13)
      for (const node of old) assert.strictEqual(node?.disconnects, 1)
      assert.strictEqual(ctx.filters.length, 2)
      assert.strictEqual(gainAt(ctx, 0).connections.at(-1), ctx.filters[1])
      assert.deepStrictEqual(ctx.filters[1]?.connections, [ctx.destination])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("an empty list takes them all off and plays straight to the output again", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setEffects([new Compressor({})])
      yield* audio.master.setEffects([])
      assert.strictEqual(gainAt(ctx, 0).connections.at(-1), ctx.destination)
      assert.strictEqual(ctx.compressors[0]?.disconnects, 1)
      // Nothing to take off: it only reconnects.
      yield* audio.master.setEffects([])
      assert.deepStrictEqual(gainAt(ctx, 0).disconnectedFrom.slice(-1), [ctx.destination])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("applies to voices that play before and after", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      const sound = { buffer: { duration: 1 }, source: "a.wav" } as never
      yield* music.play(sound)
      yield* music.setEffects([new Filter({ type: "lowpass", frequency: 500 })])
      yield* music.play(sound)
      // Both voices end at the music group's gain, which now feeds the filter.
      assert.strictEqual(gainAt(ctx, 2).connections.at(-1), gainAt(ctx, 1))
      assert.strictEqual(gainAt(ctx, 3).connections.at(-1), gainAt(ctx, 1))
      assert.strictEqual(gainAt(ctx, 1).connections.at(-1), ctx.filters[0])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("the effect schemas", () => {
  const decode = Schema.decodeUnknownSync(AudioEffect)

  it("decode a plain object by its tag", () => {
    assert.instanceOf(decode({ _tag: "filter", type: "peaking", frequency: 1000, gain: 3 }), Filter)
    assert.instanceOf(decode({ _tag: "echo", time: 100 }), Echo)
    assert.instanceOf(decode({ _tag: "reverb" }), Reverb)
    assert.instanceOf(decode({ _tag: "compressor", ratio: 20 }), Compressor)
    assert.throws(() => decode({ _tag: "chorus" }))
  })

  it("refuse values outside what Web Audio takes", () => {
    for (const bad of [
      { _tag: "filter", type: "lowpass", frequency: 0 },
      { _tag: "filter", type: "wobble", frequency: 100 },
      { _tag: "filter", type: "lowpass", frequency: 100, q: 0 },
      { _tag: "filter", type: "peaking", frequency: 100, gain: Number.NaN },
      { _tag: "echo", time: -1 },
      { _tag: "echo", time: 5001 },
      { _tag: "echo", time: 100, feedback: 1 },
      { _tag: "echo", time: 100, mix: 1.1 },
      { _tag: "reverb", seconds: 0.05 },
      { _tag: "reverb", seconds: 11 },
      { _tag: "reverb", decay: 0 },
      { _tag: "reverb", mix: -0.1 },
      { _tag: "compressor", threshold: 1 },
      { _tag: "compressor", knee: 41 },
      { _tag: "compressor", ratio: 0.5 },
      { _tag: "compressor", attack: 1.5 },
      { _tag: "compressor", release: -1 }
    ]) {
      assert.throws(() => decode(bad))
    }
  })
})
