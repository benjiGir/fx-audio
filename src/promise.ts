import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Scope from "effect/Scope"
import type { AudioContextService } from "./context.ts"
import type { PlayOptions, Sound, Voice } from "./core.ts"
import { load as loadEffect, play as playEffect } from "./core.ts"

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

export const createAudio = (layer: Layer.Layer<AudioContextService>): PromiseAudio => {
  const runtime = ManagedRuntime.make(layer)
  const scope = Effect.runSync(Scope.make())
  const wrap = (voice: Voice): PromiseVoice => ({
    ended: Effect.runPromise(voice.ended),
    stop: () => Effect.runSync(voice.stop),
    fadeTo: (volume, seconds) => Effect.runSync(voice.fadeTo(volume, `${seconds} seconds`))
  })
  return {
    load: (url, signal) =>
      runtime.runPromise(loadEffect(url), signal === undefined ? undefined : { signal }),
    play: (sound, options) =>
      wrap(
        runtime.runSync(playEffect(sound, options).pipe(Effect.provideService(Scope.Scope, scope)))
      ),
    dispose: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await runtime.dispose()
    }
  }
}
