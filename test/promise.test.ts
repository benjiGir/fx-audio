import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { afterEach, assert, describe, it, vi } from "vitest"
import {
  AudioContextService,
  LoadError,
  Sound,
  SpriteSegment,
  SpriteSheet,
  UnknownSprite,
  Vector3
} from "../src/index.ts"
import { createAudio, createAudioAsync } from "../src/promise.ts"
import { FakeAudioContextLive, makeFakeContext, makeFakeListener } from "../src/testing.ts"
import { gainAt, voiceGains } from "./helpers/graph.ts"

const buffer = { duration: 1 } as AudioBuffer

afterEach(() => {
  vi.unstubAllGlobals()
})

const setup = () => {
  const listener = makeFakeListener()
  const ctx = makeFakeContext({ decodeAudioData: () => Promise.resolve(buffer), listener })
  return { ctx, listener, audio: createAudio(FakeAudioContextLive(ctx)) }
}

describe("promise facade", () => {
  it("loads a sound", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(new ArrayBuffer(4))))
    const { audio } = setup()
    const sound = await audio.load("https://x/a.wav")
    assert.strictEqual(sound.buffer, buffer)
    await audio.dispose()
  })

  it("rejects with a typed LoadError", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")))
    const { audio } = setup()
    const error = await audio.load("https://x/a.wav").catch((e: unknown) => e)
    assert.instanceOf(error, LoadError)
    assert.strictEqual((error as LoadError).reason._tag, "NetworkFailure")
    await audio.dispose()
  })

  it("aborts a load with the given signal", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })
    })
    const { audio } = setup()
    const controller = new AbortController()
    const pending = audio.load("https://x/a.wav", controller.signal).catch((e: unknown) => e)
    controller.abort()
    assert.isDefined(await pending)
    await audio.dispose()
  })

  it("plays, fades, stops and resolves ended", async () => {
    const { ctx, audio } = setup()
    const voice = audio.play(new Sound({ buffer, source: "a.wav" }), { volume: 0.5 })
    voice.fadeTo(0, 1500)
    assert.deepStrictEqual(voiceGains(ctx)[0]?.gain.calls.at(-1), {
      kind: "ramp",
      value: 0,
      time: 1.5
    })
    voice.stop()
    assert.strictEqual(ctx.sources[0]?.stops, 1)
    ctx.sources[0]?.end()
    await voice.ended
    await audio.dispose()
  })

  it("pans a voice, at start and afterwards", async () => {
    const { ctx, audio } = setup()
    const voice = audio.play(new Sound({ buffer, source: "a.wav" }), { pan: -1 })
    voice.setPan(0.5)
    assert.strictEqual(ctx.panners[0]?.pan.value, 0.5)
    assert.throws(() => voice.setPan(2))
    await audio.dispose()
  })

  it("positions a voice in 3D, at start and afterwards", async () => {
    const { ctx, audio } = setup()
    const voice = audio.play(new Sound({ buffer, source: "a.wav" }), {
      spatial: { position: { x: 1, y: 0, z: 0 } }
    })
    voice.setPosition(new Vector3({ x: 3, y: 0, z: 0 }))
    assert.strictEqual(ctx.spatialPanners[0]?.positionX.value, 3)
    assert.throws(() => voice.setPosition({ x: Number.NaN, y: 0, z: 0 }))
    await audio.dispose()
  })

  it("moves the listener", async () => {
    const { listener, audio } = setup()
    audio.listener.setPosition(new Vector3({ x: 7, y: 0, z: 0 }))
    audio.listener.setOrientation(
      new Vector3({ x: 0, y: 0, z: -2 }),
      new Vector3({ x: 0, y: 3, z: 0 })
    )
    assert.strictEqual(listener.positionX.value, 7)
    assert.strictEqual(listener.forwardZ.value, -2)
    assert.strictEqual(listener.upY.value, 3)
    await audio.dispose()
  })

  it("resumes the context", async () => {
    const { ctx, audio } = setup()
    await audio.resume()
    assert.strictEqual(ctx.resumes, 1)
    await audio.dispose()
  })

  describe("stream", () => {
    const setupStream = () => {
      const ctx = makeFakeContext()
      return {
        ctx,
        audio: createAudio(
          FakeAudioContextLive(ctx, { createMediaElement: ctx.createMediaElement })
        )
      }
    }
    const canPlay = async (ctx: ReturnType<typeof makeFakeContext>) => {
      await Promise.resolve()
      ctx.elements[0]?.emit("canplay")
    }

    it("resolves with a usable voice once the browser can play", async () => {
      const { ctx, audio } = setupStream()
      const pending = audio.stream("https://x/music.mp3", { volume: 0.5 })
      await canPlay(ctx)
      const voice = await pending
      assert.strictEqual(ctx.elements[0]?.plays, 1)
      voice.setPan(0.3)
      assert.strictEqual(ctx.panners[0]?.pan.value, 0.3)
      voice.stop()
      assert.strictEqual(ctx.elements[0]?.pauses, 1)
      await voice.ended
      await audio.dispose()
    })

    it("streams on a group", async () => {
      const { ctx, audio } = setupStream()
      const pending = audio.group("music").stream("https://x/music.mp3")
      await canPlay(ctx)
      await pending
      assert.strictEqual(ctx.elements.length, 1)
      await audio.dispose()
    })

    it("rejects with a typed LoadError", async () => {
      const { ctx, audio } = setupStream()
      const pending = audio.stream("https://x/music.mp3").catch((e: unknown) => e)
      await Promise.resolve()
      ctx.elements[0]?.emit("error")
      assert.instanceOf(await pending, LoadError)
      await audio.dispose()
    })

    it("rejects on invalid options before building an element", async () => {
      const { ctx, audio } = setupStream()
      const error = await audio
        .stream("https://x/music.mp3", { volume: -1 })
        .catch((e: unknown) => e)
      assert.isDefined(error)
      assert.strictEqual(ctx.elements.length, 0)
      await audio.dispose()
    })
  })

  it("throws on invalid play options before touching the engine", async () => {
    const { ctx, audio } = setup()
    assert.throws(() =>
      audio.play(new Sound(new Sound({ buffer, source: "a.wav" })), { volume: -1 })
    )
    assert.strictEqual(ctx.sources.length, 0)
    await audio.dispose()
  })

  it("dispose disconnects voices that are still playing", async () => {
    const { ctx, audio } = setup()
    audio.play(new Sound({ buffer, source: "a.wav" }))
    await audio.dispose()
    assert.strictEqual(ctx.sources[0]?.disconnects, 1)
  })

  describe("playSprite", () => {
    const sound = new Sound({ buffer, source: "fx.wav" })
    const sheet = new SpriteSheet({
      sound,
      segments: { hit: new SpriteSegment({ start: 500, duration: 1000 }) }
    })

    it("plays one segment and returns a usable voice", async () => {
      const { ctx, audio } = setup()
      const voice = audio.playSprite(sheet, "hit", { volume: 0.3 })
      assert.deepStrictEqual(ctx.sources[0]?.startCalls, [{ when: 0, offset: 0.5, duration: 1 }])
      assert.strictEqual(voiceGains(ctx)[0]?.gain.value, 0.3)
      voice.stop()
      ctx.sources[0]?.end()
      await voice.ended
      await audio.dispose()
    })

    it("throws UnknownSprite for a name the sheet does not define", async () => {
      const { ctx, audio } = setup()
      assert.throws(() => audio.playSprite(sheet, "nope"), UnknownSprite)
      assert.strictEqual(ctx.sources.length, 0)
      await audio.dispose()
    })

    it("throws on invalid options before touching the engine", async () => {
      const { ctx, audio } = setup()
      assert.throws(() => audio.playSprite(sheet, "hit", { rate: 0 }))
      assert.strictEqual(ctx.sources.length, 0)
      await audio.dispose()
    })
  })
})

