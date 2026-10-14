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
  UnknownSprite,
  Vector3
} from "../src/index.ts"
import type { FakeContext } from "../src/testing.ts"
import {
  FakeAudioContextLive,
  makeFakeContext,
  makeFakeListener,
  makeLegacyListener
} from "../src/testing.ts"
import { gainAt, pannerAt, spatialAt, voiceGains } from "./helpers/graph.ts"

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
      const offline = new TypeError("offline")
      vi.stubGlobal("fetch", () => Promise.reject(offline))
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.load("https://x/a.wav"))
      assert.strictEqual(error.reason._tag, "NetworkFailure")
      assert.strictEqual(error.reason._tag === "NetworkFailure" ? error.reason.cause : 0, offline)
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
      const reset = new TypeError("connection reset")
      vi.spyOn(response, "arrayBuffer").mockRejectedValue(reset)
      vi.stubGlobal("fetch", () => Promise.resolve(response))
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.load("https://x/a.wav"))
      assert.strictEqual(error.reason._tag, "NetworkFailure")
      assert.strictEqual(error.reason._tag === "NetworkFailure" ? error.reason.cause : 0, reset)
    }).pipe(Effect.provide(layer()))
  )

  describe("local files", () => {
    // One fake `readFile` and one fake `fetch`, so each test sees which of the two was used.
    const setup = () => {
      const read: Array<string> = []
      const fetched: Array<string> = []
      const signals: Array<AbortSignal> = []
      vi.stubGlobal("fetch", (url: string) => {
        fetched.push(url)
        return Promise.resolve(new Response(bytes))
      })
      const layer = AudioLive.pipe(
        Layer.provide(
          FakeAudioContextLive(decodingContext(), {
            readFile: (location, signal) => {
              read.push(location)
              signals.push(signal)
              return Promise.resolve(bytes)
            }
          })
        )
      )
      return { read, fetched, signals, layer }
    }

    const sources = [
      ["a file: URL", "file:///sounds/a.wav"],
      ["an absolute path", "/sounds/a.wav"],
      ["a relative path", "./sounds/a.wav"],
      ["a bare file name", "a.wav"],
      ["a Windows path", "C:\\sounds\\a.wav"]
    ] as const

    for (const [name, source] of sources) {
      it.effect(`reads ${name} from disk instead of fetching it`, () => {
        const { read, fetched, layer } = setup()
        return Effect.gen(function* () {
          const audio = yield* Audio
          const result = yield* audio.load(source)
          assert.deepStrictEqual(read, [source])
          assert.deepStrictEqual(fetched, [])
          assert.strictEqual(result.source, source)
          assert.strictEqual(result.buffer, buffer)
        }).pipe(Effect.provide(layer))
      })
    }

    for (const url of [
      "https://x/a.wav",
      "http://x/a.wav",
      "data:audio/wav;base64,AAAA",
      "blob:x"
    ]) {
      it.effect(`still fetches ${url}`, () => {
        const { read, fetched, layer } = setup()
        return Effect.gen(function* () {
          const audio = yield* Audio
          yield* audio.load(url)
          assert.deepStrictEqual(fetched, [url])
          assert.deepStrictEqual(read, [])
        }).pipe(Effect.provide(layer))
      })
    }

    it.effect("fetches a path when the platform cannot read files", () =>
      Effect.gen(function* () {
        const fetched: Array<string> = []
        vi.stubGlobal("fetch", (url: string) => {
          fetched.push(url)
          return Promise.resolve(new Response(bytes))
        })
        const audio = yield* Audio
        yield* audio.load("sounds/a.wav")
        assert.deepStrictEqual(fetched, ["sounds/a.wav"])
      }).pipe(Effect.provide(audioLayer(decodingContext())))
    )

    it.effect("reports an unreadable file as NetworkFailure with the cause", () => {
      const failure = new Error("ENOENT: no such file")
      const layer = AudioLive.pipe(
        Layer.provide(
          FakeAudioContextLive(decodingContext(), { readFile: () => Promise.reject(failure) })
        )
      )
      return Effect.gen(function* () {
        const audio = yield* Audio
        const error = yield* Effect.flip(audio.load("missing.wav"))
        assert.strictEqual(error.source, "missing.wav")
        assert.strictEqual(error.reason._tag, "NetworkFailure")
        assert.strictEqual(error.reason._tag === "NetworkFailure" ? error.reason.cause : 0, failure)
      }).pipe(Effect.provide(layer))
    })

    it.live("aborts the read when interrupted", () => {
      let signal: AbortSignal | undefined
      const layer = AudioLive.pipe(
        Layer.provide(
          FakeAudioContextLive(decodingContext(), {
            readFile: (_location, given) => {
              signal = given
              return new Promise<ArrayBuffer>(() => {})
            }
          })
        )
      )
      return Effect.gen(function* () {
        const audio = yield* Audio
        const fiber = yield* Effect.forkChild(audio.load("a.wav"))
        yield* Effect.yieldNow
        assert.isFalse(signal?.aborted)
        yield* Fiber.interrupt(fiber)
        assert.isTrue(signal?.aborted)
      }).pipe(Effect.provide(layer))
    })

    it.effect("hands the read an abort signal", () => {
      const { signals, layer } = setup()
      return Effect.gen(function* () {
        const audio = yield* Audio
        yield* audio.load("a.wav")
        assert.instanceOf(signals[0], AbortSignal)
      }).pipe(Effect.provide(layer))
    })
  })

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
      const group = yield* audio.group("music")
      yield* group.play(sound)
      yield* group.playSprite(sheet, "hit")
      const groupGain = gainAt(ctx, 1)
      assert.deepStrictEqual(groupGain.connections, [gainAt(ctx, 0)])
      assert.deepStrictEqual(gainAt(ctx, 2).connections, [groupGain])
      assert.deepStrictEqual(gainAt(ctx, 3).connections, [groupGain])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("returns the same group for the same name and builds its gain once", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const first = yield* audio.group("music")
      const again = yield* audio.group("music")
      const other = yield* audio.group("sfx")
      assert.strictEqual(again, first)
      assert.notStrictEqual(other, first)
      // The master's gain plus one per distinct name.
      assert.strictEqual(ctx.gains.length, 3)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("builds one group when several fibers ask for the same name at once", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const groups = yield* Effect.all(
        Array.from({ length: 20 }, () => audio.group("music")),
        { concurrency: "unbounded" }
      )
      assert.isTrue(groups.every((group) => group === groups[0]))
      assert.strictEqual(ctx.gains.length, 2)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("accepts any name, including ones that exist on Object.prototype", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const first = yield* audio.group("toString")
      assert.strictEqual(yield* audio.group("toString"), first)
      assert.notStrictEqual(yield* audio.group(""), first)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("keeps a group alive after the scope that created it closes", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const group = yield* audio.group("music")
      yield* Effect.scoped(group.play(sound))
      assert.strictEqual(gainAt(ctx, 1).disconnects, 0)
      // Still usable: the voice created now connects to the same gain.
      yield* group.play(sound)
      assert.deepStrictEqual(gainAt(ctx, 3).connections, [gainAt(ctx, 1)])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("releases every group's gain and the master's with the layer", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const audio = yield* Audio
          yield* audio.group("music")
          yield* audio.group("sfx")
        }).pipe(Effect.provide(layer))
      )
      assert.deepStrictEqual(
        ctx.gains.map((gain) => gain.disconnects),
        [1, 1, 1]
      )
    })
  })

  it.effect("setVolume replaces any scheduled change at the current time", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const group = yield* audio.group("music")
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
      const group = yield* audio.group("music")
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
      const group = yield* audio.group("music")
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
      const group = yield* audio.group("music")
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
      const group = yield* audio.group("music")
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
      const group = yield* audio.group("music")
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

describe("stereo pan", () => {
  const setup = () => {
    const ctx = makeFakeContext()
    return { ctx, layer: audioLayer(ctx) }
  }

  it.effect("builds no panner for a voice that does not ask for one", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound)
      assert.strictEqual(ctx.panners.length, 0)
      assert.deepStrictEqual(ctx.sources[0]?.connections, [gainAt(ctx, 1)])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("routes a voice with a pan through a panner set to that pan", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound, { pan: -0.5 })
      const panner = pannerAt(ctx, 0)
      assert.strictEqual(panner.pan.value, -0.5)
      assert.deepStrictEqual(ctx.sources[0]?.connections, [panner])
      assert.deepStrictEqual(panner.connections, [gainAt(ctx, 1)])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("setPan moves an existing panner", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { pan: 0 })
      yield* voice.setPan(1)
      assert.strictEqual(ctx.panners.length, 1)
      assert.strictEqual(ctx.panners[0]?.pan.value, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("setPan inserts the panner on a voice that started without one", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.setPan(-1)
      yield* voice.setPan(0.25)
      const [source] = ctx.sources
      const panner = pannerAt(ctx, 0)
      assert.strictEqual(ctx.panners.length, 1)
      assert.strictEqual(source?.disconnects, 1)
      assert.deepStrictEqual(source?.connections.at(-1), panner)
      assert.deepStrictEqual(panner.connections, [gainAt(ctx, 1)])
      assert.strictEqual(panner.pan.value, 0.25)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("dies on a pan outside -1 to 1 and builds nothing", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      const exits = yield* Effect.all([
        Effect.exit(voice.setPan(1.5)),
        Effect.exit(voice.setPan(-2)),
        Effect.exit(voice.setPan(Number.NaN))
      ])
      for (const exit of exits) assert.isTrue(exit._tag === "Failure")
      assert.strictEqual(ctx.panners.length, 0)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("releases the panner with the voice", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound, { pan: 0.3 }).pipe(Effect.scoped)
      assert.strictEqual(ctx.panners[0]?.disconnects, 1)
    }).pipe(Effect.provide(layer))
  })
})

