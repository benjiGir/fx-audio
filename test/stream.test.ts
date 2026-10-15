import { assert, describe, it } from "@effect/vitest"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import {
  Audio,
  AudioLive,
  DecodeFailure,
  LoadError,
  NetworkFailure,
  PlaybackBlocked,
  type PlayOptions,
  StreamingUnavailable,
  UnsupportedFormat,
  Vector3,
  type Voice
} from "../src/index.ts"
import type { FakeContext, FakeMediaElement } from "../src/testing.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"
import { gainAt, pannerAt, spatialAt } from "./helpers/graph.ts"

const url = "https://x/music.mp3"

const setup = () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(
    Layer.provide(FakeAudioContextLive(ctx, { createMediaElement: ctx.createMediaElement }))
  )
  return { ctx, layer }
}

const elementAt = (ctx: FakeContext, index = 0): FakeMediaElement => {
  const element = ctx.elements[index]
  if (element === undefined) throw new Error(`no media element at ${index}`)
  return element
}

/** Start a stream, let the browser report it can play, and return the playing voice. */
const streamed = (
  ctx: FakeContext,
  start: (
    audio: Context.Service.Shape<typeof Audio>
  ) => Effect.Effect<Voice, LoadError | PlaybackBlocked, Scope.Scope>
) =>
  Effect.gen(function* () {
    const audio = yield* Audio
    const fiber = yield* Effect.forkChild(start(audio))
    yield* Effect.yieldNow
    elementAt(ctx).emit("canplay")
    return yield* Fiber.join(fiber)
  })

