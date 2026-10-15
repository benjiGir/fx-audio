/**
 * Promise facade for code that does not use Effect: `createAudio` for the browser,
 * `createAudioAsync` for layers that build asynchronously, such as the Node one.
 * @module fx-audio/promise
 */

import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
export type { SoundBank } from "./bank.ts"
export { makeSoundBank } from "./bank.ts"
import type { AudioContextService } from "./context.ts"
import { BrowserAudioContextLive } from "./context.ts"
import type { Analyser, Group, Listener, Voice } from "./core.ts"
import { Audio, AudioLive } from "./core.ts"
import type { Sound, SpriteSheet, Vector3, VoiceEvent } from "./model.ts"
import { AudioEffect, DuckOptions, PlayOptions } from "./model.ts"

/** The level and spectrum of a voice or a group, see `Analyser`. Each method reads the signal as it is now. */
export interface PromiseAnalyser {
  /** The RMS of the last 2048 samples, from 0 (silence) to 1 (full scale). */
  level(): number
  /** The highest absolute sample of the same window, from 0 to 1. */
  peak(): number
  /** 1024 values from 0 to 255, from 0 Hz up to half the sample rate. */
  spectrum(): Uint8Array
  /** The last 2048 samples, each from -1 to 1. */
  waveform(): Float32Array
}

/** Promise facade for users who do not use Effect. Same engine, no Effect types. */
export interface PromiseVoice {
  readonly ended: Promise<void>
  /**
   * Call `listener` each time the voice sends an event of this type, from now on: `pause`, `resume`,
   * `seek`, `rate`, `volume`, `loop`, `stop` or `end`. Returns a function that stops listening.
   * A listener that throws does not stop the others or the voice: the error is rethrown outside,
   * where the page reports it.
   */
  on<Type extends VoiceEvent["_tag"]>(
    type: Type,
    listener: (event: Extract<VoiceEvent, { readonly _tag: Type }>) => void
  ): () => void
  stop(): void
  /** Reads this voice's level and spectrum. The same object on every call. */
  analyser(): PromiseAnalyser
  /** Hold the voice where it is. */
  pause(): void
  /** Carry on after `pause`. Rejects with `PlaybackBlocked` only for a streamed voice the browser refuses to restart. */
  resume(): Promise<void>
  /** Jump to `milliseconds` from the start, playing or paused. Throws a `SchemaError` on a negative or non-finite time. */
  seek(milliseconds: number): void
  /** Where the voice is, in milliseconds from its start. */
  position(): number
  paused(): boolean
  /** Set the volume at once. Throws a `SchemaError` on a negative or non-finite volume. */
  setVolume(volume: number): void
  /** Change the speed while playing. Throws a `SchemaError` on a rate that is not above zero. */
  setRate(rate: number): void
  setLoop(loop: boolean): void
  fadeTo(volume: number, milliseconds: number): void
  /** Fade to silence over `milliseconds`, then stop. Resolves once the voice has stopped. */
  fadeOut(milliseconds: number): Promise<void>
  /** Throws a `SchemaError` outside -1 (left) to 1 (right). */
  setPan(pan: number): void
  /** Move the voice in 3D space. Throws a `SchemaError` on a non-finite coordinate. */
  setPosition(position: Vector3): void
}

/** Where the sound is heard from. Both methods throw a `SchemaError` on a non-finite coordinate. */
export interface PromiseListener {
  setPosition(position: Vector3): void
  setOrientation(forward: Vector3, up: Vector3): void
}

