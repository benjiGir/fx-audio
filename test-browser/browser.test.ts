import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import {
  Audio,
  AudioContextService,
  AudioLive,
  BrowserAudioContextLive,
  type LoadError,
  type Sound,
  SpriteSegment,
  SpriteSheet
} from "../src/index.ts"
import { makeWav } from "../test/helpers/wav.ts"
import { makeOfflineContext, peak } from "./offline.ts"

const realAudio = AudioLive.pipe(Layer.provideMerge(BrowserAudioContextLive))

describe("the browser's native AudioContext", () => {
  it.live("decodes a WAV with the native decoder", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.25), "tone.wav")
      assert.closeTo(sound.buffer.duration, 0.25, 0.01)
    }).pipe(Effect.provide(realAudio))
  )

  it.live("reports garbage bytes as a typed load error", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.decode(new ArrayBuffer(64), "garbage.bin"))
      assert.strictEqual(error._tag, "LoadError")
      assert.include(["DecodeFailure", "UnsupportedFormat"], error.reason._tag)
    }).pipe(Effect.provide(realAudio))
  )

  it.live("closes the AudioContext with the layer scope", () =>
    Effect.gen(function* () {
      const ctx = yield* Effect.scoped(
        Effect.gen(function* () {
          return (yield* AudioContextService).ctx
        }).pipe(Effect.provide(BrowserAudioContextLive))
      )
      assert.strictEqual(ctx.state, "closed")
    })
  )
})

describe("the audio graph on a real engine (offline render)", () => {
  it.live("renders the sound at the requested volume and ends", () => {
    const { layer, render } = makeOfflineContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.1), "tone.wav")
      const voice = yield* audio.play(sound, { volume: 0.2 })
      const rendered = yield* Effect.promise(render)
      yield* voice.ended
      // The tone peaks at about 0.37 of full scale; at volume 0.2 that is about 0.07.
      assert.closeTo(peak(rendered), 0.073, 0.02)
    }).pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.provide(AudioLive.pipe(Layer.provide(layer)))
    )
  })

  it.live("a stopped voice renders silence and still ends", () => {
    const { layer, render } = makeOfflineContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.1), "tone.wav")
      const voice = yield* audio.play(sound, { loop: true, volume: 0.2 })
      yield* voice.stop
      const rendered = yield* Effect.promise(render)
      yield* voice.ended
      assert.isBelow(peak(rendered), 0.001)
    }).pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.provide(AudioLive.pipe(Layer.provide(layer)))
    )
  })

  it.live("fadeTo ramps the gain down to silence", () => {
    const { layer, render } = makeOfflineContext(1)
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.9), "tone.wav")
      const voice = yield* audio.play(sound, { volume: 0.5 })
      yield* voice.fadeTo(0, "0.5 seconds")
      const rendered = yield* Effect.promise(render)
      const data = rendered.getChannelData(0)
      const window = (from: number, to: number) => {
        let max = 0
        for (let i = Math.round(from * 44100); i < Math.round(to * 44100); i++) {
          max = Math.max(max, Math.abs(data[i] ?? 0))
        }
        return max
      }
      assert.isAbove(window(0, 0.1), window(0.4, 0.5))
      assert.isBelow(window(0.6, 0.85), 0.001)
    }).pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.provide(AudioLive.pipe(Layer.provide(layer)))
    )
  })
})

