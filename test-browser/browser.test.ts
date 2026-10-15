import { assert, describe, it } from "@effect/vitest"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { server, userEvent } from "vitest/browser"
import {
  Audio,
  type AudioEffect,
  AudioContextService,
  AudioLive,
  BrowserAudioContextLive,
  Compressor,
  Echo,
  Filter,
  LoadError,
  Reverb,
  type Sound,
  SpriteSegment,
  SpriteSheet,
  Vector3
} from "../src/index.ts"
import { makeWav } from "../test/helpers/wav.ts"
import { makeOfflineContext, peak } from "./offline.ts"

const realAudio = AudioLive.pipe(Layer.provideMerge(BrowserAudioContextLive))

describe("resuming on a real user gesture", () => {
  // Firefox on a CI machine has no sound card and never lets a real-time context run,
  // so the state is only checked strictly on Chromium, while the resume call is checked everywhere.
  it.live("the first real click resumes the context and the browser may then run it", () =>
    Effect.gen(function* () {
      const { ctx } = yield* AudioContextService
      const resume = ctx.resume.bind(ctx)
      let resumes = 0
      ctx.resume = () => {
        resumes++
        return resume()
      }
      assert.strictEqual(ctx.state, "suspended")
      yield* Effect.promise(() => userEvent.click(document.body))
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 300)))
      assert.isAtLeast(resumes, 1)
      // Chromium CI machines run a real-time context without a device, so it is checked strictly there.
      if (server.browser === "chromium" || ctx.state !== "suspended") {
        assert.strictEqual(ctx.state, "running")
      }
    }).pipe(Effect.provide(BrowserAudioContextLive), Effect.scoped)
  )
})

describe("streaming through a real media element", () => {
  const wavUrl = () => URL.createObjectURL(new Blob([makeWav(0.5)], { type: "audio/wav" }))

  it.live("a missing file fails with a typed LoadError", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const error = yield* audio.stream("/no-such-file.wav").pipe(Effect.flip, Effect.scoped)
      assert.instanceOf(error, LoadError)
    }).pipe(Effect.provide(realAudio))
  )

  it.live("plays a file, then stops and releases it", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => userEvent.click(document.body))
      const audio = yield* Audio
      const url = wavUrl()
      const voice = yield* audio.stream(url)
      yield* voice.stop
      yield* voice.ended
      URL.revokeObjectURL(url)
    }).pipe(Effect.scoped, Effect.provide(realAudio))
  )

  it.live("plays a second stream on the element of the first, routed into the graph once", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => userEvent.click(document.body))
      const audio = yield* Audio
      const { ctx } = yield* AudioContextService
      const made: Array<unknown> = []
      let routed = 0
      const createSource = ctx.createMediaElementSource.bind(ctx)
      ctx.createMediaElementSource = (element) => {
        routed++
        return createSource(element)
      }
      const url = wavUrl()
      // The layer builds its elements with `new Audio()`, so count them through the class.
      const NativeAudio = globalThis.Audio
      globalThis.Audio = class extends NativeAudio {
        constructor() {
          super()
          made.push(this)
        }
      }
      try {
        const first = yield* audio.stream(url)
        yield* first.stop
        const second = yield* audio.stream(url)
        yield* second.stop
      } finally {
        globalThis.Audio = NativeAudio
        URL.revokeObjectURL(url)
      }
      assert.strictEqual(made.length, 1)
      assert.strictEqual(routed, 1)
    }).pipe(Effect.scoped, Effect.provide(realAudio))
  )
})