/** A mixer bus: volume, fade and mute for every voice played through it. */
export interface PromiseGroup {
  /** Throws a `SchemaError` when the options are invalid (negative volume, NaN rate, ...). */
  play(sound: Sound, options?: unknown): PromiseVoice
  /** Throws an `UnknownSprite` when the sheet does not define `name`, and a `SchemaError` on invalid options. */
  playSprite(sheet: SpriteSheet, name: string, options?: unknown): PromiseVoice
  /**
   * Play a long sound while it downloads. Rejects with a `LoadError`, or with `PlaybackBlocked`
   * before a user gesture, and throws a `SchemaError` on invalid options.
   */
  stream(url: string, options?: unknown): Promise<PromiseVoice>
  /**
   * Hand over from `out` to `sound`: the new voice starts silent and fades up to `options.volume` (1 by
   * default) while `out` fades down and stops, both over `milliseconds`. Returns the new voice.
   * Throws a `SchemaError` on invalid options.
   */
  crossfade(out: PromiseVoice, sound: Sound, milliseconds: number, options?: unknown): PromiseVoice
  /** Stop every voice playing through this group (on the master, every voice): Howler's `Howler.stop()`. */
  stopAll(): void
  /** Reads the level and spectrum of everything this group plays. The same object on every call. */
  analyser(): PromiseAnalyser
  /**
   * Put these effects on everything this group plays, in order, replacing the ones set before (`[]`
   * takes them all off). Each effect is an object with a `_tag`: `{ _tag: "filter", type: "lowpass",
   * frequency: 800 }`, `echo`, `reverb` or `compressor`. Throws a `SchemaError` on an invalid effect.
   */
  setEffects(effects: ReadonlyArray<unknown>): void
  /** How many voices are playing through this group right now, paused ones included. */
  voiceCount(): number
  /**
   * Cap the voices playing through this group: a voice that starts over the cap stops the oldest one.
   * `undefined` removes the cap. Throws a `SchemaError` on anything but a whole number of one or more.
   */
  setMaxVoices(limit: number | undefined): void
  /**
   * Lower this group while `trigger` has voices playing and bring it back when it has none, over
   * `options.attack` and `options.release` milliseconds, down to `options.volume` (0.3) times its own
   * volume. Returns a function that ends the ducking. Throws a `SchemaError` on invalid options and a
   * `TypeError` when `trigger` is not a group of this audio.
   */
  duck(trigger: PromiseGroup, options?: unknown): () => void
  /** Throws a `SchemaError` on a negative or non-finite volume. */
  setVolume(volume: number): void
  /** Linear fade, `milliseconds` long. Throws a `SchemaError` on a negative or non-finite volume. */
  fadeTo(volume: number, milliseconds: number): void
  mute(): void
  unmute(): void
}

export interface PromiseAudio extends PromiseGroup {
  load(url: string, signal?: AbortSignal): Promise<Sound>
  /** Every sound passes through it: Howler's global volume and mute. `play` and `playSprite` here play on it. */
  readonly master: PromiseGroup
  /** The group called `name`, created on first use and routed through the master. The same name gives the same object. */
  group(name: string): PromiseGroup
  /** The listener spatial voices are heard from. */
  readonly listener: PromiseListener
  /** The audio clock in milliseconds, the time `startAt` is counted on. It runs only while the context does. */
  now(): number
  /** The state of the audio context: `running`, `suspended`, `interrupted` or `closed`. */
  state(): string
  /** Resume a context the browser kept suspended. Call it from a user gesture; it also happens on the first click, key press or touch. */
  resume(): Promise<void>
  dispose(): Promise<void>
}

const decodeOptions = Schema.decodeUnknownSync(PlayOptions)
const decodeEffects = Schema.decodeUnknownSync(Schema.Array(AudioEffect))
const decodeDuck = Schema.decodeUnknownSync(DuckOptions)

type Runtime = ManagedRuntime.ManagedRuntime<Audio, never>

const makeRuntime = (platform: Layer.Layer<AudioContextService>): Runtime =>
  ManagedRuntime.make(AudioLive.pipe(Layer.provide(platform)))

