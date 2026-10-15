import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { afterEach, vi } from "vitest"
import {
  Audio,
  AudioLive,
  makeSoundBank,
  PlayOptions,
  Sound,
  SpriteSegment,
  SpriteSheet
} from "../src/index.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"
import { gainAt } from "./helpers/graph.ts"

afterEach(() => {
  vi.restoreAllMocks()
})

const sound = (name: string) => new Sound({ buffer: { duration: 2 } as AudioBuffer, source: name })

const setup = () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(
    Layer.provide(FakeAudioContextLive(ctx, { createMediaElement: ctx.createMediaElement }))
  )
  return { ctx, layer }
}

/** Make `Math.random` answer these values, one per call. */
const random = (...values: Array<number>) => {
  const spy = vi.spyOn(Math, "random")
  for (const value of values) spy.mockReturnValueOnce(value)
  return spy
}

describe("rateVariation and volumeVariation", () => {
  it.effect("pick the speed and the volume between 1 - v and 1 + v times the given ones", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      random(0, 0, 0.5, 0.5, 0.75, 0.25)
      // Lowest: 1 - 0.1 and 1 - 0.2.
      yield* audio.play(sound("a"), { rateVariation: 0.1, volumeVariation: 0.2 })
      assert.closeTo(ctx.sources[0]?.playbackRate.value ?? 0, 0.9, 1e-9)
      assert.closeTo(gainAt(ctx, 1).gain.value, 0.8, 1e-9)
      // Middle: unchanged.
      yield* audio.play(sound("a"), { rateVariation: 0.1, volumeVariation: 0.2 })
      assert.closeTo(ctx.sources[1]?.playbackRate.value ?? 0, 1, 1e-9)
      assert.closeTo(gainAt(ctx, 2).gain.value, 1, 1e-9)
      // Scaled from what is asked for, and each varies on its own.
      yield* audio.play(sound("a"), {
        rate: 2,
        volume: 0.5,
        rateVariation: 0.5,
        volumeVariation: 1
      })
      assert.closeTo(ctx.sources[2]?.playbackRate.value ?? 0, 2 * 1.25, 1e-9)
      assert.closeTo(gainAt(ctx, 3).gain.value, 0.5 * 0.5, 1e-9)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("apply to one setting alone, and leave the other as it is", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      random(1 - 1e-9, 0)
      yield* audio.play(sound("a"), { rate: 3, volume: 0.4, rateVariation: 0.5 })
      assert.closeTo(ctx.sources[0]?.playbackRate.value ?? 0, 4.5, 1e-6)
      assert.strictEqual(gainAt(ctx, 1).gain.value, 0.4)
      yield* audio.play(sound("a"), { rate: 3, volume: 0.4, volumeVariation: 0.5 })
      assert.strictEqual(ctx.sources[1]?.playbackRate.value, 3)
      assert.closeTo(gainAt(ctx, 2).gain.value, 0.2, 1e-9)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("cost no random number when there is no variation", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const spy = random()
      yield* audio.play(sound("a"), { rate: 2, volume: 0.3 })
      assert.strictEqual(spy.mock.calls.length, 0)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("apply to sprites and to streams", () => {
    const { ctx, layer } = setup()
    const sheet = new SpriteSheet({
      sound: sound("a"),
      segments: { hit: new SpriteSegment({ start: 0, duration: 500 }) }
    })
    return Effect.gen(function* () {
      const audio = yield* Audio
      random(0, 1 - 1e-9)
      yield* audio.playSprite(sheet, "hit", { rateVariation: 0.5 })
      assert.closeTo(ctx.sources[0]?.playbackRate.value ?? 0, 0.5, 1e-9)
      const fiber = yield* Effect.forkChild(
        audio.stream("https://x/a.mp3", { rateVariation: 0.5, volumeVariation: 0 })
      )
      yield* Effect.yieldNow
      ctx.elements[0]?.emit("canplay")
      yield* Fiber.join(fiber)
      assert.closeTo(ctx.elements[0]?.playbackRate ?? 0, 1.5, 1e-6)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("the variation options", () => {
  const decode = Schema.decodeUnknownSync(PlayOptions)

  it("take 0 to 0.9 for the rate and 0 to 1 for the volume", () => {
    assert.strictEqual(decode({ rateVariation: 0 }).rateVariation, 0)
    assert.strictEqual(decode({ rateVariation: 0.9 }).rateVariation, 0.9)
    assert.strictEqual(decode({ volumeVariation: 1 }).volumeVariation, 1)
    assert.throws(() => decode({ rateVariation: 0.91 }))
    assert.throws(() => decode({ rateVariation: -0.1 }))
    assert.throws(() => decode({ volumeVariation: 1.1 }))
    assert.throws(() => decode({ volumeVariation: Number.NaN }))
  })
})

describe("makeSoundBank", () => {
  const a = sound("a")
  const b = sound("b")
  const c = sound("c")

  it("cycles through the sounds in order and starts again", () => {
    const bank = makeSoundBank([a, b, c], { order: "cycle" })
    assert.strictEqual(bank.size, 3)
    assert.deepStrictEqual([bank.next(), bank.next(), bank.next(), bank.next()], [a, b, c, a])
  })

  it("picks at random and never the same sound twice in a row", () => {
    const bank = makeSoundBank([a, b, c])
    // First pick: 0.5 of 3 gives b. Then 0 of the other two gives a, 0.99 gives c; from c, 0.5 gives b.
    random(0.5, 0, 0.99, 0.5)
    assert.deepStrictEqual([bank.next(), bank.next(), bank.next(), bank.next()], [b, a, c, b])
  })

  it("never repeats over many picks", () => {
    const bank = makeSoundBank([a, b, c])
    let previous: Sound | undefined
    const seen = new Set<Sound>()
    for (let i = 0; i < 300; i++) {
      const next = bank.next()
      assert.notStrictEqual(next, previous)
      seen.add(next)
      previous = next
    }
    assert.strictEqual(seen.size, 3)
  })

  it("gives its only sound every time, whatever the order", () => {
    for (const order of ["random", "cycle"] as const) {
      const bank = makeSoundBank([a], { order })
      assert.deepStrictEqual([bank.next(), bank.next()], [a, a])
    }
  })

  it("does not follow later changes to the list it was given", () => {
    const list = [a, b]
    const bank = makeSoundBank(list, { order: "cycle" })
    list.length = 0
    assert.strictEqual(bank.size, 2)
    assert.deepStrictEqual([bank.next(), bank.next()], [a, b])
  })

  it("refuses an empty list", () => {
    assert.throws(() => makeSoundBank([]), RangeError)
  })
})