describe("an analyser on a real-time context", () => {
  // A real-time context only runs on Chromium CI machines (no sound card elsewhere).
  it.live("reads the level of a tone that plays", () =>
    Effect.gen(function* () {
      if (server.browser !== "chromium") return
      yield* Effect.promise(() => userEvent.click(document.body))
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(1), "tone.wav")
      const voice = yield* audio.play(sound, { loop: true, volume: 0.5 })
      const analyser = yield* voice.analyser
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 400)))
      const level = yield* analyser.level
      assert.isAbove(level, 0.05)
      assert.isAtMost(level, 0.5)
      assert.isAbove(yield* analyser.peak, level)
      const spectrum = yield* analyser.spectrum
      assert.isAbove(Math.max(...spectrum), 50)
    }).pipe(Effect.scoped, Effect.timeout("10 seconds"), Effect.provide(realAudio))
  )
})

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

  it.live("seek renders only what is left of the sound", () => {
    const { layer, render } = makeOfflineContext(0.5)
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.5), "tone.wav")
      const voice = yield* audio.play(sound, { volume: 0.5 })
      yield* voice.seek(400)
      const rendered = yield* Effect.promise(render)
      yield* voice.ended
      const data = rendered.getChannelData(0)
      const window = (from: number, to: number) => {
        let max = 0
        for (let i = Math.round(from * 44100); i < Math.round(to * 44100); i++) {
          max = Math.max(max, Math.abs(data[i] ?? 0))
        }
        return max
      }
      assert.isAbove(window(0, 0.08), 0.05)
      assert.isBelow(window(0.15, 0.5), 0.001)
    }).pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.provide(AudioLive.pipe(Layer.provide(layer)))
    )
  })

  it.live("a delayed voice renders silence until its time, then the sound", () => {
    const { layer, render } = makeOfflineContext(0.5)
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.2), "tone.wav")
      yield* audio.play(sound, { volume: 0.5, delay: 250 })
      const rendered = yield* Effect.promise(render)
      const data = rendered.getChannelData(0)
      const window = (from: number, to: number) => {
        let max = 0
        for (let i = Math.round(from * 44100); i < Math.round(to * 44100); i++) {
          max = Math.max(max, Math.abs(data[i] ?? 0))
        }
        return max
      }
      assert.isBelow(window(0, 0.24), 0.001)
      assert.isAbove(window(0.26, 0.45), 0.05)
    }).pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.provide(AudioLive.pipe(Layer.provide(layer)))
    )
  })

  it.live(
    "an analyser on a real engine has the sizes it promises, and reads a playing voice",
    () => {
      const { layer } = makeOfflineContext(0.5)
      return Effect.gen(function* () {
        const audio = yield* Audio
        const sound = yield* audio.decode(makeWav(0.5), "tone.wav")
        const voice = yield* audio.play(sound, { loop: true })
        const analyser = yield* voice.analyser
        assert.strictEqual((yield* analyser.spectrum).length, 1024)
        assert.strictEqual((yield* analyser.waveform).length, 2048)
        assert.strictEqual(yield* analyser.level, 0)
        assert.strictEqual(yield* (yield* audio.analyser).peak, 0)
      }).pipe(
        Effect.scoped,
        Effect.timeout("10 seconds"),
        Effect.provide(AudioLive.pipe(Layer.provide(layer)))
      )
    }
  )

  /** The highest absolute sample of `data` between two times, in seconds. */
  const loudest = (data: Float32Array, from: number, to: number) => {
    let max = 0
    for (let i = Math.round(from * 44100); i < Math.round(to * 44100); i++) {
      max = Math.max(max, Math.abs(data[i] ?? 0))
    }
    return max
  }

  const renderWith = (effects: ReadonlyArray<AudioEffect>, seconds = 0.6) => {
    const { layer, render } = makeOfflineContext(seconds)
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.1), "tone.wav")
      yield* audio.master.setEffects(effects)
      yield* audio.play(sound)
      return (yield* Effect.promise(render)).getChannelData(0)
    }).pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.provide(AudioLive.pipe(Layer.provide(layer)))
    )
  }

  it.live("a lowpass filter removes a tone above its cutoff, a highpass one below", () =>
    Effect.gen(function* () {
      const plain = loudest(yield* renderWith([]), 0.02, 0.09)
      const lowpassed = loudest(
        yield* renderWith([new Filter({ type: "lowpass", frequency: 60 })]),
        0.02,
        0.09
      )
      const highpassed = loudest(
        yield* renderWith([new Filter({ type: "highpass", frequency: 8000 })]),
        0.02,
        0.09
      )
      assert.isAbove(plain, 0.2)
      assert.isBelow(lowpassed, plain / 10)
      assert.isBelow(highpassed, plain / 10)
    })
  )

  it.live("an echo repeats the sound after its time, and nothing is heard in between", () =>
    Effect.gen(function* () {
      const data = yield* renderWith([new Echo({ time: 300, feedback: 0, mix: 0.5 })])
      assert.isAbove(loudest(data, 0.02, 0.09), 0.1)
      assert.isBelow(loudest(data, 0.15, 0.28), 0.001)
      assert.isAbove(loudest(data, 0.32, 0.39), 0.05)
    })
  )

  it.live("a reverb leaves a tail after the sound has stopped", () =>
    Effect.gen(function* () {
      const dry = yield* renderWith([])
      const wet = yield* renderWith([new Reverb({ seconds: 0.4, mix: 0.5 })])
      assert.isBelow(loudest(dry, 0.2, 0.5), 0.001)
      assert.isAbove(loudest(wet, 0.15, 0.3), 0.005)
    })
  )

  it.live("a compressor brings a loud tone down", () =>
    Effect.gen(function* () {
      const plain = loudest(yield* renderWith([]), 0.03, 0.09)
      const squeezed = loudest(
        yield* renderWith([new Compressor({ threshold: -40, ratio: 20, attack: 0 })]),
        0.05,
        0.09
      )
      assert.isBelow(squeezed, plain * 0.8)
    })
  )

  it.live("a paused voice renders silence and does not end, a resumed one plays", () => {
    const { layer, render } = makeOfflineContext(0.3)
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.2), "tone.wav")
      const paused = yield* audio.play(sound, { volume: 0.5 })
      yield* paused.pause
      const resumed = yield* audio.play(sound, { volume: 0.5 })
      yield* resumed.pause
      yield* resumed.resume
      const rendered = yield* Effect.promise(render)
      yield* resumed.ended
      assert.isTrue(yield* paused.paused)
      assert.strictEqual(yield* paused.position, 0)
      const data = rendered.getChannelData(0)
      let max = 0
      for (let i = 0; i < Math.round(0.15 * 44100); i++) max = Math.max(max, Math.abs(data[i] ?? 0))
      // Only the resumed voice is heard: one tone at half volume, not two.
      assert.closeTo(max, 0.18, 0.03)
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
    program: (
      audio: Context.Service.Shape<typeof Audio>
    ) => Effect.Effect<void, LoadError, Scope.Scope>
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
          const group = yield* audio.group("music")
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
          const group = yield* audio.group("music")
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
          const group = yield* audio.group("music")
          yield* audio.master.setVolume(0.5)
          yield* group.setVolume(0.5)
          yield* group.play(sound)
        })
      )
      assert.closeTo(peak(rendered), 0.092, 0.02)
    })
  )
})

