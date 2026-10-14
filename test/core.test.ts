import { assert, describe, it } from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import { afterEach, vi } from "vitest"
import {
  Audio,
  AudioLive,
  LoadError,
  Sound,
  SpriteSegment,
  SpriteSheet,
  UnknownSprite
} from "../src/index.ts"
import type { FakeContext } from "../src/testing.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"
import { gainAt, voiceGains } from "./helpers/graph.ts"

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
      const [gain] = voiceGains(ctx)
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
      assert.strictEqual(voiceGains(ctx)[0]?.gain.value, 1)
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
      assert.strictEqual(voiceGains(ctx)[0]?.disconnects, 1)
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
      assert.deepStrictEqual(voiceGains(ctx)[0]?.gain.calls, [
        { kind: "set", value: 0.8, time: 10 },
        { kind: "ramp", value: 0, time: 12 }
      ])
    }).pipe(Effect.scoped, Effect.provide(audioLayer(ctx)))
  })
})

describe("Audio.playSprite", () => {
  const sheet = new SpriteSheet({
    sound,
    segments: {
      hit: new SpriteSegment({ start: 250, duration: 500 }),
      engine: new SpriteSegment({ start: 1000, duration: 2000, loop: true })
    }
  })

  it.effect("plays only the segment of a one-shot sprite", () => {
    const ctx = makeFakeContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.playSprite(sheet, "hit", { volume: 0.4 })
      const [source] = ctx.sources
      assert.strictEqual(source?.buffer, buffer)
      assert.isFalse(source?.loop)
      assert.deepStrictEqual(source?.startCalls, [{ when: 0, offset: 0.25, duration: 0.5 }])
      assert.strictEqual(voiceGains(ctx)[0]?.gain.value, 0.4)
    }).pipe(Effect.scoped, Effect.provide(audioLayer(ctx)))
  })

  it.effect("loops inside the segment bounds when the segment loops", () => {
    const ctx = makeFakeContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.playSprite(sheet, "engine")
      const [source] = ctx.sources
      assert.isTrue(source?.loop)
      assert.strictEqual(source?.loopStart, 1)
      assert.strictEqual(source?.loopEnd, 3)
      assert.deepStrictEqual(source?.startCalls, [{ when: 0, offset: 1, duration: undefined }])
    }).pipe(Effect.scoped, Effect.provide(audioLayer(ctx)))
  })

  it.effect("lets options.loop override the segment's loop flag", () => {
    const ctx = makeFakeContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.playSprite(sheet, "engine", { loop: false })
      yield* audio.playSprite(sheet, "hit", { loop: true })
      assert.isFalse(ctx.sources[0]?.loop)
      assert.deepStrictEqual(ctx.sources[0]?.startCalls, [{ when: 0, offset: 1, duration: 2 }])
      assert.isTrue(ctx.sources[1]?.loop)
      assert.strictEqual(ctx.sources[1]?.loopEnd, 0.75)
    }).pipe(Effect.scoped, Effect.provide(audioLayer(ctx)))
  })

  it.effect("returns a voice that stops, fades and releases like a plain one", () => {
    const ctx = makeFakeContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.playSprite(sheet, "hit")
      yield* voice.fadeTo(0, Duration.seconds(1))
      yield* voice.stop
      assert.strictEqual(ctx.sources[0]?.stops, 1)
      assert.strictEqual(voiceGains(ctx)[0]?.gain.calls.at(-1)?.kind, "ramp")
    }).pipe(Effect.scoped, Effect.provide(audioLayer(ctx)))
  })

  it.effect("fails with UnknownSprite listing the available names", () => {
    const ctx = makeFakeContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.playSprite(sheet, "nope"))
      assert.instanceOf(error, UnknownSprite)
      assert.strictEqual(error.name, "nope")
      assert.deepStrictEqual(error.available, ["hit", "engine"])
      assert.strictEqual(ctx.sources.length, 0)
    }).pipe(Effect.scoped, Effect.provide(audioLayer(ctx)))
  })

  it.effect("does not resolve names inherited from Object.prototype", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.playSprite(sheet, "toString"))
      assert.strictEqual(error._tag, "UnknownSprite")
    }).pipe(Effect.scoped, Effect.provide(audioLayer(makeFakeContext())))
  )
})

