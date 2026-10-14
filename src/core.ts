import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { AudioContextService } from "./context.ts"
import { DecodeFailure, LoadError, NetworkFailure, UnsupportedFormat } from "./errors.ts"

export interface Sound {
  readonly buffer: AudioBuffer
  readonly source: string
}

export interface PlayOptions {
  readonly volume?: number
  readonly rate?: number
  readonly loop?: boolean
}

export interface Voice {
  /** Completes when playback ends naturally, the voice is stopped or its scope closes. */
  readonly ended: Effect.Effect<void>
  readonly stop: Effect.Effect<void>
  /** Linear fade of this voice's gain, scheduled on the audio thread. */
  readonly fadeTo: (volume: number, over: Duration.Input) => Effect.Effect<void>
}

export class Audio extends Context.Service<
  Audio,
  {
    /** Decode already-fetched bytes. Decoder failures become typed errors. */
    decode(bytes: ArrayBuffer, source: string): Effect.Effect<Sound, LoadError>
    /** Fetch then decode. Interrupting the effect aborts the request. */
    load(url: string): Effect.Effect<Sound, LoadError>
    /** Start a voice. Its audio nodes are released when the surrounding `Scope` closes. */
    play(sound: Sound, options?: PlayOptions): Effect.Effect<Voice, never, Scope.Scope>
  }
>()("fx-audio/Audio") {
  /** The service, still needing an `AudioContextService` for the platform. */
  static readonly layerNoDeps: Layer.Layer<Audio, never, AudioContextService> = Layer.effect(
    Audio,
    Effect.gen(function* () {
      const { ctx } = yield* AudioContextService

      const decode = Effect.fn("Audio.decode")(function* (bytes: ArrayBuffer, source: string) {
        const buffer = yield* Effect.tryPromise({
          try: () => ctx.decodeAudioData(bytes),
          catch: (cause) =>
            new LoadError({
              source,
              // Decoders report unknown codecs with an "unsupported ..." message.
              reason: /unsupported/i.test(String(cause))
                ? new UnsupportedFormat({ cause })
                : new DecodeFailure({ cause })
            })
        })
        return { buffer, source } satisfies Sound
      })

      const load = Effect.fn("Audio.load")(function* (url: string) {
        const response = yield* Effect.tryPromise({
          try: (signal) => fetch(url, { signal }),
          catch: (cause) => new LoadError({ source: url, reason: new NetworkFailure({ cause }) })
        })
        if (!response.ok) {
          return yield* new LoadError({
            source: url,
            reason: new NetworkFailure({ status: response.status })
          })
        }
        const bytes = yield* Effect.tryPromise({
          try: () => response.arrayBuffer(),
          catch: (cause) => new LoadError({ source: url, reason: new NetworkFailure({ cause }) })
        })
        return yield* decode(bytes, url)
      })

      const play = Effect.fnUntraced(function* (
        sound: Sound,
        options: PlayOptions = {}
      ): Effect.fn.Return<Voice, never, Scope.Scope> {
        const ended = yield* Deferred.make<void>()
        const { source, gain } = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const source = ctx.createBufferSource()
            const gain = ctx.createGain()
            source.buffer = sound.buffer
            source.loop = options.loop ?? false
            if (options.rate !== undefined) source.playbackRate.value = options.rate
            gain.gain.value = options.volume ?? 1
            source.connect(gain)
            gain.connect(ctx.destination)
            source.onended = () => Deferred.doneUnsafe(ended, Effect.void)
            source.start()
            return { source, gain }
          }),
          ({ source, gain }) =>
            Effect.suspend(() => {
              source.onended = null
              try {
                source.stop()
              } catch {
                // already stopped
              }
              source.disconnect()
              gain.disconnect()
              return Deferred.succeed(ended, undefined)
            })
        )
        return {
          ended: Deferred.await(ended),
          stop: Effect.sync(() => {
            source.stop()
          }),
          fadeTo: (volume, over) =>
            Effect.sync(() => {
              const now = ctx.currentTime
              gain.gain.setValueAtTime(gain.gain.value, now)
              gain.gain.linearRampToValueAtTime(volume, now + Duration.toSeconds(over))
            })
        }
      })

      return Audio.of({ decode, load, play })
    })
  )

  /** The service on the browser audio context. Use `layerNoDeps` with another platform layer. */
  static readonly layer: Layer.Layer<Audio> = this.layerNoDeps.pipe(
    Layer.provide(AudioContextService.layerBrowser)
  )
}
