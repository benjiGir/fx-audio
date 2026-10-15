import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { Audio, AudioLive, Sound, SpriteSegment, SpriteSheet, Stopped } from "../src/index.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"

const sound = new Sound({ buffer: { duration: 4 } as AudioBuffer, source: "test.wav" })

const setup = () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(
    Layer.provide(FakeAudioContextLive(ctx, { createMediaElement: ctx.createMediaElement }))
  )
  return { ctx, layer }
}

describe("stopAll", () => {
  it.effect("stops every voice on the master, whichever way it started", () => {
    const { ctx, layer } = setup()
    const sheet = new SpriteSheet({
      sound,
      segments: { hit: new SpriteSegment({ start: 0, duration: 500 }) }
    })
    return Effect.gen(function* () {
      const audio = yield* Audio
      const plain = yield* audio.play(sound, { loop: true })
      const sprite = yield* audio.playSprite(sheet, "hit")
      const fiber = yield* Effect.forkChild(audio.stream("https://x/music.mp3"))
      yield* Effect.yieldNow
      ctx.elements[0]?.emit("canplay")
      const streamed = yield* Fiber.join(fiber)
      yield* audio.stopAll
      yield* plain.ended
      yield* sprite.ended
      yield* streamed.ended
      assert.strictEqual(ctx.sources[0]?.stops, 1)
      assert.strictEqual(ctx.elements[0]?.pauses, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("also reaches the voices of the named groups", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      const effects = yield* audio.group("effects")
      const a = yield* music.play(sound)
      const b = yield* effects.play(sound)
      yield* audio.master.stopAll
      yield* a.ended
      yield* b.ended
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("a group only stops its own voices", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      const effects = yield* audio.group("effects")
      const inMusic = yield* music.play(sound)
      const inEffects = yield* effects.play(sound)
      const onMaster = yield* audio.play(sound)
      yield* music.stopAll
      yield* inMusic.ended
      assert.isFalse(yield* inEffects.paused)
      const waiting = yield* Effect.forkChild(Effect.all([inEffects.ended, onMaster.ended]))
      yield* Effect.yieldNow
      assert.isUndefined(waiting.pollUnsafe())
      yield* audio.stopAll
      yield* Fiber.join(waiting)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("sends the stop event to a listener", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      const heard = yield* Effect.forkChild(Stream.runCollect(voice.events))
      yield* Effect.yieldNow
      yield* audio.stopAll
      assert.deepStrictEqual(Array.from(yield* Fiber.join(heard)), [new Stopped()])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("skips voices that already ended, and later voices play normally", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const done = yield* audio.play(sound)
      ctx.sources[0]?.end()
      const stopped = yield* audio.play(sound)
      yield* audio.stopAll
      yield* audio.stopAll
      yield* done.ended
      yield* stopped.ended
      assert.strictEqual(ctx.sources[0]?.stops, 0)
      assert.strictEqual(ctx.sources[1]?.stops, 1)
      const later = yield* audio.play(sound)
      assert.isFalse(yield* later.paused)
      assert.strictEqual(ctx.sources[2]?.stops, 0)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("forgets a voice once its scope has closed", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound).pipe(Effect.scoped)
      assert.strictEqual(ctx.sources[0]?.stops, 1)
      yield* audio.stopAll
      assert.strictEqual(ctx.sources[0]?.stops, 1)
    }).pipe(Effect.provide(layer))
  })
})