describe("streaming", () => {
  it.effect("waits until the browser can play, then plays", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const fiber = yield* Effect.forkChild(audio.stream(url))
      yield* Effect.yieldNow
      const element = elementAt(ctx)
      assert.strictEqual(element.src, url)
      assert.strictEqual(element.plays, 0)
      assert.isFalse(fiber.pollUnsafe() !== undefined)
      element.emit("canplay")
      yield* Fiber.join(fiber)
      assert.strictEqual(element.plays, 1)
      assert.strictEqual(element.listenerCount("canplay"), 0)
      assert.strictEqual(element.listenerCount("error"), 0)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("sets the element up for the audio graph", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      yield* streamed(ctx, (audio) => audio.stream(url, { loop: true, rate: 1.5 }))
      const element = elementAt(ctx)
      assert.strictEqual(element.crossOrigin, "anonymous")
      assert.strictEqual(element.preload, "auto")
      assert.isTrue(element.loop)
      assert.strictEqual(element.playbackRate, 1.5)
      assert.strictEqual(ctx.mediaSources.length, 1)
      assert.strictEqual(ctx.mediaSources[0]?.element, element)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("leaves loop off and the rate alone by default", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      yield* streamed(ctx, (audio) => audio.stream(url))
      const element = elementAt(ctx)
      assert.isFalse(element.loop)
      assert.strictEqual(element.playbackRate, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("routes the element through a gain into the master", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      yield* streamed(ctx, (audio) => audio.stream(url, { volume: 0.4 }))
      const voiceGain = gainAt(ctx, 1)
      assert.strictEqual(voiceGain.gain.value, 0.4)
      assert.deepStrictEqual(ctx.mediaSources[0]?.connections, [voiceGain])
      assert.deepStrictEqual(voiceGain.connections, [gainAt(ctx, 0)])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("goes through the group it is played on", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      const fiber = yield* Effect.forkChild(music.stream(url))
      yield* Effect.yieldNow
      elementAt(ctx).emit("canplay")
      yield* Fiber.join(fiber)
      // gain 0 is the master, 1 the music group, 2 the voice
      assert.deepStrictEqual(gainAt(ctx, 2).connections, [gainAt(ctx, 1)])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("takes the pan and the 3D position of a play call, at start and afterwards", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const options: PlayOptions = {
        pan: -1,
        spatial: { position: new Vector3({ x: 1, y: 0, z: 0 }) }
      }
      const voice = yield* streamed(ctx, (audio) => audio.stream(url, options))
      const stereo = pannerAt(ctx, 0)
      const spatial = spatialAt(ctx, 0)
      assert.deepStrictEqual(ctx.mediaSources[0]?.connections, [stereo])
      assert.deepStrictEqual(stereo.connections, [spatial])
      yield* voice.setPan(1)
      assert.strictEqual(stereo.pan.value, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("setPosition inserts the spatial panner after the element source", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const fiber = yield* Effect.forkChild(audio.stream(url))
      yield* Effect.yieldNow
      elementAt(ctx).emit("canplay")
      const voice = yield* Fiber.join(fiber)
      yield* voice.setPosition(new Vector3({ x: 2, y: 0, z: 0 }))
      const spatial = spatialAt(ctx, 0)
      const source = ctx.mediaSources[0]
      assert.strictEqual(source?.disconnects, 1)
      assert.deepStrictEqual(source?.connections.at(-1), spatial)
      assert.deepStrictEqual(spatial.connections, [gainAt(ctx, 1)])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("fadeTo ramps the voice gain", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const fiber = yield* Effect.forkChild(audio.stream(url))
      yield* Effect.yieldNow
      elementAt(ctx).emit("canplay")
      const voice = yield* Fiber.join(fiber)
      yield* voice.fadeTo(0, "2 seconds")
      assert.deepStrictEqual(gainAt(ctx, 1).gain.calls.at(-1), { kind: "ramp", value: 0, time: 2 })
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("stop pauses the element and ends the voice", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const fiber = yield* Effect.forkChild(audio.stream(url))
      yield* Effect.yieldNow
      elementAt(ctx).emit("canplay")
      const voice = yield* Fiber.join(fiber)
      yield* voice.stop
      assert.strictEqual(elementAt(ctx).pauses, 1)
      yield* voice.ended
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("ends the voice when the element reaches the end", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const fiber = yield* Effect.forkChild(audio.stream(url))
      yield* Effect.yieldNow
      elementAt(ctx).emit("canplay")
      const voice = yield* Fiber.join(fiber)
      const waiting = yield* Effect.forkChild(voice.ended)
      yield* Effect.yieldNow
      elementAt(ctx).emit("ended")
      yield* Fiber.join(waiting)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("releases the element and the nodes with the scope", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      yield* streamed(ctx, (audio) => audio.stream(url, { pan: 0.2 })).pipe(Effect.scoped)
      const element = elementAt(ctx)
      assert.strictEqual(element.pauses, 1)
      assert.deepStrictEqual(element.removedAttributes, ["src"])
      assert.strictEqual(element.loads, 1)
      assert.strictEqual(element.listenerCount("ended"), 0)
      assert.strictEqual(ctx.mediaSources[0]?.disconnects, 1)
      assert.strictEqual(pannerAt(ctx, 0).disconnects, 1)
      assert.strictEqual(gainAt(ctx, 1).disconnects, 1)
    }).pipe(Effect.provide(layer))
  })

  it.effect("resolves ended for a voice released by its scope", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const voice = yield* streamed(ctx, (audio) => audio.stream(url)).pipe(Effect.scoped)
      yield* voice.ended
    }).pipe(Effect.provide(layer))
  })
})

describe("streaming failures", () => {
  const failWith = (code: number | null) => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const fiber = yield* Effect.forkChild(audio.stream(url))
      yield* Effect.yieldNow
      const element = elementAt(ctx)
      element.error = code === null ? null : { code }
      element.emit("error")
      const exit = yield* Fiber.await(fiber)
      assert.isTrue(Exit.isFailure(exit))
      const error = Exit.isFailure(exit) ? exit.cause : undefined
      assert.isDefined(error)
      assert.strictEqual(element.pauses, 1)
      assert.strictEqual(element.listenerCount("error"), 0)
      return exit
    }).pipe(Effect.scoped, Effect.provide(layer))
  }

  const reasonOf = (exit: Exit.Exit<unknown, unknown>) => {
    if (!Exit.isFailure(exit)) throw new Error("expected a failure")
    const failure = exit.cause.reasons[0]
    if (failure === undefined || failure._tag !== "Fail")
      throw new Error("expected a typed failure")
    assert.instanceOf(failure.error, LoadError)
    return (failure.error as LoadError).reason
  }

  it.effect("reports a network error as NetworkFailure", () =>
    Effect.gen(function* () {
      const reason = reasonOf(yield* failWith(2))
      assert.instanceOf(reason, NetworkFailure)
      assert.deepStrictEqual((reason as NetworkFailure).cause, { code: 2 })
    })
  )

  it.effect("reports a decode error as DecodeFailure", () =>
    Effect.gen(function* () {
      assert.instanceOf(reasonOf(yield* failWith(3)), DecodeFailure)
    })
  )

  it.effect("reports an unsupported source as UnsupportedFormat", () =>
    Effect.gen(function* () {
      assert.instanceOf(reasonOf(yield* failWith(4)), UnsupportedFormat)
    })
  )

  it.effect("reports an error without a code as NetworkFailure", () =>
    Effect.gen(function* () {
      assert.instanceOf(reasonOf(yield* failWith(null)), NetworkFailure)
    })
  )

  it.effect("releases the element once, even when the scope closes after a failure", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(audio.stream(url))
        yield* Effect.yieldNow
        elementAt(ctx).emit("error")
        yield* Fiber.await(fiber)
      }).pipe(Effect.scoped)
      const element = elementAt(ctx)
      assert.strictEqual(element.pauses, 1)
      assert.strictEqual(element.loads, 1)
      assert.deepStrictEqual(element.removedAttributes, ["src"])
      assert.strictEqual(ctx.mediaSources[0]?.disconnects, 1)
    }).pipe(Effect.provide(layer))
  })

  it("names its errors", () => {
    assert.strictEqual(new StreamingUnavailable()._tag, "StreamingUnavailable")
    assert.strictEqual(new PlaybackBlocked({ source: url, cause: 1 })._tag, "PlaybackBlocked")
  })

  it.effect("releases the element when the stream is interrupted while loading", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const fiber = yield* Effect.forkChild(audio.stream(url))
      yield* Effect.yieldNow
      yield* Fiber.interrupt(fiber)
      const element = elementAt(ctx)
      assert.strictEqual(element.pauses, 1)
      assert.strictEqual(element.listenerCount("canplay"), 0)
      assert.strictEqual(element.listenerCount("error"), 0)
      assert.strictEqual(element.plays, 0)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("fails with PlaybackBlocked when the browser refuses to play, and releases", () => {
    const { ctx, layer } = setup()
    const refusal = new Error("not allowed")
    ctx.playResult = () => Promise.reject(refusal)
    return Effect.gen(function* () {
      const audio = yield* Audio
      const fiber = yield* Effect.forkChild(audio.stream(url))
      yield* Effect.yieldNow
      elementAt(ctx).emit("canplay")
      const exit = yield* Fiber.await(fiber)
      if (!Exit.isFailure(exit)) throw new Error("expected a failure")
      const failure = exit.cause.reasons[0]
      if (failure === undefined || failure._tag !== "Fail")
        throw new Error("expected a typed failure")
      assert.instanceOf(failure.error, PlaybackBlocked)
      assert.strictEqual((failure.error as PlaybackBlocked).source, url)
      assert.strictEqual((failure.error as PlaybackBlocked).cause, refusal)
      assert.strictEqual(elementAt(ctx).pauses, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("fails with StreamingUnavailable where there is no media element", () => {
    const ctx = makeFakeContext()
    const layer = AudioLive.pipe(Layer.provide(FakeAudioContextLive(ctx)))
    return Effect.gen(function* () {
      const audio = yield* Audio
      const exit = yield* Effect.exit(audio.stream(url))
      assert.strictEqual(ctx.elements.length, 0)
      assert.instanceOf(reasonOf(exit), StreamingUnavailable)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("reusing stream elements", () => {
  /** Start a stream on whichever element is loading, and return the playing voice. */
  const streamNow = (audio: Context.Service.Shape<typeof Audio>, ctx: FakeContext, options = {}) =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(audio.stream(url, options))
      yield* Effect.yieldNow
      for (const element of ctx.elements) element.emit("canplay")
      return yield* Fiber.join(fiber)
    })

  it.effect("plays the next stream on the element the last one released", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* streamNow(audio, ctx, { loop: true, rate: 1.5 }).pipe(Effect.scoped)
      yield* streamNow(audio, ctx).pipe(Effect.scoped)
      assert.strictEqual(ctx.elements.length, 1)
      // An element is routed into the graph once for good.
      assert.strictEqual(ctx.mediaSources.length, 1)
      const element = elementAt(ctx)
      assert.strictEqual(element.plays, 2)
      assert.strictEqual(element.crossOrigin, "anonymous")
      assert.isFalse(element.loop)
      assert.strictEqual(element.playbackRate, 1)
      // Each voice gets its own chain, and the source lets go of it when the voice is released.
      assert.strictEqual(ctx.mediaSources[0]?.connections.length, 2)
      assert.strictEqual(ctx.mediaSources[0]?.disconnects, 2)
    }).pipe(Effect.provide(layer))
  })

  it.effect("reuses one element at a time: two streams that overlap need two", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* streamNow(audio, ctx)
      yield* streamNow(audio, ctx)
      assert.strictEqual(ctx.elements.length, 2)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("does not reuse an element that failed", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const fiber = yield* Effect.forkChild(audio.stream(url))
      yield* Effect.yieldNow
      elementAt(ctx).error = { code: 2 }
      elementAt(ctx).emit("error")
      yield* Fiber.await(fiber)
      yield* streamNow(audio, ctx).pipe(Effect.scoped)
      assert.strictEqual(ctx.elements.length, 2)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("keeps at most four idle elements", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const round = Effect.gen(function* () {
        for (let i = 0; i < 5; i++) yield* streamNow(audio, ctx)
      }).pipe(Effect.scoped)
      yield* round
      assert.strictEqual(ctx.elements.length, 5)
      yield* round
      // Four came from the idle ones, the fifth is new.
      assert.strictEqual(ctx.elements.length, 6)
    }).pipe(Effect.provide(layer))
  })
})