describe("3D position", () => {
  const setup = () => {
    const ctx = makeFakeContext()
    return { ctx, layer: audioLayer(ctx) }
  }
  const at = (x: number, y: number, z: number) => new Vector3({ x, y, z })

  it.effect("builds no spatial panner for a voice that does not ask for one", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound)
      assert.strictEqual(ctx.spatialPanners.length, 0)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("routes a voice through a panner placed at its position", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound, { spatial: { position: at(1, 2, 3) } })
      const panner = spatialAt(ctx, 0)
      assert.deepStrictEqual(
        [panner.positionX.value, panner.positionY.value, panner.positionZ.value],
        [1, 2, 3]
      )
      assert.deepStrictEqual(ctx.sources[0]?.connections, [panner])
      assert.deepStrictEqual(panner.connections, [gainAt(ctx, 1)])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("leaves the engine defaults alone unless an attribute is given", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound, { spatial: { position: at(0, 0, 0) } })
      const panner = spatialAt(ctx, 0)
      assert.strictEqual(panner.panningModel, "equalpower")
      assert.strictEqual(panner.distanceModel, "inverse")
      assert.strictEqual(panner.refDistance, 1)
      assert.strictEqual(panner.maxDistance, 10000)
      assert.strictEqual(panner.rolloffFactor, 1)
      assert.strictEqual(panner.coneInnerAngle, 360)
      assert.strictEqual(panner.coneOuterAngle, 360)
      assert.strictEqual(panner.coneOuterGain, 0)
      assert.strictEqual(panner.orientationX.calls.length, 0)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("applies every attribute that is given", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound, {
        spatial: {
          position: at(0, 0, 0),
          orientation: at(0, 0, -1),
          panningModel: "HRTF",
          distanceModel: "linear",
          refDistance: 2,
          maxDistance: 50,
          rolloffFactor: 0.5,
          coneInnerAngle: 30,
          coneOuterAngle: 90,
          coneOuterGain: 0.2
        }
      })
      const panner = spatialAt(ctx, 0)
      assert.deepStrictEqual(
        [panner.orientationX.value, panner.orientationY.value, panner.orientationZ.value],
        [0, 0, -1]
      )
      assert.strictEqual(panner.panningModel, "HRTF")
      assert.strictEqual(panner.distanceModel, "linear")
      assert.strictEqual(panner.refDistance, 2)
      assert.strictEqual(panner.maxDistance, 50)
      assert.strictEqual(panner.rolloffFactor, 0.5)
      assert.strictEqual(panner.coneInnerAngle, 30)
      assert.strictEqual(panner.coneOuterAngle, 90)
      assert.strictEqual(panner.coneOuterGain, 0.2)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("setPosition moves an existing panner", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { spatial: { position: at(0, 0, 0) } })
      yield* voice.setPosition(at(4, 5, 6))
      const panner = spatialAt(ctx, 0)
      assert.strictEqual(ctx.spatialPanners.length, 1)
      assert.deepStrictEqual(
        [panner.positionX.value, panner.positionY.value, panner.positionZ.value],
        [4, 5, 6]
      )
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("setPosition inserts the panner on a voice that started without one", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      yield* voice.setPosition(at(1, 0, 0))
      yield* voice.setPosition(at(2, 0, 0))
      const panner = spatialAt(ctx, 0)
      assert.strictEqual(ctx.spatialPanners.length, 1)
      assert.strictEqual(ctx.sources[0]?.disconnects, 1)
      assert.deepStrictEqual(ctx.sources[0]?.connections.at(-1), panner)
      assert.deepStrictEqual(panner.connections, [gainAt(ctx, 1)])
      assert.strictEqual(panner.positionX.value, 2)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("chains the stereo panner before the spatial one when a voice has both", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound, { pan: 0.5, spatial: { position: at(1, 0, 0) } })
      const stereo = pannerAt(ctx, 0)
      const spatial = spatialAt(ctx, 0)
      assert.deepStrictEqual(ctx.sources[0]?.connections, [stereo])
      assert.deepStrictEqual(stereo.connections, [spatial])
      assert.deepStrictEqual(spatial.connections, [gainAt(ctx, 1)])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("rewires a stereo-panned voice when a spatial panner joins it", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { pan: -1 })
      yield* voice.setPosition(at(1, 0, 0))
      const stereo = pannerAt(ctx, 0)
      const spatial = spatialAt(ctx, 0)
      assert.strictEqual(stereo.disconnects, 1)
      assert.deepStrictEqual(stereo.connections, [gainAt(ctx, 1), spatial])
      assert.deepStrictEqual(spatial.connections, [gainAt(ctx, 1)])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("rewires a spatial voice when a stereo panner joins it", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound, { spatial: { position: at(1, 0, 0) } })
      yield* voice.setPan(1)
      const stereo = pannerAt(ctx, 0)
      const spatial = spatialAt(ctx, 0)
      assert.strictEqual(spatial.disconnects, 1)
      assert.deepStrictEqual(ctx.sources[0]?.connections.at(-1), stereo)
      assert.deepStrictEqual(stereo.connections, [spatial])
      assert.deepStrictEqual(spatial.connections.at(-1), gainAt(ctx, 1))
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("dies on a coordinate that is not finite and builds nothing", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      const exits = yield* Effect.all([
        Effect.exit(voice.setPosition({ x: Number.NaN, y: 0, z: 0 })),
        Effect.exit(voice.setPosition({ x: 0, y: Number.POSITIVE_INFINITY, z: 0 }))
      ])
      for (const exit of exits) assert.isTrue(exit._tag === "Failure")
      assert.strictEqual(ctx.spatialPanners.length, 0)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("releases the spatial panner with the voice", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.play(sound, { spatial: { position: at(0, 0, 0) } }).pipe(Effect.scoped)
      assert.strictEqual(ctx.spatialPanners[0]?.disconnects, 1)
    }).pipe(Effect.provide(layer))
  })
})