/**
 * Build the facade on a platform layer. Defaults to the browser audio context.
 * The layer has to build synchronously, as the browser's does: for one that does not,
 * such as `NodeAudioContextLive`, use `createAudioAsync`.
 *
 * @example
 * ```ts
 * const audio = createAudio()
 * const sound = await audio.load("/sounds/hit.mp3")
 * const voice = audio.play(sound, { volume: 0.8 })
 * await voice.ended
 * await audio.dispose()
 * ```
 */
export const createAudio = (
  platform: Layer.Layer<AudioContextService> = BrowserAudioContextLive
): PromiseAudio => {
  const runtime = makeRuntime(platform)
  return facade(runtime, runtime.runSync(Scope.make()), runtime.runSync(Audio.use(Effect.succeed)))
}

/**
 * Build the facade on a platform layer that builds asynchronously, such as `NodeAudioContextLive`
 * (it loads `node-web-audio-api` on demand). Resolves once the audio context exists.
 *
 * @example
 * ```ts
 * const audio = await createAudioAsync(NodeAudioContextLive())
 * audio.play(await audio.load("./sounds/hit.wav"))
 * ```
 */
export const createAudioAsync = async (
  platform: Layer.Layer<AudioContextService>
): Promise<PromiseAudio> => {
  const runtime = makeRuntime(platform)
  try {
    const [scope, audio] = await runtime.runPromise(
      Effect.all([Scope.make(), Audio.use(Effect.succeed)])
    )
    return facade(runtime, scope, audio)
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}

const facade = (
  runtime: Runtime,
  scope: Scope.Closeable,
  audio: Audio["Service"]
): PromiseAudio => {
  const wrapAnalyser = (analyser: Analyser): PromiseAnalyser => ({
    level: () => runtime.runSync(analyser.level),
    peak: () => runtime.runSync(analyser.peak),
    spectrum: () => runtime.runSync(analyser.spectrum),
    waveform: () => runtime.runSync(analyser.waveform)
  })
  const analysers = new WeakMap<Analyser, PromiseAnalyser>()
  const analyserOf = (effect: Effect.Effect<Analyser>) => {
    const analyser = runtime.runSync(effect)
    let wrapped = analysers.get(analyser)
    if (wrapped === undefined) {
      wrapped = wrapAnalyser(analyser)
      analysers.set(analyser, wrapped)
    }
    return wrapped
  }
  // The facade hands out `PromiseVoice`s; `crossfade` needs the voice behind one.
  const voices = new WeakMap<PromiseVoice, Voice>()
  const wrap = (voice: Voice): PromiseVoice => {
    const wrapped = wrapVoice(voice)
    voices.set(wrapped, voice)
    return wrapped
  }
  const wrapVoice = (voice: Voice): PromiseVoice => ({
    ended: runtime.runPromise(voice.ended),
    on: (type, listener) => {
      const fiber = runtime.runFork(
        Stream.runForEach(voice.events, (event) =>
          Effect.sync(() => {
            if (event._tag !== type) return
            try {
              listener(event as never)
            } catch (error) {
              queueMicrotask(() => {
                throw error
              })
            }
          })
        )
      )
      return () => fiber.interruptUnsafe()
    },
    stop: () => runtime.runSync(voice.stop),
    analyser: () => analyserOf(voice.analyser),
    pause: () => runtime.runSync(voice.pause),
    resume: () => runtime.runPromise(voice.resume),
    seek: (milliseconds) => runtime.runSync(voice.seek(milliseconds)),
    position: () => runtime.runSync(voice.position),
    paused: () => runtime.runSync(voice.paused),
    setVolume: (volume) => runtime.runSync(voice.setVolume(volume)),
    setRate: (rate) => runtime.runSync(voice.setRate(rate)),
    setLoop: (loop) => runtime.runSync(voice.setLoop(loop)),
    fadeTo: (volume, milliseconds) =>
      runtime.runSync(voice.fadeTo(volume, `${milliseconds} millis`)),
    fadeOut: (milliseconds) => runtime.runPromise(voice.fadeOut(`${milliseconds} millis`)),
    setPan: (pan) => runtime.runSync(voice.setPan(pan)),
    setPosition: (position) => runtime.runSync(voice.setPosition(position))
  })
  const withScope = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
    effect.pipe(Effect.provideService(Scope.Scope, scope))
  const inScope = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
    runtime.runSync(withScope(effect))
  // `duck` is given the facade's group and needs the group behind it.
  const groupsOf = new WeakMap<PromiseGroup, Group>()
  const wrapGroup = (group: Group): PromiseGroup => {
    const wrapped = wrapGroupMethods(group)
    groupsOf.set(wrapped, group)
    return wrapped
  }
  const wrapGroupMethods = (group: Group): PromiseGroup => ({
    play: (sound, options) => wrap(inScope(group.play(sound, decodeOptions(options ?? {})))),
    playSprite: (sheet, name, options) =>
      wrap(inScope(group.playSprite(sheet, name, decodeOptions(options ?? {})))),
    stream: async (url, options) => {
      const decoded = decodeOptions(options ?? {})
      return wrap(await runtime.runPromise(withScope(group.stream(url, decoded))))
    },
    crossfade: (out, sound, milliseconds, options) => {
      const from = voices.get(out)
      if (from === undefined) throw new TypeError("crossfade needs a voice of this audio")
      return wrap(
        inScope(
          group.crossfade(from, sound, `${milliseconds} millis`, decodeOptions(options ?? {}))
        )
      )
    },
    duck: (trigger, options) => {
      const from = groupsOf.get(trigger)
      if (from === undefined) throw new TypeError("duck needs a group of this audio")
      const own = Scope.forkUnsafe(scope)
      runtime.runSync(
        group.duck(from, decodeDuck(options ?? {})).pipe(Effect.provideService(Scope.Scope, own))
      )
      return () => runtime.runSync(Scope.close(own, Exit.void))
    },
    stopAll: () => runtime.runSync(group.stopAll),
    analyser: () => analyserOf(group.analyser),
    setEffects: (effects) => runtime.runSync(group.setEffects(decodeEffects(effects))),
    voiceCount: () => runtime.runSync(group.voiceCount),
    setMaxVoices: (limit) => runtime.runSync(group.setMaxVoices(limit)),
    setVolume: (volume) => runtime.runSync(group.setVolume(volume)),
    fadeTo: (volume, milliseconds) =>
      runtime.runSync(group.fadeTo(volume, `${milliseconds} millis`)),
    mute: () => runtime.runSync(group.mute),
    unmute: () => runtime.runSync(group.unmute)
  })
  const master = wrapGroup(audio.master)
  const listener = audio.listener satisfies Listener
  const groups = new Map<string, PromiseGroup>()
  const facadeAudio: PromiseAudio = {
    ...master,
    master,
    listener: {
      setPosition: (position) => runtime.runSync(listener.setPosition(position)),
      setOrientation: (forward, up) => runtime.runSync(listener.setOrientation(forward, up))
    },
    state: () => runtime.runSync(audio.state),
    resume: () => runtime.runPromise(audio.resume),
    now: () => runtime.runSync(audio.now),
    load: (url, signal) =>
      // Stryker disable next-line ConditionalExpression: `{ signal: undefined }` behaves like no option.
      runtime.runPromise(audio.load(url), signal === undefined ? undefined : { signal }),
    group: (name) => {
      let wrapped = groups.get(name)
      if (wrapped === undefined) {
        wrapped = wrapGroup(runtime.runSync(audio.group(name)))
        groups.set(name, wrapped)
      }
      return wrapped
    },
    dispose: async () => {
      await runtime.runPromise(Scope.close(scope, Exit.void))
      await runtime.dispose()
    }
  }
  // The audio object is the master as well: it can duck and be a trigger like `audio.master`.
  groupsOf.set(facadeAudio, audio.master)
  return facadeAudio
}
