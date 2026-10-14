import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { afterEach, vi } from "vitest"
import {
  Audio,
  AudioBrowserLive,
  AudioContextService,
  BrowserAudioContextLive
} from "../src/index.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

const stubAudioContext = () => {
  const close = vi.fn(() => Promise.resolve())
  const instances: Array<unknown> = []
  vi.stubGlobal(
    "AudioContext",
    class {
      close = close
      destination = {}
      // Building the service creates the master group's gain node.
      createGain = () => ({ connect: () => undefined, disconnect: () => undefined, gain: {} })
      constructor() {
        instances.push(this)
      }
    }
  )
  return { close, instances }
}

describe("BrowserAudioContextLive", () => {
  it.effect("builds one AudioContext and closes it with the scope", () =>
    Effect.gen(function* () {
      const { close, instances } = stubAudioContext()
      const ctx = yield* Effect.gen(function* () {
        return (yield* AudioContextService).ctx
      }).pipe(Effect.provide(BrowserAudioContextLive))
      assert.strictEqual(instances.length, 1)
      assert.strictEqual(ctx, instances[0])
      assert.strictEqual(close.mock.calls.length, 1)
    })
  )
})

describe("resuming on a user gesture", () => {
  /** A context that starts suspended, and a document that is a bare event target. */
  const setup = (resume: () => Promise<void>) => {
    const document = new EventTarget()
    const added = vi.spyOn(document, "addEventListener")
    const removed = vi.spyOn(document, "removeEventListener")
    vi.stubGlobal("document", document)
    const ctx = { state: "suspended", resume: vi.fn(resume), close: () => Promise.resolve() }
    // `new` on a plain function that returns an object gives that object.
    vi.stubGlobal("AudioContext", function AudioContext() {
      return ctx
    })
    const gesture = async (type = "pointerdown") => {
      document.dispatchEvent(new Event(type))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { ctx, added, removed, gesture }
  }
  const build = BrowserAudioContextLive.pipe(Layer.build)

  it.effect("resumes on the first gesture, then stops listening", () =>
    Effect.gen(function* () {
      const { ctx, added, gesture } = setup(() => {
        ctx.state = "running"
        return Promise.resolve()
      })
      yield* build
      assert.deepStrictEqual(
        added.mock.calls.map(([type]) => type),
        ["pointerdown", "keydown", "touchend"]
      )
      yield* Effect.promise(() => gesture("keydown"))
      assert.strictEqual(ctx.resume.mock.calls.length, 1)
      yield* Effect.promise(() => gesture())
      yield* Effect.promise(() => gesture("touchend"))
      assert.strictEqual(ctx.resume.mock.calls.length, 1)
    }).pipe(Effect.scoped)
  )

  it.effect("keeps listening while the browser leaves the context suspended", () =>
    Effect.gen(function* () {
      const { ctx, gesture } = setup(() => Promise.resolve())
      yield* build
      yield* Effect.promise(() => gesture())
      yield* Effect.promise(() => gesture())
      assert.strictEqual(ctx.resume.mock.calls.length, 2)
    }).pipe(Effect.scoped)
  )

  it.effect("keeps listening when resume is rejected", () =>
    Effect.gen(function* () {
      const { ctx, gesture } = setup(() => Promise.reject(new Error("not allowed")))
      yield* build
      yield* Effect.promise(() => gesture())
      yield* Effect.promise(() => gesture())
      assert.strictEqual(ctx.resume.mock.calls.length, 2)
    }).pipe(Effect.scoped)
  )

  it.effect("stops listening when the scope closes", () =>
    Effect.gen(function* () {
      const { ctx, removed, gesture } = setup(() => Promise.resolve())
      yield* build.pipe(Effect.scoped)
      assert.deepStrictEqual(
        removed.mock.calls.map(([type]) => type),
        ["pointerdown", "keydown", "touchend"]
      )
      yield* Effect.promise(() => gesture())
      assert.strictEqual(ctx.resume.mock.calls.length, 0)
    })
  )

  it.effect("does not listen when the context is already running", () =>
    Effect.gen(function* () {
      const { ctx, added } = setup(() => Promise.resolve())
      ctx.state = "running"
      yield* build
      assert.strictEqual(added.mock.calls.length, 0)
    }).pipe(Effect.scoped)
  )

  it.effect("does nothing without a document, as under Node", () =>
    Effect.gen(function* () {
      const { ctx } = setup(() => Promise.resolve())
      vi.stubGlobal("document", undefined)
      yield* build
      assert.strictEqual(ctx.resume.mock.calls.length, 0)
    }).pipe(Effect.scoped)
  )
})

describe("AudioBrowserLive", () => {
  it.effect("provides the service on the browser context", () =>
    Effect.gen(function* () {
      const { instances } = stubAudioContext()
      yield* Audio.use(() => Effect.void).pipe(Effect.provide(AudioBrowserLive))
      assert.strictEqual(instances.length, 1)
    })
  )
})
