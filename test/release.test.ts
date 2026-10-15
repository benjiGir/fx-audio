import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import { Audio, AudioLive, Sound } from "../src/index.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"
import { gainAt } from "./helpers/graph.ts"

const sound = new Sound({ buffer: { duration: 4 } as AudioBuffer, source: "test.wav" })
const url = "https://x/music.mp3"

const setup = () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(
    Layer.provide(FakeAudioContextLive(ctx, { createMediaElement: ctx.createMediaElement }))
  )
  return { ctx, layer }
}

/** True while the scope still holds something to run when it closes. */
const holdsFinalizers = (scope: Scope.Scope) => scope.state._tag !== "Empty"

describe("a voice that has ended", () => {
  it.effect("lets go of its nodes and of the scope, without waiting for the scope to close", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const scope = yield* Scope.make()
      const audio = yield* Audio
      const [finished, stopped, playing] = yield* Effect.all([
        audio.play(sound),
        audio.play(sound, { loop: true }),
        audio.play(sound)
      ]).pipe(Effect.provideService(Scope.Scope, scope))
      assert.isTrue(holdsFinalizers(scope))
      ctx.sources[0]?.end()
      yield* finished.ended
      yield* stopped.stop
      // The gain at 0 is the master's; each voice has its own after it.
      assert.strictEqual(gainAt(ctx, 1).disconnects, 1)
      assert.strictEqual(gainAt(ctx, 2).disconnects, 1)
      assert.strictEqual(gainAt(ctx, 3).disconnects, 0)
      yield* playing.stop
      assert.isFalse(holdsFinalizers(scope))
      // Closing the scope later does not release a second time.
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(gainAt(ctx, 1).disconnects, 1)
      assert.strictEqual(gainAt(ctx, 3).disconnects, 1)
    }).pipe(Effect.provide(layer))
  })

  it.effect("does not call stop on a source that has run out", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const voice = yield* audio.play(sound)
      ctx.sources[0]?.end()
      yield* voice.ended
      assert.strictEqual(ctx.sources[0]?.stops, 0)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect(
    "releases a stream's element when the voice stops, and the next stream reuses it",
    () => {
      const { ctx, layer } = setup()
      return Effect.gen(function* () {
        const scope = yield* Scope.Scope
        const audio = yield* Audio
        const start = Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(audio.stream(url))
          yield* Effect.yieldNow
          for (const element of ctx.elements) element.emit("canplay")
          return yield* Fiber.join(fiber)
        })
        const first = yield* start
        yield* first.stop
        const element = ctx.elements[0]
        assert.strictEqual(element?.pauses, 1)
        assert.deepStrictEqual(element?.removedAttributes, ["src"])
        assert.strictEqual(element?.loads, 1)
        assert.strictEqual(element?.listenerCount("ended"), 0)
        assert.isFalse(holdsFinalizers(scope))
        const second = yield* start
        assert.strictEqual(ctx.elements.length, 1)
        assert.strictEqual(element?.plays, 2)
        // It ends by itself too.
        ctx.elements[0]?.emit("ended")
        yield* second.ended
        assert.strictEqual(element?.pauses, 2)
        assert.isFalse(holdsFinalizers(scope))
      }).pipe(Effect.scoped, Effect.provide(layer))
    }
  )
})
