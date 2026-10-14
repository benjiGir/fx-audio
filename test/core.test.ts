import { assert, describe, it } from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type * as Scope from "effect/Scope"
import { afterEach, vi } from "vitest"
import type { AudioContextService, Sound } from "../src/index.ts"
import { decode, LoadError, load, play } from "../src/index.ts"
import { FakeContextLive, makeFakeContext } from "../src/testing.ts"

const buffer = { duration: 1 } as AudioBuffer
const sound: Sound = { buffer, source: "test.wav" }
const bytes = new ArrayBuffer(8)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("decode", () => {
  it.effect("returns the decoded sound with its source", () =>
    Effect.gen(function* () {
      const ctx = makeFakeContext({ decodeAudioData: () => Promise.resolve(buffer) })
      const result = yield* decode(bytes, "a.wav").pipe(Effect.provide(FakeContextLive(ctx)))
      assert.deepStrictEqual(result, { buffer, source: "a.wav" })
    })
  )

  it.effect("maps an unsupported codec to unsupported-format", () =>
    Effect.gen(function* () {
      const ctx = makeFakeContext({
        decodeAudioData: () => Promise.reject(new Error("Unsupported codec"))
      })
      const error = yield* decode(bytes, "a.opus").pipe(
        Effect.provide(FakeContextLive(ctx)),
        Effect.flip
      )
      assert.instanceOf(error, LoadError)
      assert.strictEqual(error.reason, "unsupported-format")
      assert.strictEqual(error.source, "a.opus")
    })
  )

  it.effect("maps any other decoder failure to decode", () =>
    Effect.gen(function* () {
      const error = yield* decode(bytes, "a.mp3").pipe(
        Effect.provide(FakeContextLive(makeFakeContext())),
        Effect.flip
      )
      assert.strictEqual(error.reason, "decode")
    })
  )
})

describe("load", () => {
  const ctxLayer = () =>
    FakeContextLive(makeFakeContext({ decodeAudioData: () => Promise.resolve(buffer) }))

  it.effect("fetches then decodes", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", () => Promise.resolve(new Response(bytes)))
      const result = yield* load("https://x/a.wav").pipe(Effect.provide(ctxLayer()))
      assert.strictEqual(result.source, "https://x/a.wav")
      assert.strictEqual(result.buffer, buffer)
    })
  )

  it.effect("reports a network failure", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")))
      const error = yield* load("https://x/a.wav").pipe(Effect.provide(ctxLayer()), Effect.flip)
      assert.strictEqual(error.reason, "network")
    })
  )

  it.effect("reports an HTTP error status as a network failure", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", () => Promise.resolve(new Response("nope", { status: 404 })))
      const error = yield* load("https://x/a.wav").pipe(Effect.provide(ctxLayer()), Effect.flip)
      assert.strictEqual(error.reason, "network")
      assert.match(String(error.cause), /404/)
    })
  )

  it.live("aborts the request when interrupted", () =>
    Effect.gen(function* () {
      let signal: AbortSignal | undefined
      vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined
        return new Promise(() => {})
      })
      const fiber = yield* Effect.forkChild(
        load("https://x/a.wav").pipe(Effect.provide(ctxLayer()))
      )
      yield* Effect.yieldNow
      yield* Fiber.interrupt(fiber)
      assert.isTrue(signal?.aborted)
    })
  )
})

describe("play", () => {
  const run = <A, E>(
    effect: Effect.Effect<A, E, AudioContextService | Scope.Scope>,
    ctx = makeFakeContext()
  ) => effect.pipe(Effect.scoped, Effect.provide(FakeContextLive(ctx)))

  it.effect("wires source to gain to destination with the given options", () =>
    Effect.gen(function* () {
      const ctx = makeFakeContext()
      yield* run(
        play(sound, { volume: 0.5, rate: 2, loop: true }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              const [source] = ctx.sources
              const [gain] = ctx.gains
              assert.strictEqual(source?.buffer, buffer)
              assert.isTrue(source?.loop)
              assert.strictEqual(source?.playbackRate.value, 2)
              assert.strictEqual(gain?.gain.value, 0.5)
              assert.strictEqual(source?.starts, 1)
            })
          )
        ),
        ctx
      )
    })
  )

  it.effect("uses unity gain and normal rate by default", () =>
    Effect.gen(function* () {
      const ctx = makeFakeContext()
      yield* run(play(sound), ctx)
      assert.strictEqual(ctx.gains[0]?.gain.value, 1)
      assert.strictEqual(ctx.sources[0]?.playbackRate.value, 1)
      assert.isFalse(ctx.sources[0]?.loop)
    })
  )

  it.effect("stops and disconnects every node when the scope closes", () =>
    Effect.gen(function* () {
      const ctx = makeFakeContext()
      yield* run(play(sound), ctx)
      assert.strictEqual(ctx.sources[0]?.stops, 1)
      assert.strictEqual(ctx.sources[0]?.disconnects, 1)
      assert.strictEqual(ctx.gains[0]?.disconnects, 1)
    })
  )

  it.effect("tolerates a source that throws when stopped twice", () =>
    Effect.gen(function* () {
      const ctx = makeFakeContext()
      yield* run(
        play(sound).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              const source = ctx.sources[0]
              if (source) {
                source.stop = () => {
                  throw new Error("InvalidStateError")
                }
              }
            })
          )
        ),
        ctx
      )
      assert.strictEqual(ctx.sources[0]?.disconnects, 1)
    })
  )

  it.effect("ended completes when the engine reports the end of playback", () =>
    Effect.gen(function* () {
      const ctx = makeFakeContext()
      yield* run(
        Effect.gen(function* () {
          const voice = yield* play(sound)
          const waiting = yield* Effect.forkChild(voice.ended)
          ctx.sources[0]?.end()
          yield* Fiber.join(waiting)
        }),
        ctx
      )
    })
  )

  it.effect("ended also completes when the scope closes first", () =>
    Effect.gen(function* () {
      const ctx = makeFakeContext()
      const voice = yield* run(play(sound), ctx)
      yield* voice.ended
    })
  )

  it.effect("stop stops the source", () =>
    Effect.gen(function* () {
      const ctx = makeFakeContext()
      yield* run(
        Effect.gen(function* () {
          const voice = yield* play(sound)
          yield* voice.stop
          assert.strictEqual(ctx.sources[0]?.stops, 1)
        }),
        ctx
      )
    })
  )

  it.effect("fadeTo schedules a linear ramp from the current gain", () =>
    Effect.gen(function* () {
      const ctx = makeFakeContext()
      ctx.currentTime = 10
      yield* run(
        Effect.gen(function* () {
          const voice = yield* play(sound, { volume: 0.8 })
          yield* voice.fadeTo(0, Duration.seconds(2))
        }),
        ctx
      )
      assert.deepStrictEqual(ctx.gains[0]?.gain.calls, [
        { kind: "set", value: 0.8, time: 10 },
        { kind: "ramp", value: 0, time: 12 }
      ])
    })
  )
})
