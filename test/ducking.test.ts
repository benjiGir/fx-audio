import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import { Audio, AudioLive, DuckOptions, Sound } from "../src/index.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"
import { gainAt } from "./helpers/graph.ts"

const sound = new Sound({ buffer: { duration: 4 } as AudioBuffer, source: "test.wav" })

const setup = () => {
  const ctx = makeFakeContext()
  const layer = AudioLive.pipe(Layer.provide(FakeAudioContextLive(ctx)))
  return { ctx, layer }
}

/** What the music group's gain was told to do: gain 0 is the master, gain 1 the first group made. */
const callsOf = (ctx: ReturnType<typeof setup>["ctx"], index = 1) => gainAt(ctx, index).gain.calls

describe("duck", () => {
  it.effect("lowers a group while the trigger plays and brings it back when it ends", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      const speech = yield* audio.group("speech")
      yield* music.duck(speech, { volume: 0.2, attack: 100, release: 400 })
      assert.deepStrictEqual(callsOf(ctx), [])
      yield* speech.play(sound)
      assert.deepStrictEqual(callsOf(ctx), [
        { kind: "cancel", value: Number.NaN, time: 0 },
        { kind: "set", value: 1, time: 0 },
        { kind: "ramp", value: 0.2, time: 0.1 }
      ])
      ctx.currentTime = 2
      // Gains: 0 master, 1 music, 2 speech, 3 the speech voice.
      ctx.sources[0]?.end()
      assert.deepStrictEqual(callsOf(ctx).slice(3), [
        { kind: "cancel", value: Number.NaN, time: 2 },
        { kind: "set", value: 1, time: 2 },
        { kind: "ramp", value: 1, time: 2.4 }
      ])
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("goes to 0.3 in 100 ms and comes back in 500 ms by default", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      const speech = yield* audio.group("speech")
      yield* music.duck(speech)
      const voice = yield* speech.play(sound)
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 0.3, time: 0.1 })
      yield* voice.stop
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 1, time: 0.5 })
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect(
    "ducks at once for a trigger that is already playing, and for several voices only once",
    () => {
      const { ctx, layer } = setup()
      return Effect.gen(function* () {
        const audio = yield* Audio
        const music = yield* audio.group("music")
        const speech = yield* audio.group("speech")
        const first = yield* speech.play(sound)
        yield* music.duck(speech, { volume: 0.5 })
        assert.strictEqual(callsOf(ctx).length, 3)
        const second = yield* speech.play(sound)
        assert.strictEqual(callsOf(ctx).length, 3)
        yield* first.stop
        assert.strictEqual(callsOf(ctx).length, 3)
        yield* second.stop
        assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 1, time: 0.5 })
      }).pipe(Effect.scoped, Effect.provide(layer))
    }
  )

  it.effect("keeps the group's own volume: setVolume and fadeTo work on top of the ducking", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      const speech = yield* audio.group("speech")
      yield* music.setVolume(0.5)
      yield* music.duck(speech, { volume: 0.2 })
      const voice = yield* speech.play(sound)
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 0.1, time: 0.1 })
      yield* music.setVolume(0.8)
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "set", value: 0.8 * 0.2, time: 0 })
      yield* music.fadeTo(1, 2000)
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 0.2, time: 2 })
      yield* voice.stop
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 1, time: 0.5 })
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("leaves a muted group silent and gives it the ducked volume on unmute", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      const speech = yield* audio.group("speech")
      yield* music.duck(speech, { volume: 0.4 })
      yield* music.mute
      const before = callsOf(ctx).length
      const voice = yield* speech.play(sound)
      // Nothing is scheduled while it is muted.
      assert.strictEqual(callsOf(ctx).length, before)
      yield* music.unmute
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "set", value: 0.4, time: 0 })
      yield* voice.stop
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 1, time: 0.5 })
      yield* music.mute
      yield* speech.play(sound)
      yield* music.unmute
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "set", value: 0.4, time: 0 })
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("goes down to the lowest level when several groups duck it", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      const speech = yield* audio.group("speech")
      const alarm = yield* audio.group("alarm")
      yield* music.duck(speech, { volume: 0.5 })
      yield* music.duck(alarm, { volume: 0.1 })
      const talk = yield* speech.play(sound)
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 0.5, time: 0.1 })
      const ring = yield* alarm.play(sound)
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 0.1, time: 0.1 })
      yield* ring.stop
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 0.5, time: 0.5 })
      yield* talk.stop
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 1, time: 0.5 })
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("stops when the scope closes, bringing the group back", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      const speech = yield* audio.group("speech")
      const scope = yield* Scope.make()
      yield* music.duck(speech, { release: 200 }).pipe(Effect.provideService(Scope.Scope, scope))
      yield* speech.play(sound)
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 0.3, time: 0.1 })
      yield* Scope.close(scope, Exit.void)
      assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "ramp", value: 1, time: 0.2 })
      const calls = callsOf(ctx).length
      // No longer following the trigger.
      yield* speech.play(sound)
      assert.strictEqual(callsOf(ctx).length, calls)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("can duck the master, or be triggered by the master", () => {
    const { ctx, layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const alarm = yield* audio.group("alarm")
      yield* audio.master.duck(alarm, { volume: 0.5 })
      yield* alarm.play(sound)
      assert.deepStrictEqual(callsOf(ctx, 0).at(-1), { kind: "ramp", value: 0.5, time: 0.1 })
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("dies when the trigger is not a group of this audio", () => {
    const { layer } = setup()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const music = yield* audio.group("music")
      // A copy was not made by this audio.
      const stranger = { ...music }
      const exit = yield* Effect.exit(music.duck(stranger))
      assert.isTrue(Exit.isFailure(exit))
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})

describe("a fade of no length", () => {
  it.effect(
    "sets the value instead of ramping to the time it starts, which some engines ignore",
    () => {
      const { ctx, layer } = setup()
      return Effect.gen(function* () {
        const audio = yield* Audio
        const music = yield* audio.group("music")
        yield* music.fadeTo(0.5, 0)
        assert.deepStrictEqual(callsOf(ctx).at(-1), { kind: "set", value: 0.5, time: 0 })
        assert.isFalse(callsOf(ctx).some((call) => call.kind === "ramp"))
        const voice = yield* music.play(sound)
        yield* voice.fadeTo(0.25, 0)
        // Gains: 0 master, 1 music, 2 the voice.
        assert.deepStrictEqual(gainAt(ctx, 2).gain.calls, [
          { kind: "set", value: 1, time: 0 },
          { kind: "set", value: 0.25, time: 0 }
        ])
      }).pipe(Effect.scoped, Effect.provide(layer))
    }
  )
})

describe("DuckOptions", () => {
  const decode = Schema.decodeUnknownSync(DuckOptions)

  it("takes a volume from 0 to 1 and times of zero or more", () => {
    assert.strictEqual(decode({ volume: 0 }).volume, 0)
    assert.strictEqual(decode({ volume: 1, attack: 0, release: 0 }).release, 0)
    assert.throws(() => decode({ volume: 1.1 }))
    assert.throws(() => decode({ volume: -0.1 }))
    assert.throws(() => decode({ attack: -1 }))
    assert.throws(() => decode({ release: Number.NaN }))
  })
})
