import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { Audio, AudioLive, Sound, Stopped } from "../src/index.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"

const sound = new Sound({ buffer: { duration: 4 } as AudioBuffer, source: "test.wav" })

const setup = () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(
    Layer.provide(FakeAudioContextLive(ctx, { createMediaElement: ctx.createMediaElement }))
  )
  return { ctx, layer }
}

describe("voiceCount", () => {
  it.effect("counts the voices playing, paused ones too, and drops the ones that end", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      assert.strictEqual(yield* audio.voiceCount, 0)
      const first = yield* audio.play(sound)
      const second = yield* music.play(sound)
      yield* music.play(sound)
      yield* second.pause
      // The master counts every group's voices, the group only its own.
      assert.strictEqual(yield* audio.voiceCount, 3)
      assert.strictEqual(yield* audio.master.voiceCount, 3)
      assert.strictEqual(yield* music.voiceCount, 2)
      yield* first.stop
      ctx.sources[2]?.end()
      assert.strictEqual(yield* audio.voiceCount, 1)
      assert.strictEqual(yield* music.voiceCount, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("setMaxVoices", () => {
  it.effect("stops the oldest voice when a new one starts over the cap", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setMaxVoices(2)
      const first = yield* audio.play(sound)
      const second = yield* audio.play(sound)
      const third = yield* audio.play(sound)
      assert.strictEqual(yield* audio.voiceCount, 2)
      assert.strictEqual(ctx.sources[0]?.stops, 1)
      assert.strictEqual(ctx.sources[1]?.stops, 0)
      yield* first.ended
      const fourth = yield* audio.play(sound)
      assert.strictEqual(ctx.sources[1]?.stops, 1)
      yield* second.ended
      assert.strictEqual(yield* audio.voiceCount, 2)
      assert.isFalse(yield* third.paused)
      assert.isFalse(yield* fourth.paused)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("tells the stolen voice it was stopped", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setMaxVoices(1)
      const first = yield* audio.play(sound)
      const heard = yield* Effect.forkChild(Stream.runCollect(first.events))
      yield* Effect.yieldNow
      yield* audio.play(sound)
      assert.deepStrictEqual(yield* Fiber.join(heard), [new Stopped()])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("caps a group on its own, and the master across every group", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sfx = yield* audio.group("sfx")
      const music = yield* audio.group("music")
      yield* sfx.setMaxVoices(2)
      yield* audio.master.setMaxVoices(3)
      yield* sfx.play(sound)
      yield* sfx.play(sound)
      yield* sfx.play(sound)
      assert.strictEqual(yield* sfx.voiceCount, 2)
      yield* music.play(sound)
      assert.strictEqual(yield* audio.voiceCount, 3)
      // The master is full: the oldest voice of any group makes room.
      yield* music.play(sound)
      assert.strictEqual(yield* audio.voiceCount, 3)
      assert.strictEqual(yield* sfx.voiceCount, 1)
      assert.strictEqual(yield* music.voiceCount, 2)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect(
    "lowering the cap stops the oldest voices at once, removing it lets voices pile up",
    () => {
      const { ctx, layer } = setup()
      return Effect.gen(function* () {
        const audio = yield* Audio
        for (let i = 0; i < 4; i++) yield* audio.play(sound)
        yield* audio.master.setMaxVoices(3)
        assert.strictEqual(yield* audio.voiceCount, 3)
        assert.strictEqual(ctx.sources[0]?.stops, 1)
        yield* audio.master.setMaxVoices(1)
        assert.strictEqual(yield* audio.voiceCount, 1)
        assert.strictEqual(ctx.sources[3]?.stops, 0)
        yield* audio.master.setMaxVoices(undefined)
        for (let i = 0; i < 5; i++) yield* audio.play(sound)
        assert.strictEqual(yield* audio.voiceCount, 6)
      }).pipe(Effect.scoped, Effect.provide(layer))
    }
  )

  it.effect("counts streams too", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setMaxVoices(1)
      const fiber = yield* Effect.forkChild(audio.stream("https://x/a.mp3"))
      yield* Effect.yieldNow
      ctx.elements[0]?.emit("canplay")
      yield* Fiber.join(fiber)
      assert.strictEqual(yield* audio.voiceCount, 1)
      yield* audio.play(sound)
      assert.strictEqual(yield* audio.voiceCount, 1)
      assert.strictEqual(ctx.elements[0]?.pauses, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("dies on a cap that is not a whole number of one or more", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const exit = yield* Effect.exit(audio.master.setMaxVoices(bad))
        assert.isTrue(exit._tag === "Failure", `cap ${bad}`)
      }
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("state", () => {
  it.effect("is the state of the audio context", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      assert.strictEqual(yield* audio.state, "running")
      ;(ctx as { state: string }).state = "interrupted"
      assert.strictEqual(yield* audio.state, "interrupted")
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})
