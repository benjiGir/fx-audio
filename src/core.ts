import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import type { AudioContextLike } from "./context.ts"
import { AudioContextService } from "./context.ts"
import { LoadError } from "./errors.ts"

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
  /** Completes when playback ends naturally or the voice is stopped. */
  readonly ended: Effect.Effect<void>
  readonly stop: Effect.Effect<void>
  /** Linear fade of this voice's gain, scheduled on the audio thread. */
  readonly fadeTo: (volume: number, over: Duration.Input) => Effect.Effect<void>
}

/** Decode already-fetched bytes. Decoder failures become typed errors. */
export const decode = Effect.fnUntraced(function* (
  bytes: ArrayBuffer,
  source: string
): Effect.fn.Return<Sound, LoadError, AudioContextService> {
  const { ctx } = yield* AudioContextService
  const buffer = yield* Effect.tryPromise({
    try: () => ctx.decodeAudioData(bytes),
    catch: (cause) =>
      new LoadError({
        // Decoders report unknown codecs with an "unsupported ..." message.
        reason: /unsupported/i.test(String(cause)) ? "unsupported-format" : "decode",
        source,
        cause
      })
  })
  return { buffer, source }
})

/** Fetch + decode. Interrupting the effect aborts the request. */
export const load = Effect.fnUntraced(function* (
  url: string
): Effect.fn.Return<Sound, LoadError, AudioContextService> {
  const bytes = yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.arrayBuffer()
    },
    catch: (cause) => new LoadError({ reason: "network", source: url, cause })
  })
  return yield* decode(bytes, url)
})

const startVoice = (
  ctx: AudioContextLike,
  sound: Sound,
  options: PlayOptions,
  scope: Scope.Scope
): Voice => {
  const source = ctx.createBufferSource()
  const gain = ctx.createGain()
  source.buffer = sound.buffer
  source.loop = options.loop ?? false
  if (options.rate !== undefined) source.playbackRate.value = options.rate
  gain.gain.value = options.volume ?? 1
  source.connect(gain)
  gain.connect(ctx.destination)

  const done = Deferred.makeUnsafe<void>()
  const finish = () => Deferred.doneUnsafe(done, Effect.void)
  source.onended = finish

  // Nodes are always disconnected when the owning scope closes, even on error.
  Effect.runSync(
    Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        source.onended = null
        try {
          source.stop()
        } catch {
          // already stopped
        }
        source.disconnect()
        gain.disconnect()
        finish()
      })
    )
  )

  source.start()
  return {
    ended: Deferred.await(done),
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
}

/** Start a voice. Its nodes live as long as the surrounding `Scope`. */
export const play = Effect.fnUntraced(function* (
  sound: Sound,
  options: PlayOptions = {}
): Effect.fn.Return<Voice, never, AudioContextService | Scope.Scope> {
  const { ctx } = yield* AudioContextService
  const scope = yield* Scope.Scope
  return startVoice(ctx, sound, options, scope)
})