describe("Audio groups", () => {
  const sheet = new SpriteSheet({
    sound,
    segments: { hit: new SpriteSegment({ start: 0, duration: 500 }) }
  })
  const setup = () => {
    const ctx = makeFakeContext()
    ctx.currentTime = 5
    return { ctx, layer: audioLayer(ctx) }
  }

  it.effect("routes a plain play through the master group into the destination", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound)
      const master = gainAt(ctx, 0)
      assert.deepStrictEqual(master.connections, [ctx.destination])
      assert.deepStrictEqual(gainAt(ctx, 1).connections, [master])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("routes the voices of a group through the group into the master", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const group = yield* audio.makeGroup()
      yield* group.play(sound)
      yield* group.playSprite(sheet, "hit")
      const groupGain = gainAt(ctx, 1)
      assert.deepStrictEqual(groupGain.connections, [gainAt(ctx, 0)])
      assert.deepStrictEqual(gainAt(ctx, 2).connections, [groupGain])
      assert.deepStrictEqual(gainAt(ctx, 3).connections, [groupGain])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("releases the group's gain with its scope and keeps the master", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.makeGroup().pipe(Effect.scoped)
      const [master, groupGain] = ctx.gains
      assert.strictEqual(groupGain?.disconnects, 1)
      assert.strictEqual(master?.disconnects, 0)
    }).pipe(Effect.provide(layer))
  })

  it.effect("setVolume replaces any scheduled change at the current time", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const group = yield* audio.makeGroup()
      yield* group.setVolume(0.3)
      assert.deepStrictEqual(ctx.gains[1]?.gain.calls, [
        { kind: "cancel", value: Number.NaN, time: 5 },
        { kind: "set", value: 0.3, time: 5 }
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("mute silences the group and unmute restores the volume it had", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const group = yield* audio.makeGroup()
      yield* group.setVolume(0.6)
      yield* group.mute
      yield* group.mute
      assert.strictEqual(ctx.gains[1]?.gain.calls.at(-1)?.value, 0)
      yield* group.unmute
      assert.strictEqual(ctx.gains[1]?.gain.calls.at(-1)?.value, 0.6)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("a volume set while muted stays silent until unmute", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const group = yield* audio.makeGroup()
      yield* group.mute
      const before = ctx.gains[1]?.gain.calls.length
      yield* group.setVolume(0.9)
      assert.strictEqual(ctx.gains[1]?.gain.calls.length, before)
      yield* group.unmute
      assert.strictEqual(ctx.gains[1]?.gain.calls.at(-1)?.value, 0.9)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("fadeTo ramps linearly from the current gain, replacing an earlier fade", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const group = yield* audio.makeGroup()
      yield* group.fadeTo(0, Duration.seconds(2))
      assert.deepStrictEqual(ctx.gains[1]?.gain.calls, [
        { kind: "cancel", value: Number.NaN, time: 5 },
        { kind: "set", value: 1, time: 5 },
        { kind: "ramp", value: 0, time: 7 }
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("fadeTo while muted schedules nothing but changes the volume unmute restores", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const group = yield* audio.makeGroup()
      yield* group.mute
      const before = ctx.gains[1]?.gain.calls.length
      yield* group.fadeTo(0.4, Duration.seconds(1))
      assert.strictEqual(ctx.gains[1]?.gain.calls.length, before)
      yield* group.unmute
      assert.strictEqual(ctx.gains[1]?.gain.calls.at(-1)?.value, 0.4)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("dies on a negative or non-finite volume and leaves the gain alone", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const group = yield* audio.makeGroup()
      const exits = yield* Effect.all([
        Effect.exit(group.setVolume(-1)),
        Effect.exit(group.setVolume(Number.NaN)),
        Effect.exit(group.fadeTo(-0.5, Duration.seconds(1)))
      ])
      for (const exit of exits) assert.isTrue(exit._tag === "Failure")
      assert.strictEqual(ctx.gains[1]?.gain.calls.length, 0)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("the master group controls everything, including other groups", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.master.setVolume(0.5)
      yield* audio.master.mute
      assert.deepStrictEqual(
        ctx.gains[0]?.gain.calls.map((call) => call.value).filter((v) => !Number.isNaN(v)),
        [0.5, 0]
      )
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})
