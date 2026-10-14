import { assert, describe, it } from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import { afterEach, vi } from "vitest"
import { Audio, AudioLive, LoadError, Sound } from "../src/index.ts"
import type { FakeContext } from "../src/testing.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"

const buffer = { duration: 1 } as AudioBuffer
const sound = new Sound({ buffer, source: "test.wav" })
const bytes = new ArrayBuffer(8)

const audioLayer = (ctx: FakeContext) => AudioLive.pipe(Layer.provide(FakeAudioContextLive(ctx)))
const decodingContext = () => makeFakeContext({ decodeAudioData: () => Promise.resolve(buffer) })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Audio.decode", () => {
  it.effect("returns the decoded sound with its source", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const result = yield* audio.decode(bytes, "a.wav")
      assert.instanceOf(result, Sound)
      assert.strictEqual(result.buffer, buffer)
      assert.strictEqual(result.source, "a.wav")
    }).pipe(Effect.provide(audioLayer(decodingContext())))
  )

  it.effect("maps an unsupported codec to UnsupportedFormat", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.decode(bytes, "a.opus"))
      assert.instanceOf(error, LoadError)
      assert.strictEqual(error.reason._tag, "UnsupportedFormat")
      assert.strictEqual(error.source, "a.opus")
    }).pipe(
      Effect.provide(
        audioLayer(
          makeFakeContext({ decodeAudioData: () => Promise.reject(new Error("Unsupported codec")) })
        )
      )
    )
  )

  it.effect("maps any other decoder failure to DecodeFailure", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.decode(bytes, "a.mp3"))
      assert.strictEqual(error.reason._tag, "DecodeFailure")
    }).pipe(Effect.provide(audioLayer(makeFakeContext())))
  )

  it.effect("lets callers recover from one reason with catchReason", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const recovered = yield* audio
        .decode(bytes, "a.mp3")
        .pipe(Effect.catchReason("LoadError", "DecodeFailure", () => Effect.succeed("fallback")))
      assert.strictEqual(recovered, "fallback")
    }).pipe(Effect.provide(audioLayer(makeFakeContext())))
  )
})

describe("Audio.load", () => {
  const layer = () => audioLayer(decodingContext())

  it.effect("fetches then decodes", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", () => Promise.resolve(new Response(bytes)))
      const audio = yield* Audio
      const result = yield* audio.load("https://x/a.wav")
      assert.strictEqual(result.source, "https://x/a.wav")
      assert.strictEqual(result.buffer, buffer)
    }).pipe(Effect.provide(layer()))
  )

  it.effect("reports a failed request as NetworkFailure", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")))
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.load("https://x/a.wav"))
      assert.strictEqual(error.reason._tag, "NetworkFailure")
    }).pipe(Effect.provide(layer()))
  )

  it.effect("reports an HTTP error status as NetworkFailure with the status", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", () => Promise.resolve(new Response("nope", { status: 404 })))
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.load("https://x/a.wav"))
      assert.strictEqual(error.reason._tag, "NetworkFailure")
      assert.strictEqual(error.reason._tag === "NetworkFailure" ? error.reason.status : 0, 404)
    }).pipe(Effect.provide(layer()))
  )

  it.effect("reports a body that cannot be read as NetworkFailure", () =>
    Effect.gen(function* () {
      const response = new Response(bytes)
      vi.spyOn(response, "arrayBuffer").mockRejectedValue(new TypeError("connection reset"))
      vi.stubGlobal("fetch", () => Promise.resolve(response))
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.load("https://x/a.wav"))
      assert.strictEqual(error.reason._tag, "NetworkFailure")
    }).pipe(Effect.provide(layer()))
  )

  it.live("aborts the request when interrupted", () =>
    Effect.gen(function* () {
      let signal: AbortSignal | undefined
      vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined
        return new Promise(() => {})
      })
      const audio = yield* Audio
      const fiber = yield* Effect.forkChild(audio.load("https://x/a.wav"))
      yield* Effect.yieldNow
      yield* Fiber.interrupt(fiber)
      assert.isTrue(signal?.aborted)
    }).pipe(Effect.provide(layer()))
  )
})

describe("Audio.play", () => {
  it.effect("wires source to gain to destination with the given options", () => {
    const ctx = makeFakeContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound, { volume: 0.5, rate: 2, loop: true })
      const [source] = ctx.sources
      const [gain] = ctx.gains
      assert.strictEqual(source?.buffer, buffer)
      assert.isTrue(source?.loop)
      assert.strictEqual(source?.playbackRate.value, 2)
      assert.strictEqual(gain?.gain.value, 0.5)
      assert.strictEqual(source?.starts, 1)
    }).pipe(Effect.scoped, Effect.provide(audioLayer(ctx)))
  })

  it.effect("uses unity gain and normal rate by default", () => {
    const ctx = makeFakeContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound).pipe(Effect.scoped)
      assert.strictEqual(ctx.gains[0]?.gain.value, 1)
      assert.strictEqual(ctx.sources[0]?.playbackRate.value, 1)
      assert.isFalse(ctx.sources[0]?.loop)
    }).pipe(Effect.provide(audioLayer(ctx)))
  })

  it.effect("stops and disconnects every node when the scope closes", () => {
    const ctx = makeFakeContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound).pipe(Effect.scoped)
      assert.strictEqual(ctx.sources[0]?.stops, 1)
      assert.strictEqual(ctx.sources[0]?.disconnects, 1)
      assert.strictEqual(ctx.gains[0]?.disconnects, 1)
    }).pipe(Effect.provide(audioLayer(ctx)))
  })

  it.effect("tolerates a source that throws when stopped twice", () => {
    const ctx = makeFakeContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            const source = ctx.sources[0]
            if (source) {
              source.stop = () => {
                throw new Error("InvalidStateError")
              }
            }
          })
        ),
        Effect.scoped
      )
      assert.strictEqual(ctx.sources[0]?.disconnects, 1)
    }).pipe(Effect.provide(audioLayer(ctx)))
  })

  it.effect("ended completes when the engine reports the end of playback", () => {
    const ctx = makeFakeContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      const waiting = yield* Effect.forkChild(voice.ended)
      ctx.sources[0]?.end()
      yield* Fiber.join(waiting)
    }).pipe(Effect.scoped, Effect.provide(audioLayer(ctx)))
  })

  it.effect("ended also completes when the scope closes first", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound).pipe(Effect.scoped)
      yield* voice.ended
    }).pipe(Effect.provide(audioLayer(makeFakeContext())))
  )

  it.effect("stop stops the source", () => {
    const ctx = makeFakeContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.stop
      assert.strictEqual(ctx.sources[0]?.stops, 1)
    }).pipe(Effect.scoped, Effect.provide(audioLayer(ctx)))
  })

  it.effect("fadeTo schedules a linear ramp from the current gain", () => {
    const ctx = makeFakeContext()
    ctx.currentTime = 10
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { volume: 0.8 })
      yield* voice.fadeTo(0, Duration.seconds(2))
      assert.deepStrictEqual(ctx.gains[0]?.gain.calls, [
        { kind: "set", value: 0.8, time: 10 },
        { kind: "ramp", value: 0, time: 12 }
      ])
    }).pipe(Effect.scoped, Effect.provide(audioLayer(ctx)))
  })
})
