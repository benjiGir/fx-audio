import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import {
  Audio,
  AudioLive,
  Ended,
  LoopChanged,
  Paused,
  RateChanged,
  Resumed,
  Seeked,
  Sound,
  Stopped,
  type Voice,
  type VoiceEvent,
  VolumeChanged
} from "../src/index.ts"
import type { FakeContext } from "../src/testing.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"

const sound = new Sound({ buffer: { duration: 4 } as AudioBuffer, source: "test.wav" })

const setup = () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(
    Layer.provide(FakeAudioContextLive(ctx, { createMediaElement: ctx.createMediaElement }))
  )
  return { ctx, layer }
}

/** Start listening to a voice, and give back what it heard once the stream completes. */
const listen = (voice: Voice) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Stream.runCollect(voice.events))
    yield* Effect.yieldNow
    return fiber
  })

const tags = (events: ReadonlyArray<VoiceEvent>) => events.map((event) => event._tag)

describe("Voice.events", () => {
  it.effect("tells what happens to a voice, then completes with the last event", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      const heard = yield* listen(voice)
      yield* voice.pause
      yield* voice.resume
      yield* voice.seek(1500)
      yield* voice.setRate(2)
      yield* voice.setVolume(0.5)
      yield* voice.setLoop(true)
      yield* voice.stop
      const events = yield* Fiber.join(heard)
      assert.deepStrictEqual(events, [
        new Paused(),
        new Resumed(),
        new Seeked({ position: 1500 }),
        new RateChanged({ rate: 2 }),
        new VolumeChanged({ volume: 0.5 }),
        new LoopChanged({ loop: true }),
        new Stopped()
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("sends end when the sound plays to its end", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      const heard = yield* listen(voice)
      ctx.sources[0]?.end()
      assert.deepStrictEqual(yield* Fiber.join(heard), [new Ended()])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("sends end, and not seek, when a seek goes past the end", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      const heard = yield* listen(voice)
      yield* voice.seek(9000)
      assert.deepStrictEqual(tags(yield* Fiber.join(heard)), ["end"])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("reports the position a looping voice wrapped to", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { loop: true })
      const heard = yield* listen(voice)
      yield* voice.seek(5000)
      yield* voice.stop
      assert.deepStrictEqual(yield* Fiber.join(heard), [
        new Seeked({ position: 1000 }),
        new Stopped()
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("says nothing when pause or resume change nothing", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      const heard = yield* listen(voice)
      yield* voice.resume
      yield* voice.pause
      yield* voice.pause
      yield* voice.stop
      assert.deepStrictEqual(tags(yield* Fiber.join(heard)), ["pause", "stop"])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("sends stop to a listener when the scope closes", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const scoped = yield* Effect.gen(function* () {
        const voice = yield* audio.play(sound)
        return yield* listen(voice)
      }).pipe(Effect.scoped)
      assert.deepStrictEqual(Array.from(yield* Fiber.join(scoped)), [new Stopped()])
    }).pipe(Effect.provide(layer))
  })

  it.effect("every listener hears every event", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      const first = yield* listen(voice)
      const second = yield* listen(voice)
      yield* voice.pause
      yield* voice.stop
      assert.deepStrictEqual(tags(yield* Fiber.join(first)), ["pause", "stop"])
      assert.deepStrictEqual(tags(yield* Fiber.join(second)), ["pause", "stop"])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("only tells what happens after the listener starts", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.pause
      const heard = yield* listen(voice)
      yield* voice.resume
      yield* voice.stop
      assert.deepStrictEqual(tags(yield* Fiber.join(heard)), ["resume", "stop"])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("is empty for a voice that has already ended", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.stop
      assert.deepStrictEqual(Array.from(yield* Stream.runCollect(voice.events)), [])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("a voice nobody listens to builds no hub and still works", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.pause
      yield* voice.resume
      yield* voice.stop
      yield* voice.ended
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("events of a streamed voice", () => {
  const stream = (ctx: FakeContext) =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const fiber = yield* Effect.forkChild(audio.stream("https://x/music.mp3"))
      yield* Effect.yieldNow
      ctx.elements[0]?.emit("canplay")
      return yield* Fiber.join(fiber)
    })

  it.effect("pause, resume, seek and stop", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const voice = yield* stream(ctx)
      const heard = yield* listen(voice)
      yield* voice.pause
      yield* voice.resume
      yield* voice.seek(2000)
      yield* voice.stop
      assert.deepStrictEqual(Array.from(yield* Fiber.join(heard)), [
        new Paused(),
        new Resumed(),
        new Seeked({ position: 2000 }),
        new Stopped()
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("end when the media element reaches its end", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const voice = yield* stream(ctx)
      const heard = yield* listen(voice)
      ctx.elements[0]?.emit("ended")
      assert.deepStrictEqual(Array.from(yield* Fiber.join(heard)), [new Ended()])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("no resume when the browser refuses to restart it", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const voice = yield* stream(ctx)
      yield* voice.pause
      const heard = yield* listen(voice)
      ctx.playResult = () => Promise.reject(new Error("NotAllowedError"))
      yield* Effect.flip(voice.resume)
      yield* voice.stop
      assert.deepStrictEqual(tags(yield* Fiber.join(heard)), ["stop"])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})