describe("promise facade groups", () => {
  const sound = new Sound({ buffer, source: "a.wav" })

  it("plays through a group routed into the master", async () => {
    const { ctx, audio } = setup()
    const group = audio.group("music")
    group.play(sound)
    assert.deepStrictEqual(gainAt(ctx, 1).connections, [gainAt(ctx, 0)])
    assert.deepStrictEqual(gainAt(ctx, 2).connections, [gainAt(ctx, 1)])
    await audio.dispose()
  })

  it("returns the same group object for the same name", async () => {
    const { ctx, audio } = setup()
    const group = audio.group("music")
    assert.strictEqual(audio.group("music"), group)
    assert.notStrictEqual(audio.group("sfx"), group)
    assert.strictEqual(ctx.gains.length, 3)
    await audio.dispose()
  })

  it("sets the volume, fades, mutes and unmutes a group", async () => {
    const { ctx, audio } = setup()
    ctx.currentTime = 2
    const group = audio.group("music")
    group.setVolume(0.5)
    assert.deepStrictEqual(ctx.gains[1]?.gain.calls.at(-1), { kind: "set", value: 0.5, time: 2 })
    group.fadeTo(0, 1500)
    assert.deepStrictEqual(ctx.gains[1]?.gain.calls.at(-1), { kind: "ramp", value: 0, time: 3.5 })
    group.setVolume(0.6)
    group.mute()
    assert.strictEqual(ctx.gains[1]?.gain.calls.at(-1)?.value, 0)
    group.unmute()
    assert.strictEqual(ctx.gains[1]?.gain.calls.at(-1)?.value, 0.6)
    group.setVolume(0.8)
    assert.strictEqual(ctx.gains[1]?.gain.calls.at(-1)?.value, 0.8)
    await audio.dispose()
  })

  it("throws on an invalid volume", async () => {
    const { audio } = setup()
    const group = audio.group("music")
    assert.throws(() => group.setVolume(-1))
    assert.throws(() => group.fadeTo(Number.NaN, 1000))
    await audio.dispose()
  })

  it("plays a sprite on a group and on the master", async () => {
    const { ctx, audio } = setup()
    const sheet = new SpriteSheet({
      sound,
      segments: { hit: new SpriteSegment({ start: 100, duration: 200 }) }
    })
    audio.group("music").playSprite(sheet, "hit")
    audio.master.playSprite(sheet, "hit")
    assert.strictEqual(ctx.sources.length, 2)
    assert.throws(() => audio.master.playSprite(sheet, "nope"), UnknownSprite)
    await audio.dispose()
  })

  it("controls the master, which top-level play also goes through", async () => {
    const { ctx, audio } = setup()
    audio.master.setVolume(0.2)
    audio.setVolume(0.4)
    audio.mute()
    audio.unmute()
    audio.fadeTo(1, 1000)
    audio.play(sound)
    const master = gainAt(ctx, 0)
    assert.strictEqual(master.gain.calls.find((call) => call.kind === "set")?.value, 0.2)
    assert.deepStrictEqual(gainAt(ctx, 1).connections, [master])
    await audio.dispose()
  })

  it("dispose releases the gain nodes of groups and master", async () => {
    const { ctx, audio } = setup()
    audio.group("music")
    await audio.dispose()
    assert.deepStrictEqual(
      ctx.gains.map((gain) => gain.disconnects),
      [1, 1]
    )
  })
})

describe("promise facade on an asynchronous platform layer", () => {
  it("resolves once the layer has built, then works like the synchronous facade", async () => {
    const ctx = makeFakeContext({ decodeAudioData: () => Promise.resolve(buffer) })
    const delayed = Layer.effect(
      AudioContextService,
      Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5))).pipe(
        Effect.as(AudioContextService.of({ ctx }))
      )
    )
    const audio = await createAudioAsync(delayed)
    audio.play(new Sound({ buffer, source: "a.wav" }), { volume: 0.5 })
    assert.strictEqual(ctx.sources.length, 1)
    await audio.dispose()
  })

  it("rejects with the layer's failure, and releases what it built", async () => {
    const failure = new Error("node-web-audio-api is not installed")
    const broken = Layer.effect(AudioContextService, Effect.die(failure))
    const error = await createAudioAsync(broken).catch((e: unknown) => e)
    assert.strictEqual(error, failure)
  })
})