describe("sprites on a real engine (offline render)", () => {
  const sampleRate = 44100
  const windowPeak = (buffer: AudioBuffer, from: number, to: number) => {
    const data = buffer.getChannelData(0)
    let max = 0
    for (let i = Math.round(from * sampleRate); i < Math.round(to * sampleRate); i++) {
      max = Math.max(max, Math.abs(data[i] ?? 0))
    }
    return max
  }
  const sheetOf = (sound: Sound, segment: SpriteSegment) =>
    new SpriteSheet({ sound, segments: { cut: segment } })

  it.live("a one-shot segment plays for its duration and then falls silent", () => {
    const { layer, render } = makeOfflineContext(0.6)
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(1), "tone.wav")
      const voice = yield* audio.playSprite(
        sheetOf(sound, new SpriteSegment({ start: 500, duration: 200 })),
        "cut",
        { volume: 0.5 }
      )
      const rendered = yield* Effect.promise(render)
      yield* voice.ended
      assert.isAbove(windowPeak(rendered, 0.02, 0.18), 0.1)
      assert.isBelow(windowPeak(rendered, 0.25, 0.6), 0.001)
    }).pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.provide(AudioLive.pipe(Layer.provide(layer)))
    )
  })

  it.live("a looping segment keeps sounding past its own duration", () => {
    const { layer, render } = makeOfflineContext(0.6)
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(1), "tone.wav")
      yield* audio.playSprite(
        sheetOf(sound, new SpriteSegment({ start: 100, duration: 100, loop: true })),
        "cut",
        { volume: 0.5 }
      )
      const rendered = yield* Effect.promise(render)
      assert.isAbove(windowPeak(rendered, 0.02, 0.18), 0.1)
      assert.isAbove(windowPeak(rendered, 0.4, 0.58), 0.1)
    }).pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.provide(AudioLive.pipe(Layer.provide(layer)))
    )
  })
})

describe("groups on a real engine (offline render)", () => {
  const run = (
    program: (audio: Audio["Service"]) => Effect.Effect<void, LoadError, Scope.Scope>
  ) => {
    const { layer, render } = makeOfflineContext(0.3)
    return Effect.gen(function* () {
      const audio = yield* Audio
      yield* program(audio)
      return yield* Effect.promise(render)
    }).pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.provide(AudioLive.pipe(Layer.provide(layer)))
    )
  }

  it.live("scales its voices by the group volume on top of their own", () =>
    Effect.gen(function* () {
      const rendered = yield* run((audio) =>
        Effect.gen(function* () {
          const sound = yield* audio.decode(makeWav(0.2), "tone.wav")
          const group = yield* audio.makeGroup()
          yield* group.setVolume(0.5)
          yield* group.play(sound, { volume: 0.5 })
        })
      )
      // The tone peaks at about 0.37; times 0.5 times 0.5 that is about 0.09.
      assert.closeTo(peak(rendered), 0.092, 0.02)
    })
  )

  it.live("a muted group is silent", () =>
    Effect.gen(function* () {
      const rendered = yield* run((audio) =>
        Effect.gen(function* () {
          const sound = yield* audio.decode(makeWav(0.2), "tone.wav")
          const group = yield* audio.makeGroup()
          yield* group.mute
          yield* group.play(sound)
        })
      )
      assert.isBelow(peak(rendered), 0.001)
    })
  )

  it.live("the master scales every group", () =>
    Effect.gen(function* () {
      const rendered = yield* run((audio) =>
        Effect.gen(function* () {
          const sound = yield* audio.decode(makeWav(0.2), "tone.wav")
          const group = yield* audio.makeGroup()
          yield* audio.master.setVolume(0.5)
          yield* group.setVolume(0.5)
          yield* group.play(sound)
        })
      )
      assert.closeTo(peak(rendered), 0.092, 0.02)
    })
  )
})

describe("play() cost on the calling thread", () => {
  it.live("is far below one audio render quantum", () => {
    const { layer } = makeOfflineContext()
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.05), "tone.wav")
      const runs = 1000
      // Timed as one batch: Firefox and WebKit coarsen performance.now(), which hides a single call.
      const start = performance.now()
      for (let i = 0; i < runs; i++) {
        yield* audio.play(sound, { volume: 0.01 }).pipe(Effect.scoped)
      }
      const mean = (performance.now() - start) / runs
      console.log(`play() mean cost over ${runs} runs: ${mean.toFixed(4)} ms`)
      // Generous bound: it only has to catch an order-of-magnitude regression.
      assert.isBelow(mean, 1)
    }).pipe(Effect.provide(AudioLive.pipe(Layer.provide(layer))))
  })
})
