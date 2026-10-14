import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { AudioContextService, BrowserAudioContextLive } from "./context.ts"
import {
  DecodeFailure,
  LoadError,
  NetworkFailure,
  UnknownSprite,
  UnsupportedFormat
} from "./errors.ts"
import { type PlayOptions, Sound, type SpriteSegment, type SpriteSheet } from "./model.ts"

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
    /**
     * Start a voice on one named segment of a sprite sheet. Fails with
     * `UnknownSprite` when the sheet does not define `name`. `options.loop`
     * overrides the segment's own `loop` flag.
     */
    playSprite(
      sheet: SpriteSheet,
      name: string,
      options?: PlayOptions
    ): Effect.Effect<Voice, UnknownSprite, Scope.Scope>
  }
>()("fx-audio/Audio") {}

/** The service, still needing an `AudioContextService` for the platform. */
export const AudioLive: Layer.Layer<Audio, never, AudioContextService> = Layer.effect(
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
      return new Sound({ buffer, source })
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

    const startVoice = Effect.fnUntraced(function* (
      sound: Sound,
      options: PlayOptions,
      segment: SpriteSegment | undefined
    ): Effect.fn.Return<Voice, never, Scope.Scope> {
      const ended = yield* Deferred.make<void>()
      const { source, gain } = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const source = ctx.createBufferSource()
          const gain = ctx.createGain()
          source.buffer = sound.buffer
          source.loop = options.loop ?? segment?.loop ?? false
          if (options.rate !== undefined) source.playbackRate.value = options.rate
          gain.gain.value = options.volume ?? 1
          source.connect(gain)
          gain.connect(ctx.destination)
          source.onended = () => Deferred.doneUnsafe(ended, Effect.void)
          if (segment === undefined) {
            source.start()
          } else if (source.loop) {
            // A looping source plays until stopped, so the segment bounds the loop instead.
            source.loopStart = segment.start
            source.loopEnd = segment.start + segment.duration
            source.start(0, segment.start)
          } else {
            source.start(0, segment.start, segment.duration)
          }
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

    const play = (sound: Sound, options: PlayOptions = {}) => startVoice(sound, options, undefined)

    const playSprite = Effect.fnUntraced(function* (
      sheet: SpriteSheet,
      name: string,
      options: PlayOptions = {}
    ): Effect.fn.Return<Voice, UnknownSprite, Scope.Scope> {
      // `hasOwn` keeps names such as "toString" from resolving to inherited members.
      const segment = Object.hasOwn(sheet.segments, name) ? sheet.segments[name] : undefined
      if (segment === undefined) {
        return yield* new UnknownSprite({ name, available: Object.keys(sheet.segments) })
      }
      return yield* startVoice(sheet.sound, options, segment)
    })

    return Audio.of({ decode, load, play, playSprite })
  })
)

/** The service on the browser audio context. Compose `AudioLive` with another platform layer elsewhere. */
export const AudioBrowserLive: Layer.Layer<Audio> = AudioLive.pipe(
  Layer.provide(BrowserAudioContextLive)
)
