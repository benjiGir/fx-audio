import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Audio, AudioLive, Sound, SpriteSegment, SpriteSheet } from "../src/index.ts"
import type { FakeContext } from "../src/testing.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"

const sound = new Sound({ buffer: { duration: 4 } as AudioBuffer, source: "test.wav" })

const setup = () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(Layer.provide(FakeAudioContextLive(ctx)))
  return { ctx, layer }
}

const startsOf = (ctx: FakeContext, index: number) => {
  const source = ctx.sources[index]
  if (source === undefined) throw new Error(`no source at ${index}`)
  return source.startCalls
}

describe("the audio clock", () => {
  it.effect("is the context time in milliseconds", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      assert.strictEqual(yield* audio.now, 0)
      ctx.currentTime = 1.25
      assert.strictEqual(yield* audio.now, 1250)
    }).pipe(Effect.provide(layer))
  })
})

describe("starting later", () => {
  it.effect("starts at once by default", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      ctx.currentTime = 2
      yield* audio.play(sound)
      assert.deepStrictEqual(startsOf(ctx, 0), [
        { when: undefined, offset: undefined, duration: undefined }
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("`delay` counts from now on the audio clock", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      ctx.currentTime = 2
      yield* audio.play(sound, { delay: 500 })
      assert.deepStrictEqual(startsOf(ctx, 0), [{ when: 2.5, offset: 0, duration: undefined }])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("voices started with the same delay start together", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      ctx.currentTime = 1
      yield* audio.play(sound, { delay: 250 })
      yield* audio.group("music").pipe(Effect.flatMap((group) => group.play(sound, { delay: 250 })))
      assert.strictEqual(startsOf(ctx, 0)[0]?.when, 1.25)
      assert.strictEqual(startsOf(ctx, 1)[0]?.when, 1.25)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("`startAt` is a time on the audio clock, and wins over `delay`", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      ctx.currentTime = 1
      yield* audio.play(sound, { startAt: 3000, delay: 100 })
      assert.strictEqual(startsOf(ctx, 0)[0]?.when, 3)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("a `startAt` already past starts at once", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      ctx.currentTime = 5
      yield* audio.play(sound, { startAt: 1000 })
      assert.deepStrictEqual(startsOf(ctx, 0), [
        { when: undefined, offset: undefined, duration: undefined }
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("a sprite waits too, whether it loops or not", () => {
    const { ctx, layer } = setup()
    const sheet = new SpriteSheet({
      sound,
      segments: {
        hit: new SpriteSegment({ start: 1000, duration: 500 }),
        hum: new SpriteSegment({ start: 2000, duration: 500, loop: true })
      }
    })
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.playSprite(sheet, "hit", { delay: 1000 })
      yield* audio.playSprite(sheet, "hum", { delay: 1000 })
      assert.deepStrictEqual(startsOf(ctx, 0), [{ when: 1, offset: 1, duration: 0.5 }])
      assert.deepStrictEqual(startsOf(ctx, 1), [{ when: 1, offset: 2, duration: undefined }])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("a voice that has not started yet", () => {
  it.effect("is at the start until its time comes, then follows the clock", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { delay: 1000 })
      assert.strictEqual(yield* voice.position, 0)
      ctx.currentTime = 0.5
      assert.strictEqual(yield* voice.position, 0)
      ctx.currentTime = 1.5
      assert.strictEqual(yield* voice.position, 500)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("keeps its time when the rate changes while it waits", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { delay: 1000 })
      ctx.currentTime = 0.5
      yield* voice.setRate(2)
      ctx.currentTime = 1.5
      assert.strictEqual(yield* voice.position, 1000)
      // Once it runs, a new rate takes over from where it is.
      yield* voice.setRate(1)
      ctx.currentTime = 2.5
      assert.strictEqual(yield* voice.position, 2000)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("keeps its time when it is looped while it waits", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { delay: 1000 })
      ctx.currentTime = 0.5
      yield* voice.setLoop(true)
      assert.strictEqual(ctx.sources.length, 2)
      assert.strictEqual(ctx.sources[0]?.stops, 1)
      assert.deepStrictEqual(startsOf(ctx, 1), [{ when: 1, offset: 0, duration: undefined }])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("keeps its time when it is moved while it waits", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { delay: 1000 })
      ctx.currentTime = 0.5
      yield* voice.seek(2000)
      assert.deepStrictEqual(startsOf(ctx, 1), [{ when: 1, offset: 2, duration: undefined }])
      ctx.currentTime = 1.5
      assert.strictEqual(yield* voice.position, 2500)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("starts at once when resumed after a pause that came before its time", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { delay: 1000 })
      ctx.currentTime = 0.5
      yield* voice.pause
      assert.strictEqual(ctx.sources[0]?.stops, 1)
      assert.strictEqual(yield* voice.position, 0)
      yield* voice.resume
      assert.deepStrictEqual(startsOf(ctx, 1), [
        { when: undefined, offset: undefined, duration: undefined }
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("can be stopped before it starts", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { delay: 1000 })
      yield* voice.stop
      yield* voice.ended
      assert.strictEqual(ctx.sources[0]?.stops, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})
