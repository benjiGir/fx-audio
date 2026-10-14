import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import type { AudioContextService } from "./context.ts"
import { BrowserAudioContextLive } from "./context.ts"
import type { Voice } from "./core.ts"
import { Audio, AudioLive } from "./core.ts"
import type { Sound, SpriteSheet } from "./model.ts"
import { PlayOptions } from "./model.ts"

/** Promise facade for users who do not use Effect. Same engine, no Effect types. */
export interface PromiseVoice {
  readonly ended: Promise<void>
  stop(): void
  fadeTo(volume: number, seconds: number): void
}

export interface PromiseAudio {
  load(url: string, signal?: AbortSignal): Promise<Sound>
  /** Throws a `SchemaError` when the options are invalid (negative volume, NaN rate, ...). */
  play(sound: Sound, options?: unknown): PromiseVoice
  /** Throws an `UnknownSprite` when the sheet does not define `name`, and a `SchemaError` on invalid options. */
  playSprite(sheet: SpriteSheet, name: string, options?: unknown): PromiseVoice
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
    fadeTo: (volume, seconds) => runtime.runSync(voice.fadeTo(volume, `${seconds} seconds`))
  })
  return {
    load: (url, signal) =>
      runtime.runPromise(
        Audio.use((audio) => audio.load(url)),
        signal === undefined ? undefined : { signal }
      ),
    play: (sound, options) => {
      const decoded = decodeOptions(options ?? {})
      return wrap(
        runtime.runSync(
          Audio.use((audio) => audio.play(sound, decoded)).pipe(
            Effect.provideService(Scope.Scope, scope)
          )
        )
      )
    },
    playSprite: (sheet, name, options) => {
      const decoded = decodeOptions(options ?? {})
      return wrap(
        runtime.runSync(
          Audio.use((audio) => audio.playSprite(sheet, name, decoded)).pipe(
            Effect.provideService(Scope.Scope, scope)
          )
        )
      )
    },
    dispose: async () => {
      await runtime.runPromise(Scope.close(scope, Exit.void))
      await runtime.dispose()
    }
  }
}
