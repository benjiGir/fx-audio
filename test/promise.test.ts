import { afterEach, assert, describe, it, vi } from "vitest"
import { LoadError, Sound } from "../src/index.ts"
import { createAudio } from "../src/promise.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"

const buffer = { duration: 1 } as AudioBuffer

afterEach(() => {
  vi.unstubAllGlobals()
})

const setup = () => {
  const ctx = makeFakeContext({ decodeAudioData: () => Promise.resolve(buffer) })
  return { ctx, audio: createAudio(FakeAudioContextLive(ctx)) }
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
    voice.fadeTo(0, 1.5)
    assert.deepStrictEqual(ctx.gains[0]?.gain.calls.at(-1), { kind: "ramp", value: 0, time: 1.5 })
    voice.stop()
    assert.strictEqual(ctx.sources[0]?.stops, 1)
    ctx.sources[0]?.end()
    await voice.ended
    await audio.dispose()
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
})
