import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Scope from "effect/Scope"
import { AudioContextService } from "./context.ts"
import type { PlayOptions, Sound, Voice } from "./core.ts"
import { Audio } from "./core.ts"

/** Promise facade for users who do not use Effect. Same engine, no Effect types. */
export interface PromiseVoice {
  readonly ended: Promise<void>
  stop(): void
  fadeTo(volume: number, seconds: number): void
}

export interface PromiseAudio {
  load(url: string, signal?: AbortSignal): Promise<Sound>
  play(sound: Sound, options?: PlayOptions): PromiseVoice
  dispose(): Promise<void>
}

/** Build the facade on a platform layer. Defaults to the browser audio context. */
export const createAudio = (
  platform: Layer.Layer<AudioContextService> = AudioContextService.layerBrowser
): PromiseAudio => {
  const runtime = ManagedRuntime.make(Audio.layerNoDeps.pipe(Layer.provide(platform)))
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
    play: (sound, options) =>
      wrap(
        runtime.runSync(
          Audio.use((audio) => audio.play(sound, options)).pipe(
            Effect.provideService(Scope.Scope, scope)
          )
        )
      ),
    dispose: async () => {
      await runtime.runPromise(Scope.close(scope, Exit.void))
      await runtime.dispose()
    }
  }
}