describe("listener", () => {
  const vec = (x: number, y: number, z: number) => new Vector3({ x, y, z })
  // A plain object: building a `Vector3` with a NaN coordinate would already throw.
  const bad = { x: Number.NaN, y: 0, z: 0 }

  describe("with AudioParams", () => {
    const setup = () => {
      const listener = makeFakeListener()
      return { listener, layer: audioLayer(makeFakeContext({ listener })) }
    }

    it.effect("setPosition places the listener", () => {
      const { listener, layer } = setup()
      return Effect.gen(function* () {
        const audio = yield* Audio
        yield* audio.listener.setPosition(vec(1, 2, 3))
        assert.deepStrictEqual(
          [listener.positionX.value, listener.positionY.value, listener.positionZ.value],
          [1, 2, 3]
        )
      }).pipe(Effect.provide(layer))
    })

    it.effect("setOrientation sets the facing and up directions", () => {
      const { listener, layer } = setup()
      return Effect.gen(function* () {
        const audio = yield* Audio
        yield* audio.listener.setOrientation(vec(1, 0, 0), vec(0, 0, 1))
        assert.deepStrictEqual(
          [listener.forwardX.value, listener.forwardY.value, listener.forwardZ.value],
          [1, 0, 0]
        )
        assert.deepStrictEqual(
          [listener.upX.value, listener.upY.value, listener.upZ.value],
          [0, 0, 1]
        )
      }).pipe(Effect.provide(layer))
    })

    it.effect("dies on a coordinate that is not finite and changes nothing", () => {
      const { listener, layer } = setup()
      return Effect.gen(function* () {
        const audio = yield* Audio
        const exits = yield* Effect.all([
          Effect.exit(audio.listener.setPosition(bad)),
          Effect.exit(audio.listener.setOrientation(vec(1, 1, 1), bad)),
          Effect.exit(audio.listener.setOrientation(bad, vec(1, 1, 1)))
        ])
        for (const exit of exits) assert.isTrue(exit._tag === "Failure")
        for (const param of [listener.positionX, listener.forwardX, listener.upX]) {
          assert.strictEqual(param.value, 1)
        }
      }).pipe(Effect.provide(layer))
    })
  })

  describe("with only the older methods", () => {
    const setup = () => {
      const listener = makeLegacyListener()
      return { listener, layer: audioLayer(makeFakeContext({ listener })) }
    }

    it.effect("setPosition calls setPosition", () => {
      const { listener, layer } = setup()
      return Effect.gen(function* () {
        const audio = yield* Audio
        yield* audio.listener.setPosition(vec(1, 2, 3))
        assert.deepStrictEqual(listener.calls, [{ method: "setPosition", args: [1, 2, 3] }])
      }).pipe(Effect.provide(layer))
    })

    it.effect("setOrientation passes the facing then the up direction", () => {
      const { listener, layer } = setup()
      return Effect.gen(function* () {
        const audio = yield* Audio
        yield* audio.listener.setOrientation(vec(1, 0, 0), vec(0, 0, 1))
        assert.deepStrictEqual(listener.calls, [
          { method: "setOrientation", args: [1, 0, 0, 0, 0, 1] }
        ])
      }).pipe(Effect.provide(layer))
    })

    it.effect("dies on a coordinate that is not finite and calls nothing", () => {
      const { listener, layer } = setup()
      return Effect.gen(function* () {
        const audio = yield* Audio
        const exits = yield* Effect.all([
          Effect.exit(audio.listener.setPosition(bad)),
          Effect.exit(audio.listener.setOrientation(bad, vec(1, 1, 1)))
        ])
        for (const exit of exits) assert.isTrue(exit._tag === "Failure")
        assert.deepStrictEqual(listener.calls, [])
      }).pipe(Effect.provide(layer))
    })
  })

  describe("on a context that cannot move its listener", () => {
    it.effect("dies with a clear message instead of doing nothing", () => {
      const layer = audioLayer(makeFakeContext({ listener: {} }))
      return Effect.gen(function* () {
        const audio = yield* Audio
        const exits = yield* Effect.all([
          Effect.exit(audio.listener.setPosition(vec(0, 0, 0))),
          Effect.exit(audio.listener.setOrientation(vec(0, 0, -1), vec(0, 1, 0)))
        ])
        for (const exit of exits) {
          assert.isTrue(exit._tag === "Failure")
          assert.include(String(exit), "cannot move its listener")
        }
      }).pipe(Effect.provide(layer))
    })
  })
})

describe("resume", () => {
  it.effect("resumes the context", () => {
    const ctx = makeFakeContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* audio.resume
      yield* audio.resume
      assert.strictEqual(ctx.resumes, 2)
    }).pipe(Effect.provide(audioLayer(ctx)))
  })

  it.effect("dies when the engine refuses", () => {
    const ctx = makeFakeContext({ resume: () => Promise.reject(new Error("closed")) })
    return Effect.gen(function* () {
      const audio = yield* Audio
      const exit = yield* Effect.exit(audio.resume)
      assert.isTrue(exit._tag === "Failure")
    }).pipe(Effect.provide(audioLayer(ctx)))
  })
})
