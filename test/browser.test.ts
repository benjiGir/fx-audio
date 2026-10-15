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
  const close = vi.fn<() => Promise<void>>(() => Promise.resolve())
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

describe("the media element of BrowserAudioContextLive", () => {
  it.effect("is a new Audio element for every stream", () => {
    stubAudioContext()
    const made: Array<unknown> = []
    vi.stubGlobal(
      "Audio",
      class {
        constructor() {
          made.push(this)
        }
      }
    )
    return Effect.gen(function* () {
      const { createMediaElement } = yield* AudioContextService
      assert.isDefined(createMediaElement)
      const first = createMediaElement?.()
      const second = createMediaElement?.()
      assert.deepStrictEqual(made, [first, second])
      assert.notStrictEqual(first, second)
    }).pipe(Effect.provide(BrowserAudioContextLive), Effect.scoped)
  })
})

describe("resuming on a user gesture", () => {
  /** A context that starts suspended, and a document that is a bare event target. */
  const setup = (resume: () => Promise<void>, events = true) => {
    const document = Object.assign(new EventTarget(), { visibilityState: "visible" })
    const added = vi.spyOn(document, "addEventListener")
    const removed = vi.spyOn(document, "removeEventListener")
    vi.stubGlobal("document", document)
    // A real `AudioContext` is an event target too: it fires `statechange`.
    const target = events ? new EventTarget() : undefined
    const ctx = Object.assign(target ?? {}, {
      state: "suspended",
      resume: vi.fn<() => Promise<void>>(resume),
      close: () => Promise.resolve()
    })
    // `new` on a plain function that returns an object gives that object.
    vi.stubGlobal("AudioContext", function AudioContext() {
      return ctx
    })
    const gesture = async (type = "pointerdown") => {
      document.dispatchEvent(new Event(type))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const changeState = (state: string) => {
      ctx.state = state
      target?.dispatchEvent(new Event("statechange"))
    }
    const showTab = async (visibilityState: string) => {
      document.visibilityState = visibilityState
      document.dispatchEvent(new Event("visibilitychange"))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const types = (calls: ReadonlyArray<ReadonlyArray<unknown>>) => calls.map(([type]) => type)
    return { ctx, added, removed, gesture, changeState, showTab, types }
  }
  const build = BrowserAudioContextLive.pipe(Layer.build)

  it.effect("resumes on the first gesture, then stops listening", () =>
    Effect.gen(function* () {
      const { ctx, added, gesture, types } = setup(() => {
        ctx.state = "running"
        return Promise.resolve()
      })
      yield* build
      assert.deepStrictEqual(types(added.mock.calls), [
        "pointerdown",
        "keydown",
        "touchend",
        "visibilitychange"
      ])
      // Capturing, so a page that stops propagation of its own events cannot hide the gesture.
      for (const call of added.mock.calls.slice(0, 3)) {
        assert.deepStrictEqual(call[2], { capture: true })
      }
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
      const { ctx, removed, gesture, showTab, changeState, types } = setup(() => Promise.resolve())
      yield* build.pipe(Effect.scoped)
      assert.deepStrictEqual(types(removed.mock.calls), [
        "pointerdown",
        "keydown",
        "touchend",
        "visibilitychange"
      ])
      for (const call of removed.mock.calls.slice(0, 3)) {
        assert.deepStrictEqual(call[2], { capture: true })
      }
      yield* Effect.promise(() => gesture())
      yield* Effect.promise(() => showTab("visible"))
      changeState("interrupted")
      yield* Effect.promise(() => gesture())
      assert.strictEqual(ctx.resume.mock.calls.length, 0)
    })
  )

  it.effect("does not listen when the context is already running", () =>
    Effect.gen(function* () {
      const { ctx, added, types } = setup(() => Promise.resolve())
      ctx.state = "running"
      yield* build
      assert.deepStrictEqual(types(added.mock.calls), ["visibilitychange"])
    }).pipe(Effect.scoped)
  )

  it.effect("listens again when the phone interrupts a running context", () =>
    Effect.gen(function* () {
      const { ctx, added, gesture, changeState } = setup(() => {
        ctx.state = "running"
        return Promise.resolve()
      })
      ctx.state = "running"
      yield* build
      assert.strictEqual(added.mock.calls.length, 1)
      changeState("interrupted")
      assert.strictEqual(added.mock.calls.length, 4)
      // Another change while it is already listening adds nothing.
      changeState("suspended")
      assert.strictEqual(added.mock.calls.length, 4)
      yield* Effect.promise(() => gesture())
      assert.strictEqual(ctx.resume.mock.calls.length, 1)
      assert.strictEqual(ctx.state, "running")
      // Back to running: the gesture listeners are gone, a gesture does not resume again.
      yield* Effect.promise(() => gesture())
      assert.strictEqual(ctx.resume.mock.calls.length, 1)
    }).pipe(Effect.scoped)
  )

  it.effect("stops listening for gestures when the context runs again by itself", () =>
    Effect.gen(function* () {
      const { ctx, gesture, changeState } = setup(() => Promise.resolve())
      yield* build
      changeState("running")
      yield* Effect.promise(() => gesture())
      assert.strictEqual(ctx.resume.mock.calls.length, 0)
    }).pipe(Effect.scoped)
  )

  it.effect("resumes at once when the tab becomes visible again", () =>
    Effect.gen(function* () {
      const { ctx, showTab, gesture } = setup(() => {
        ctx.state = "running"
        return Promise.resolve()
      })
      yield* build
      yield* Effect.promise(() => showTab("hidden"))
      assert.strictEqual(ctx.resume.mock.calls.length, 0)
      yield* Effect.promise(() => showTab("visible"))
      assert.strictEqual(ctx.resume.mock.calls.length, 1)
      // It ran, so the gesture listeners are gone and a running context is left alone.
      yield* Effect.promise(() => gesture())
      yield* Effect.promise(() => showTab("visible"))
      assert.strictEqual(ctx.resume.mock.calls.length, 1)
    }).pipe(Effect.scoped)
  )

  it.effect("keeps waiting for a gesture when the browser refuses to resume a visible tab", () =>
    Effect.gen(function* () {
      const { ctx, showTab, gesture } = setup(() => Promise.reject(new Error("not allowed")))
      yield* build
      yield* Effect.promise(() => showTab("visible"))
      yield* Effect.promise(() => gesture())
      assert.strictEqual(ctx.resume.mock.calls.length, 2)
    }).pipe(Effect.scoped)
  )

  it.effect("works on a context that cannot report its state changes", () =>
    Effect.gen(function* () {
      const { ctx, gesture } = setup(() => Promise.resolve(), false)
      yield* build.pipe(Effect.scoped)
      yield* build
      yield* Effect.promise(() => gesture())
      assert.strictEqual(ctx.resume.mock.calls.length, 1)
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
