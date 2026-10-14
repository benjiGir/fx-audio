import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import type { AudioNodeLike } from "./context.ts"
import { AudioContextService, BrowserAudioContextLive } from "./context.ts"
import {
  DecodeFailure,
  LoadError,
  NetworkFailure,
  UnknownSprite,
  UnsupportedFormat
} from "./errors.ts"
import { type PlayOptions, Sound, type SpriteSegment, type SpriteSheet, Volume } from "./model.ts"

export interface Voice {
  /** Completes when playback ends naturally, the voice is stopped or its scope closes. */
  readonly ended: Effect.Effect<void>
  readonly stop: Effect.Effect<void>
  /** Linear fade of this voice's gain, scheduled on the audio thread. */
  readonly fadeTo: (volume: number, over: Duration.Input) => Effect.Effect<void>
}

/**
 * A mixer bus: every voice played through it shares one gain, so a whole
 * category of sounds (music, effects, voice) can be faded, muted or turned down at once.
 */
export interface Group {
  readonly play: (sound: Sound, options?: PlayOptions) => Effect.Effect<Voice, never, Scope.Scope>
  readonly playSprite: (
    sheet: SpriteSheet,
    name: string,
    options?: PlayOptions
  ) => Effect.Effect<Voice, UnknownSprite, Scope.Scope>
  /** Set the volume at once, cancelling a fade in progress. Dies on a negative or non-finite volume. */
  readonly setVolume: (volume: number) => Effect.Effect<void>
  /** Linear fade to `volume`. While muted, only the volume restored by `unmute` changes. */
  readonly fadeTo: (volume: number, over: Duration.Input) => Effect.Effect<void>
  /** Silence the group, remembering its volume. Muting twice is harmless. */
  readonly mute: Effect.Effect<void>
  /** Restore the volume the group had when it was muted. */
  readonly unmute: Effect.Effect<void>
}

const decodeVolume = Schema.decodeUnknownSync(Volume)

export class Audio extends Context.Service<
  Audio,
  {
    /** Decode already-fetched bytes. Decoder failures become typed errors. */
    decode(bytes: ArrayBuffer, source: string): Effect.Effect<Sound, LoadError>
    /** Fetch then decode. Interrupting the effect aborts the request. */
    load(url: string): Effect.Effect<Sound, LoadError>
    /** Start a voice on the master group. Its audio nodes are released when the surrounding `Scope` closes. */
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
    /** The group every other group and every plain `play` ends up in: Howler's global volume and mute. */
    readonly master: Group
    /**
     * The group called `name`, created on first use and routed through the master.
     * Asking for the same name again returns the same group. Groups are released with the layer.
     */
    group(name: string): Effect.Effect<Group>
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
      segment: SpriteSegment | undefined,
      output: AudioNodeLike
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
          gain.connect(output)
          source.onended = () => Deferred.doneUnsafe(ended, Effect.void)
          if (segment === undefined) {
            source.start()
          } else {
            // The Web Audio API counts in seconds, sprite segments in milliseconds.
            const start = segment.start / 1000
            const duration = segment.duration / 1000
            if (source.loop) {
              // A looping source plays until stopped, so the segment bounds the loop instead.
              source.loopStart = start
              source.loopEnd = start + duration
              source.start(0, start)
            } else {
              source.start(0, start, duration)
            }
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

    const spriteOn = (output: AudioNodeLike) =>
      Effect.fnUntraced(function* (
        sheet: SpriteSheet,
        name: string,
        options: PlayOptions = {}
      ): Effect.fn.Return<Voice, UnknownSprite, Scope.Scope> {
        // `hasOwn` keeps names such as "toString" from resolving to inherited members.
        const segment = Object.hasOwn(sheet.segments, name) ? sheet.segments[name] : undefined
        if (segment === undefined) {
          return yield* new UnknownSprite({ name, available: Object.keys(sheet.segments) })
        }
        return yield* startVoice(sheet.sound, options, segment, output)
      })

    const buildGroup = Effect.fnUntraced(function* (
      output: AudioNodeLike
    ): Effect.fn.Return<
      { readonly group: Group; readonly node: AudioNodeLike },
      never,
      Scope.Scope
    > {
      const node = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const node = ctx.createGain()
          node.connect(output)
          return node
        }),
        (node) => Effect.sync(() => node.disconnect())
      )
      // The volume to restore on unmute, and whether the group is silenced right now.
      const volume = yield* Ref.make(1)
      const muted = yield* Ref.make(false)

      const applyNow = (value: number) =>
        Effect.sync(() => {
          const now = ctx.currentTime
          node.gain.cancelScheduledValues(now)
          node.gain.setValueAtTime(value, now)
        })

      const setVolume = Effect.fnUntraced(function* (requested: number) {
        const value = decodeVolume(requested)
        yield* Ref.set(volume, value)
        if (!(yield* Ref.get(muted))) yield* applyNow(value)
      })

      const fadeTo = Effect.fnUntraced(function* (requested: number, over: Duration.Input) {
        const value = decodeVolume(requested)
        yield* Ref.set(volume, value)
        if (yield* Ref.get(muted)) return
        yield* Effect.sync(() => {
          const now = ctx.currentTime
          node.gain.cancelScheduledValues(now)
          node.gain.setValueAtTime(node.gain.value, now)
          node.gain.linearRampToValueAtTime(value, now + Duration.toSeconds(over))
        })
      })

      const mute = Effect.suspend(() => Ref.set(muted, true).pipe(Effect.andThen(applyNow(0))))
      const unmute = Effect.suspend(() =>
        Ref.set(muted, false).pipe(Effect.andThen(Ref.get(volume)), Effect.flatMap(applyNow))
      )

      const group: Group = {
        play: (sound, options = {}) => startVoice(sound, options, undefined, node),
        playSprite: spriteOn(node),
        setVolume,
        fadeTo,
        mute,
        unmute
      }
      return { group, node }
    })

    const { group: master, node: masterNode } = yield* buildGroup(ctx.destination)

    // Groups live as long as the layer, whichever scope first asks for them.
    const layerScope = yield* Effect.scope
    const groups = new Map<string, Group>()
    const creating = yield* Semaphore.make(1)
    const group = Effect.fn("Audio.group")(function* (name: string) {
      return yield* Effect.gen(function* () {
        const existing = groups.get(name)
        if (existing !== undefined) return existing
        const { group } = yield* buildGroup(masterNode).pipe(
          Effect.provideService(Scope.Scope, layerScope)
        )
        groups.set(name, group)
        return group
      }).pipe(Semaphore.withPermit(creating))
    })

    return Audio.of({
      decode,
      load,
      play: master.play,
      playSprite: master.playSprite,
      master,
      group
    })
  })
)

/** The service on the browser audio context. Compose `AudioLive` with another platform layer elsewhere. */
export const AudioBrowserLive: Layer.Layer<Audio> = AudioLive.pipe(
  Layer.provide(BrowserAudioContextLive)
)