describe("stereo pan on a real engine (offline render)", () => {
  const render = (pan: number, later?: number) => {
    const { layer, render } = makeOfflineContext(0.3, 44100, 2)
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.2), "tone.wav")
      const voice = yield* audio.play(sound, { pan, volume: 0.5 })
      if (later !== undefined) yield* voice.setPan(later)
      return yield* Effect.promise(render)
    }).pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.provide(AudioLive.pipe(Layer.provide(layer)))
    )
  }

  it.live("a hard-left voice is silent on the right channel", () =>
    Effect.gen(function* () {
      const rendered = yield* render(-1)
      assert.isAbove(peak(rendered, 0), 0.1)
      assert.isBelow(peak(rendered, 1), 0.001)
    })
  )

  it.live("setPan moves the voice to the other side", () =>
    Effect.gen(function* () {
      const rendered = yield* render(-1, 1)
      assert.isAbove(peak(rendered, 1), 0.1)
      assert.isBelow(peak(rendered, 0), 0.001)
    })
  )
})

describe("3D position on a real engine (offline render)", () => {
  const at = (x: number, y: number, z: number) => new Vector3({ x, y, z })

  /** Plays a 0.2 s tone, lets `arrange` move things around, and returns the stereo render. */
  const render = (
    spatial: { position: Vector3 },
    arrange: (
      audio: Context.Service.Shape<typeof Audio>,
      voice: { setPosition: (p: Vector3) => Effect.Effect<void> }
    ) => Effect.Effect<void> = () => Effect.void
  ) => {
    const { layer, render } = makeOfflineContext(0.3, 44100, 2)
    return Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.2), "tone.wav")
      const voice = yield* audio.play(sound, { spatial })
      yield* arrange(audio, voice)
      return yield* Effect.promise(render)
    }).pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.provide(AudioLive.pipe(Layer.provide(layer)))
    )
  }

  it.live("a voice on the right is heard on the right only", () =>
    Effect.gen(function* () {
      const rendered = yield* render({ position: at(2, 0, 0) })
      assert.isAbove(peak(rendered, 1), 0.01)
      assert.isBelow(peak(rendered, 0), 0.001)
    })
  )

  it.live("setPosition moves the voice to the other side", () =>
    Effect.gen(function* () {
      const rendered = yield* render({ position: at(2, 0, 0) }, (_audio, voice) =>
        voice.setPosition(at(-2, 0, 0))
      )
      assert.isAbove(peak(rendered, 0), 0.01)
      assert.isBelow(peak(rendered, 1), 0.001)
    })
  )

  it.live("moving the listener past the voice swaps the sides", () =>
    Effect.gen(function* () {
      const rendered = yield* render({ position: at(2, 0, 0) }, (audio) =>
        audio.listener.setPosition(at(10, 0, 0))
      )
      assert.isAbove(peak(rendered, 0), 0.01)
      assert.isBelow(peak(rendered, 1), 0.001)
    })
  )

  it.live("turning the listener around swaps the sides", () =>
    Effect.gen(function* () {
      const rendered = yield* render({ position: at(2, 0, 0) }, (audio) =>
        audio.listener.setOrientation(at(0, 0, 1), at(0, 1, 0))
      )
      assert.isAbove(peak(rendered, 0), 0.01)
      assert.isBelow(peak(rendered, 1), 0.001)
    })
  )

  it.live("a voice four times farther is a quarter as loud with the inverse model", () =>
    Effect.gen(function* () {
      const near = yield* render({ position: at(0, 0, -1) })
      const far = yield* render({ position: at(0, 0, -4) })
      assert.closeTo(peak(far, 0) / peak(near, 0), 0.25, 0.02)
    })
  )

  it.live("honours the distance attributes it is given", () =>
    Effect.gen(function* () {
      const { layer, render: renderGraph } = makeOfflineContext(0.3, 44100, 2)
      const rendered = yield* Effect.gen(function* () {
        const audio = yield* Audio
        const sound = yield* audio.decode(makeWav(0.2), "tone.wav")
        // Linear model, silent from 10 on: halfway between 1 and 10 it is about half as loud.
        yield* audio.play(sound, {
          spatial: {
            position: at(0, 0, -5.5),
            distanceModel: "linear",
            refDistance: 1,
            maxDistance: 10,
            rolloffFactor: 1
          }
        })
        return yield* Effect.promise(renderGraph)
      }).pipe(Effect.scoped, Effect.provide(AudioLive.pipe(Layer.provide(layer))))
      const reference = yield* render({ position: at(0, 0, -1) })
      assert.closeTo(peak(rendered, 0) / peak(reference, 0), 0.5, 0.02)
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
