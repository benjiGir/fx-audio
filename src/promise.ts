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
import type { AudioContextService } from "./context.ts"
import { BrowserAudioContextLive } from "./context.ts"
import type { Group, Listener, Voice } from "./core.ts"
import { Audio, AudioLive } from "./core.ts"
import type { Sound, SpriteSheet, Vector3, VoiceEvent } from "./model.ts"
import { PlayOptions } from "./model.ts"

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
  /** Resume a context the browser kept suspended. Call it from a user gesture; it also happens on the first click, key press or touch. */
  resume(): Promise<void>
  dispose(): Promise<void>
}

const decodeOptions = Schema.decodeUnknownSync(PlayOptions)

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
  const wrap = (voice: Voice): PromiseVoice => ({
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
    setPan: (pan) => runtime.runSync(voice.setPan(pan)),
    setPosition: (position) => runtime.runSync(voice.setPosition(position))
  })
  const withScope = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
    effect.pipe(Effect.provideService(Scope.Scope, scope))
  const inScope = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
    runtime.runSync(withScope(effect))
  const wrapGroup = (group: Group): PromiseGroup => ({
    play: (sound, options) => wrap(inScope(group.play(sound, decodeOptions(options ?? {})))),
    playSprite: (sheet, name, options) =>
      wrap(inScope(group.playSprite(sheet, name, decodeOptions(options ?? {})))),
    stream: async (url, options) => {
      const decoded = decodeOptions(options ?? {})
      return wrap(await runtime.runPromise(withScope(group.stream(url, decoded))))
    },
    setVolume: (volume) => runtime.runSync(group.setVolume(volume)),
    fadeTo: (volume, milliseconds) =>
      runtime.runSync(group.fadeTo(volume, `${milliseconds} millis`)),
    mute: () => runtime.runSync(group.mute),
    unmute: () => runtime.runSync(group.unmute)
  })
  const master = wrapGroup(audio.master)
  const listener = audio.listener satisfies Listener
  const groups = new Map<string, PromiseGroup>()
  return {
    ...master,
    master,
    listener: {
      setPosition: (position) => runtime.runSync(listener.setPosition(position)),
      setOrientation: (forward, up) => runtime.runSync(listener.setOrientation(forward, up))
    },
    resume: () => runtime.runPromise(audio.resume),
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
}
