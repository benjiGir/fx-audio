import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import type { AudioContextService } from "./context.ts"
import { BrowserAudioContextLive } from "./context.ts"
import type { Group, Voice } from "./core.ts"
import { Audio, AudioLive } from "./core.ts"
import type { Sound, SpriteSheet } from "./model.ts"
import { PlayOptions } from "./model.ts"

/** Promise facade for users who do not use Effect. Same engine, no Effect types. */
export interface PromiseVoice {
  readonly ended: Promise<void>
  stop(): void
  fadeTo(volume: number, seconds: number): void
  /** Throws a `SchemaError` outside -1 (left) to 1 (right). */
  setPan(pan: number): void
}

/** A mixer bus: volume, fade and mute for every voice played through it. */
export interface PromiseGroup {
  /** Throws a `SchemaError` when the options are invalid (negative volume, NaN rate, ...). */
  play(sound: Sound, options?: unknown): PromiseVoice
  /** Throws an `UnknownSprite` when the sheet does not define `name`, and a `SchemaError` on invalid options. */
  playSprite(sheet: SpriteSheet, name: string, options?: unknown): PromiseVoice
  /** Throws a `SchemaError` on a negative or non-finite volume. */
  setVolume(volume: number): void
  /** Linear fade, `seconds` long. Throws a `SchemaError` on a negative or non-finite volume. */
  fadeTo(volume: number, seconds: number): void
  mute(): void
  unmute(): void
}

export interface PromiseAudio extends PromiseGroup {
  load(url: string, signal?: AbortSignal): Promise<Sound>
  /** Every sound passes through it: Howler's global volume and mute. `play` and `playSprite` here play on it. */
  readonly master: PromiseGroup
  /** The group called `name`, created on first use and routed through the master. The same name gives the same object. */
  group(name: string): PromiseGroup
  dispose(): Promise<void>
}

const decodeOptions = Schema.decodeUnknownSync(PlayOptions)

/** Build the facade on a platform layer. Defaults to the browser audio context. */
export const createAudio = (
  platform: Layer.Layer<AudioContextService> = BrowserAudioContextLive
): PromiseAudio => {
  const runtime = ManagedRuntime.make(AudioLive.pipe(Layer.provide(platform)))
  const scope = runtime.runSync(Scope.make())
  const wrap = (voice: Voice): PromiseVoice => ({
    ended: runtime.runPromise(voice.ended),
    stop: () => runtime.runSync(voice.stop),
    fadeTo: (volume, seconds) => runtime.runSync(voice.fadeTo(volume, `${seconds} seconds`)),
    setPan: (pan) => runtime.runSync(voice.setPan(pan))
  })
  const inScope = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
    runtime.runSync(effect.pipe(Effect.provideService(Scope.Scope, scope)))
  const wrapGroup = (group: Group): PromiseGroup => ({
    play: (sound, options) => wrap(inScope(group.play(sound, decodeOptions(options ?? {})))),
    playSprite: (sheet, name, options) =>
      wrap(inScope(group.playSprite(sheet, name, decodeOptions(options ?? {})))),
    setVolume: (volume) => runtime.runSync(group.setVolume(volume)),
    fadeTo: (volume, seconds) => runtime.runSync(group.fadeTo(volume, `${seconds} seconds`)),
    mute: () => runtime.runSync(group.mute),
    unmute: () => runtime.runSync(group.unmute)
  })
  const audio = runtime.runSync(Audio.use(Effect.succeed))
  const master = wrapGroup(audio.master)
  const groups = new Map<string, PromiseGroup>()
  return {
    ...master,
    master,
    load: (url, signal) =>
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
