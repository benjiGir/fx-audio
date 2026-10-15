import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import {
  Audio,
  AudioLive,
  PlaybackBlocked,
  Sound,
  SpriteSegment,
  SpriteSheet,
  type Voice
} from "../src/index.ts"
import type { FakeContext } from "../src/testing.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"
import { gainAt, pannerAt } from "./helpers/graph.ts"

const buffer = { duration: 4 } as AudioBuffer
const sound = new Sound({ buffer, source: "test.wav" })

const setup = () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(
    Layer.provide(FakeAudioContextLive(ctx, { createMediaElement: ctx.createMediaElement }))
  )
  return { ctx, layer }
}

const sourceAt = (ctx: FakeContext, index: number) => {
  const source = ctx.sources[index]
  if (source === undefined) throw new Error(`no source at ${index}`)
  return source
}

const position = (voice: Voice) => voice.position

describe("position", () => {
  it.effect("follows the audio clock, in milliseconds", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      assert.strictEqual(yield* position(voice), 0)
      ctx.currentTime = 1.5
      assert.strictEqual(yield* position(voice), 1500)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("runs faster at a higher rate", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { rate: 2 })
      ctx.currentTime = 1
      assert.strictEqual(yield* position(voice), 2000)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("stops at the end of a sound that does not loop", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      ctx.currentTime = 10
      assert.strictEqual(yield* position(voice), 4000)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("wraps around a looping sound", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { loop: true })
      ctx.currentTime = 5
      assert.strictEqual(yield* position(voice), 1000)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("counts from the start of the segment for a sprite", () => {
    const { ctx, layer } = setup()
    const sheet = new SpriteSheet({
      sound,
      segments: { hit: new SpriteSegment({ start: 1000, duration: 500 }) }
    })
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.playSprite(sheet, "hit")
      ctx.currentTime = 0.25
      assert.strictEqual(yield* position(voice), 250)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("pause and resume", () => {
  it.effect("pause drops the source without ending the voice", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      ctx.currentTime = 1
      yield* voice.pause
      const source = sourceAt(ctx, 0)
      assert.strictEqual(source.stops, 1)
      assert.strictEqual(source.disconnects, 1)
      assert.isNull(source.onended)
      assert.isTrue(yield* voice.paused)
      const waiting = yield* Effect.forkChild(voice.ended)
      yield* Effect.yieldNow
      assert.isUndefined(waiting.pollUnsafe())
      yield* Fiber.interrupt(waiting)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("holds the position while paused", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      ctx.currentTime = 1
      yield* voice.pause
      ctx.currentTime = 3
      assert.strictEqual(yield* position(voice), 1000)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("resume starts a new source where the voice stopped, on the same chain", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { rate: 2, loop: true })
      ctx.currentTime = 1
      yield* voice.pause
      ctx.currentTime = 5
      yield* voice.resume
      assert.isFalse(yield* voice.paused)
      assert.strictEqual(ctx.sources.length, 2)
      const next = sourceAt(ctx, 1)
      assert.deepStrictEqual(next.startCalls, [{ when: 0, offset: 2, duration: undefined }])
      assert.isTrue(next.loop)
      assert.strictEqual(next.playbackRate.value, 2)
      assert.strictEqual(next.buffer, buffer)
      assert.deepStrictEqual(next.connections, [gainAt(ctx, 1)])
      ctx.currentTime = 5.5
      assert.strictEqual(yield* position(voice), 3000)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("pausing twice and resuming a playing voice do nothing", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.resume
      assert.strictEqual(ctx.sources.length, 1)
      yield* voice.pause
      yield* voice.pause
      assert.strictEqual(sourceAt(ctx, 0).stops, 1)
      yield* voice.resume
      yield* voice.resume
      assert.strictEqual(ctx.sources.length, 2)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("stop ends a paused voice", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.pause
      yield* voice.stop
      yield* voice.ended
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("stop ends the voice at once and stops the source once", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.stop
      yield* voice.stop
      yield* voice.ended
      assert.strictEqual(sourceAt(ctx, 0).stops, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("a voice that has ended cannot be paused, resumed or sought", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      sourceAt(ctx, 0).end()
      yield* voice.pause
      yield* voice.seek(1000)
      yield* voice.setRate(2)
      yield* voice.setLoop(true)
      yield* voice.resume
      assert.isFalse(yield* voice.paused)
      assert.strictEqual(ctx.sources.length, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("resumes a sprite voice inside its segment", () => {
    const { ctx, layer } = setup()
    const sheet = new SpriteSheet({
      sound,
      segments: { hit: new SpriteSegment({ start: 1000, duration: 2000 }) }
    })
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.playSprite(sheet, "hit")
      ctx.currentTime = 0.5
      yield* voice.pause
      yield* voice.resume
      assert.deepStrictEqual(sourceAt(ctx, 1).startCalls, [{ when: 0, offset: 1.5, duration: 1.5 }])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("resumes a looping sprite voice with the segment as the loop", () => {
    const { ctx, layer } = setup()
    const sheet = new SpriteSheet({
      sound,
      segments: { engine: new SpriteSegment({ start: 1000, duration: 2000, loop: true }) }
    })
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.playSprite(sheet, "engine")
      ctx.currentTime = 2.5
      yield* voice.pause
      yield* voice.resume
      const next = sourceAt(ctx, 1)
      assert.strictEqual(next.loopStart, 1)
      assert.strictEqual(next.loopEnd, 3)
      assert.deepStrictEqual(next.startCalls, [{ when: 0, offset: 1.5, duration: undefined }])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("releases the replacement source when the scope closes", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* Effect.gen(function* () {
        const voice = yield* audio.play(sound)
        yield* voice.pause
        yield* voice.resume
      }).pipe(Effect.scoped)
      assert.strictEqual(sourceAt(ctx, 1).stops, 1)
      assert.strictEqual(sourceAt(ctx, 1).disconnects, 1)
    }).pipe(Effect.provide(layer))
  })

  it.effect("keeps the chain when the voice has a pan and a position", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { pan: 0.5 })
      yield* voice.pause
      yield* voice.resume
      assert.deepStrictEqual(sourceAt(ctx, 1).connections, [pannerAt(ctx, 0)])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("seek", () => {
  it.effect("restarts a playing voice at the new point", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.seek(2500)
      assert.strictEqual(sourceAt(ctx, 0).stops, 1)
      assert.deepStrictEqual(sourceAt(ctx, 1).startCalls, [
        { when: 0, offset: 2.5, duration: undefined }
      ])
      assert.strictEqual(yield* position(voice), 2500)
      ctx.currentTime = 1
      assert.strictEqual(yield* position(voice), 3500)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("the replaced source ending does not end the voice", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      const first = sourceAt(ctx, 0)
      yield* voice.seek(1000)
      first.end()
      const waiting = yield* Effect.forkChild(voice.ended)
      yield* Effect.yieldNow
      assert.isUndefined(waiting.pollUnsafe())
      sourceAt(ctx, 1).end()
      yield* Fiber.join(waiting)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("only moves the position of a paused voice, and resume plays from there", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.pause
      yield* voice.seek(3000)
      assert.strictEqual(ctx.sources.length, 1)
      assert.strictEqual(yield* position(voice), 3000)
      yield* voice.resume
      assert.deepStrictEqual(sourceAt(ctx, 1).startCalls, [
        { when: 0, offset: 3, duration: undefined }
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("seeks to the start with an offset of zero", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      ctx.currentTime = 1
      yield* voice.seek(0)
      assert.deepStrictEqual(sourceAt(ctx, 1).startCalls, [
        { when: undefined, offset: undefined, duration: undefined }
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("past the end, a voice that does not loop ends", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.seek(4000)
      yield* voice.ended
      assert.strictEqual(ctx.sources.length, 1)
      assert.strictEqual(sourceAt(ctx, 0).stops, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("past the end, a looping voice wraps around", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { loop: true })
      yield* voice.seek(5000)
      assert.deepStrictEqual(sourceAt(ctx, 1).startCalls, [
        { when: 0, offset: 1, duration: undefined }
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("seeks a sprite voice inside its segment", () => {
    const { ctx, layer } = setup()
    const sheet = new SpriteSheet({
      sound,
      segments: { hit: new SpriteSegment({ start: 1000, duration: 2000 }) }
    })
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.playSprite(sheet, "hit")
      yield* voice.seek(500)
      assert.deepStrictEqual(sourceAt(ctx, 1).startCalls, [{ when: 0, offset: 1.5, duration: 1.5 }])
      yield* voice.seek(2000)
      yield* voice.ended
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("dies on a negative or non-finite time", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      assert.throws(() => Effect.runSync(voice.seek(-1)))
      assert.throws(() => Effect.runSync(voice.seek(Number.NaN)))
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("setVolume", () => {
  it.effect("sets the gain at once and cancels a fade", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      ctx.currentTime = 2
      yield* voice.setVolume(0.3)
      assert.deepStrictEqual(gainAt(ctx, 1).gain.calls, [
        { kind: "cancel", value: Number.NaN, time: 2 },
        { kind: "set", value: 0.3, time: 2 }
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("dies on a negative volume", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      assert.throws(() => Effect.runSync(voice.setVolume(-1)))
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("setRate", () => {
  it.effect("changes the speed of the source and keeps the position continuous", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      ctx.currentTime = 1
      yield* voice.setRate(2)
      assert.strictEqual(sourceAt(ctx, 0).playbackRate.value, 2)
      assert.strictEqual(yield* position(voice), 1000)
      ctx.currentTime = 2
      assert.strictEqual(yield* position(voice), 3000)
      assert.strictEqual(ctx.sources.length, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("applies to the next source of a paused voice", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.pause
      yield* voice.setRate(0.5)
      yield* voice.resume
      assert.strictEqual(sourceAt(ctx, 1).playbackRate.value, 0.5)
      ctx.currentTime = 1
      assert.strictEqual(yield* position(voice), 500)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("dies on a rate that is not above zero", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      assert.throws(() => Effect.runSync(voice.setRate(0)))
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("setLoop", () => {
  it.effect("turning looping on restarts the source at the same point, looping", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      ctx.currentTime = 1
      yield* voice.setLoop(true)
      const next = sourceAt(ctx, 1)
      assert.isTrue(next.loop)
      assert.deepStrictEqual(next.startCalls, [{ when: 0, offset: 1, duration: undefined }])
      assert.strictEqual(sourceAt(ctx, 0).stops, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("turning it off on a looping sprite plays out the segment", () => {
    const { ctx, layer } = setup()
    const sheet = new SpriteSheet({
      sound,
      segments: { engine: new SpriteSegment({ start: 1000, duration: 2000, loop: true }) }
    })
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.playSprite(sheet, "engine")
      ctx.currentTime = 0.5
      yield* voice.setLoop(false)
      const next = sourceAt(ctx, 1)
      assert.isFalse(next.loop)
      assert.deepStrictEqual(next.startCalls, [{ when: 0, offset: 1.5, duration: 1.5 }])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("does nothing when the setting is the same", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.setLoop(false)
      assert.strictEqual(ctx.sources.length, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("on a paused voice, applies at resume", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      ctx.currentTime = 1
      yield* voice.pause
      yield* voice.setLoop(true)
      assert.strictEqual(ctx.sources.length, 1)
      yield* voice.resume
      assert.isTrue(sourceAt(ctx, 1).loop)
      assert.deepStrictEqual(sourceAt(ctx, 1).startCalls, [
        { when: 0, offset: 1, duration: undefined }
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("streamed voices", () => {
  const stream = (ctx: FakeContext) =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const fiber = yield* Effect.forkChild(audio.stream("https://x/music.mp3"))
      yield* Effect.yieldNow
      ctx.elements[0]?.emit("canplay")
      return yield* Fiber.join(fiber)
    })

  const element = (ctx: FakeContext) => {
    const found = ctx.elements[0]
    if (found === undefined) throw new Error("no media element")
    return found
  }

  it.effect("pause and resume drive the element", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const voice = yield* stream(ctx)
      yield* voice.pause
      yield* voice.pause
      assert.strictEqual(element(ctx).pauses, 1)
      assert.isTrue(yield* voice.paused)
      yield* voice.resume
      assert.strictEqual(element(ctx).plays, 2)
      assert.isFalse(yield* voice.paused)
      yield* voice.resume
      assert.strictEqual(element(ctx).plays, 2)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("resume fails with PlaybackBlocked when the browser refuses, and stays paused", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const voice = yield* stream(ctx)
      yield* voice.pause
      ctx.playResult = () => Promise.reject(new Error("NotAllowedError"))
      const error = yield* Effect.flip(voice.resume)
      assert.instanceOf(error, PlaybackBlocked)
      assert.strictEqual(error.source, "https://x/music.mp3")
      assert.isTrue(yield* voice.paused)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("seek and position use the element's clock", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const voice = yield* stream(ctx)
      yield* voice.seek(12_500)
      assert.strictEqual(element(ctx).currentTime, 12.5)
      element(ctx).currentTime = 13
      assert.strictEqual(yield* position(voice), 13_000)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("setRate and setLoop set the element's properties", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const voice = yield* stream(ctx)
      yield* voice.setRate(1.5)
      yield* voice.setLoop(true)
      assert.strictEqual(element(ctx).playbackRate, 1.5)
      assert.isTrue(element(ctx).loop)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("setVolume sets the voice gain", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const voice = yield* stream(ctx)
      yield* voice.setVolume(0.2)
      assert.strictEqual(gainAt(ctx, 1).gain.calls.at(-1)?.value, 0.2)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("a stopped stream cannot be resumed", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const voice = yield* stream(ctx)
      yield* voice.pause
      yield* voice.stop
      yield* voice.resume
      assert.strictEqual(element(ctx).plays, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})
