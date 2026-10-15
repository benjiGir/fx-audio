import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import type {
  AudioNodeLike,
  AudioParamLike,
  MediaElementLike,
  PannerNodeLike,
  SourceNodeLike,
  StereoPannerNodeLike
} from "./context.ts"
import { AudioContextService, BrowserAudioContextLive } from "./context.ts"
import {
  DecodeFailure,
  LoadError,
  NetworkFailure,
  PlaybackBlocked,
  StreamingUnavailable,
  UnknownSprite,
  UnsupportedFormat
} from "./errors.ts"
import {
  Ended,
  LoopChanged,
  Pan,
  Paused,
  type PlayOptions,
  Position,
  Rate,
  RateChanged,
  Resumed,
  Seeked,
  Sound,
  SpatialOptions,
  type SpriteSegment,
  type SpriteSheet,
  Stopped,
  Vector3,
  type VoiceEvent,
  Volume,
  VolumeChanged
} from "./model.ts"

export interface Voice {
  /** Completes when playback ends naturally, the voice is stopped or its scope closes. */
  readonly ended: Effect.Effect<void>
  readonly stop: Effect.Effect<void>
  /**
   * What happens to this voice from the moment the stream starts running: `pause`, `resume`,
   * `seek`, `rate`, `volume`, `loop`, then `stop` or `end`, after which the stream completes.
   * Events from before are not replayed, and the stream of a voice that has already ended is
   * empty. A voice nobody listens to pays nothing for it.
   */
  readonly events: Stream.Stream<VoiceEvent>
  /** Hold the voice where it is. Pausing a paused voice does nothing, and `ended` stays pending. */
  readonly pause: Effect.Effect<void>
  /**
   * Carry on from where `pause` left the voice. Fails with `PlaybackBlocked` only for a streamed
   * voice the browser refuses to restart. Does nothing on a voice that is not paused.
   */
  readonly resume: Effect.Effect<void, PlaybackBlocked>
  /**
   * Jump to `milliseconds` from the start of the sound (of the segment, for a sprite), playing or
   * paused. Past the end, a looping voice wraps around and any other voice ends. Dies on a negative or
   * non-finite time.
   */
  readonly seek: (milliseconds: number) => Effect.Effect<void>
  /** Where the voice is, in milliseconds from the start of the sound (of the segment, for a sprite). */
  readonly position: Effect.Effect<number>
  /** Whether `pause` holds the voice right now. */
  readonly paused: Effect.Effect<boolean>
  /** Set the volume at once, cancelling a fade in progress. Dies on a negative or non-finite volume. */
  readonly setVolume: (volume: number) => Effect.Effect<void>
  /** Change the playback speed while the voice plays: one is normal, two is twice as fast. Dies on a rate that is not above zero. */
  readonly setRate: (rate: number) => Effect.Effect<void>
  /** Turn looping on or off while the voice plays. */
  readonly setLoop: (loop: boolean) => Effect.Effect<void>
  /** Linear fade of this voice's gain, scheduled on the audio thread. */
  readonly fadeTo: (volume: number, over: Duration.Input) => Effect.Effect<void>
  /**
   * Move this voice between the left (-1) and right (1) speaker. Dies on a value
   * outside that range. A voice started without `pan` gets its panner on the first call.
   */
  readonly setPan: (pan: number) => Effect.Effect<void>
  /**
   * Move this voice in 3D space, relative to the listener. Dies on a non-finite
   * coordinate. A voice started without `spatial` gets a spatial panner on the first call,
   * with the Web Audio defaults for everything but the position.
   */
  readonly setPosition: (position: Vector3) => Effect.Effect<void>
}

/**
 * Where the sound is heard from, shared by every voice. At the start it sits at the
 * origin facing -z with +y up, as in Web Audio.
 */
export interface Listener {
  /** Dies on a non-finite coordinate. */
  readonly setPosition: (position: Vector3) => Effect.Effect<void>
  /** `forward` is the way the listener faces, `up` the top of their head. Dies on a non-finite coordinate. */
  readonly setOrientation: (forward: Vector3, up: Vector3) => Effect.Effect<void>
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
  /**
   * Play a long sound, such as music, while it downloads, through a media element instead of
   * a decoded buffer. Resolves once the browser can start and playback has begun. Takes the
   * same options as `play`; `rate` and `loop` apply to the element. Fails with `LoadError`
   * (`StreamingUnavailable` where there is no media element, as under Node; browsers report
   * a missing file as `UnsupportedFormat`) and with `PlaybackBlocked` before a user gesture.
   */
  readonly stream: (
    url: string,
    options?: PlayOptions
  ) => Effect.Effect<Voice, LoadError | PlaybackBlocked, Scope.Scope>
  /**
   * Stop every voice playing through this group, Howler's `Howler.stop()` for the master. A voice
   * started afterwards plays normally, and a stream still waiting to start is not reached.
   */
  readonly stopAll: Effect.Effect<void>
  /** Set the volume at once, cancelling a fade in progress. Dies on a negative or non-finite volume. */
  readonly setVolume: (volume: number) => Effect.Effect<void>
  /** Linear fade to `volume`. While muted, only the volume restored by `unmute` changes. */
  readonly fadeTo: (volume: number, over: Duration.Input) => Effect.Effect<void>
  /** Silence the group, remembering its volume. Muting twice is harmless. */
  readonly mute: Effect.Effect<void>
  /** Restore the volume the group had when it was muted. */
  readonly unmute: Effect.Effect<void>
}

// A scheme of two letters or more makes a URL; a single letter is a Windows drive (`C:`).
const hasScheme = /^[a-z][a-z0-9+.-]+:/i

/** A `file:` URL or a plain path, as opposed to `http:`, `data:`, `blob:` and the like. */
const isLocalFile = (source: string) => source.startsWith("file:") || !hasScheme.test(source)

const decodeVolume = Schema.decodeUnknownSync(Volume)
const decodePan = Schema.decodeUnknownSync(Pan)
const decodeRate = Schema.decodeUnknownSync(Rate)
const decodePosition = Schema.decodeUnknownSync(Position)
const decodeVector = Schema.decodeUnknownSync(Vector3)

const setVector = (
  params: readonly [AudioParamLike, AudioParamLike, AudioParamLike],
  { x, y, z }: Vector3
) => {
  params[0].value = x
  params[1].value = y
  params[2].value = z
}

/** Adds a stop function to a group's set of playing voices, and returns the way to remove it. */
type Tracker = (stop: () => void) => () => void

const isLast = (event: VoiceEvent) => event._tag === "stop" || event._tag === "end"

/**
 * The events of one voice. The hub is only built when someone asks for the stream, and
 * `finish` is the one place a voice ends: it sends the last event, then completes `ended`.
 */
const voiceBus = (ended: Deferred.Deferred<void>, track: Tracker) => {
  let hub: PubSub.PubSub<VoiceEvent> | undefined
  let untrack: (() => void) | undefined
  let cleanup: (() => void) | undefined
  return {
    /** Let `stopAll` reach this voice until it ends. */
    register: (stop: () => void) => {
      untrack = track(stop)
    },
    /** Run `release` once the voice has ended, whichever way it ended. */
    releaseOnEnd: (release: () => void) => {
      cleanup = release
    },
    emit: (event: VoiceEvent) => {
      if (hub !== undefined) PubSub.publishUnsafe(hub, event)
    },
    finish: (last: Stopped | Ended) => {
      if (Deferred.isDoneUnsafe(ended)) return
      untrack?.()
      if (hub !== undefined) PubSub.publishUnsafe(hub, last)
      Deferred.doneUnsafe(ended, Effect.void)
      cleanup?.()
    },
    events: Stream.unwrap(
      Effect.suspend(() =>
        Deferred.isDoneUnsafe(ended)
          ? Effect.succeed(Stream.empty)
          : (hub === undefined
              ? PubSub.unbounded<VoiceEvent>().pipe(Effect.map((created) => (hub ??= created)))
              : Effect.succeed(hub)
            ).pipe(Effect.map((shared) => Stream.fromPubSub(shared).pipe(Stream.takeUntil(isLast))))
      )
    )
  }
}

type VoiceBus = ReturnType<typeof voiceBus>

/**
 * Like `Effect.acquireRelease`, and also returns a `close` that releases at once and drops the
 * finalizer. A scope that lives as long as the app, such as the promise facade's, would otherwise
 * keep one finalizer, and everything it refers to, for every voice ever played.
 */
const releasable = <A>(acquire: () => A, release: (resource: A) => void) =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const own = Scope.forkUnsafe(scope)
        const resource = acquire()
        let released = false
        const once = () => {
          if (released) return
          released = true
          release(resource)
        }
        yield* Scope.addFinalizer(own, Effect.sync(once))
        const close = () => {
          once()
          // Closing the child drops it from the parent; `once` has run what its finalizer would.
          Scope.closeUnsafe(own, Exit.void)
        }
        return { resource, close }
      })
    )
  })

/** What differs between a voice on a decoded buffer and one on a media element. Times are in seconds. */
interface Player {
  /** Only called on a voice that is playing. */
  readonly pause: () => void
  /** Only run on a voice that is paused. */
  readonly resume: Effect.Effect<void, PlaybackBlocked>
  readonly seek: (seconds: number) => void
  readonly position: () => number
  readonly paused: () => boolean
  readonly setRate: (rate: number) => void
  readonly setLoop: (loop: boolean) => void
  /** Silence the underlying source for good. */
  readonly stop: () => void
}

/**
 * The audio engine: load and decode sounds, play them (whole, by sprite or streamed), and reach
 * the master, the named groups and the listener. Provide it with `AudioBrowserLive`, or with
 * `AudioLive` on top of a platform layer such as `NodeAudioContextLive`.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const audio = yield* Audio
 *   const sound = yield* audio.load("/sounds/hit.mp3")
 *   const voice = yield* audio.play(sound, { volume: 0.8 })
 *   yield* voice.ended
 * }).pipe(Effect.scoped, Effect.provide(AudioBrowserLive))
 * ```
 */
export class Audio extends Context.Service<
  Audio,
  {
    /** Decode already-fetched bytes. Decoder failures become typed errors. */
    decode(bytes: ArrayBuffer, source: string): Effect.Effect<Sound, LoadError>
    /**
     * Fetch then decode. Interrupting the effect aborts the request. Where the platform can read
     * files (under Node), a path or a `file:` URL is read from disk instead of fetched.
     */
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
    /** Stream a long sound on the master group, see `Group.stream`. */
    stream(
      url: string,
      options?: PlayOptions
    ): Effect.Effect<Voice, LoadError | PlaybackBlocked, Scope.Scope>
    /** Stop every voice playing, in every group: Howler's `Howler.stop()`. See `Group.stopAll`. */
    readonly stopAll: Effect.Effect<void>
    /** The group every other group and every plain `play` ends up in: Howler's global volume and mute. */
    readonly master: Group
    /**
     * The group called `name`, created on first use and routed through the master.
     * Asking for the same name again returns the same group. Groups are released with the layer.
     */
    group(name: string): Effect.Effect<Group>
    /** The listener of the audio context, which every spatial voice is heard from. */
    readonly listener: Listener
    /**
     * Resume a context the browser kept suspended. Call it from a user gesture to be sure
     * sound starts at once; the browser layer also does it on the first click, key press or touch.
     * Does nothing on a running context.
     */
    readonly resume: Effect.Effect<void>
  }
  // Stryker disable next-line StringLiteral: the service key is only an identifier.
>()("fx-audio/Audio") {}

/** A media element and the graph node made from it, which cannot be made twice. */
interface StreamSlot {
  readonly element: MediaElementLike
  readonly source: AudioNodeLike
}

/** How many finished stream elements are kept for reuse. */
const maxIdleStreams = 4

/** The service, still needing an `AudioContextService` for the platform. */
export const AudioLive: Layer.Layer<Audio, never, AudioContextService> = Layer.effect(
  Audio,
  Effect.gen(function* () {
    const { ctx, createMediaElement, readFile } = yield* AudioContextService

    // Stryker disable next-line StringLiteral: the span name is only a label.
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

    const networkFailure = (url: string) => (cause: unknown) =>
      new LoadError({ source: url, reason: new NetworkFailure({ cause }) })

    const fetchBytes = Effect.fnUntraced(function* (url: string) {
      const response = yield* Effect.tryPromise({
        try: (signal) => fetch(url, { signal }),
        catch: networkFailure(url)
      })
      if (!response.ok) {
        return yield* new LoadError({
          source: url,
          reason: new NetworkFailure({ status: response.status })
        })
      }
      return yield* Effect.tryPromise({
        try: () => response.arrayBuffer(),
        catch: networkFailure(url)
      })
    })

    // Stryker disable next-line StringLiteral: the span name is only a label.
    const load = Effect.fn("Audio.load")(function* (source: string) {
      const bytes =
        readFile !== undefined && isLocalFile(source)
          ? yield* Effect.tryPromise({
              try: (signal) => readFile(source, signal),
              catch: networkFailure(source)
            })
          : yield* fetchBytes(source)
      return yield* decode(bytes, source)
    })

    const createStereo = (pan: number) => {
      const panner = ctx.createStereoPanner()
      panner.pan.value = pan
      return panner
    }

    const createSpatial = (spatial: SpatialOptions) => {
      const panner = ctx.createPanner()
      setVector([panner.positionX, panner.positionY, panner.positionZ], spatial.position)
      if (spatial.orientation !== undefined) {
        setVector(
          [panner.orientationX, panner.orientationY, panner.orientationZ],
          spatial.orientation
        )
      }
      if (spatial.panningModel !== undefined) panner.panningModel = spatial.panningModel
      if (spatial.distanceModel !== undefined) panner.distanceModel = spatial.distanceModel
      if (spatial.refDistance !== undefined) panner.refDistance = spatial.refDistance
      if (spatial.maxDistance !== undefined) panner.maxDistance = spatial.maxDistance
      if (spatial.rolloffFactor !== undefined) panner.rolloffFactor = spatial.rolloffFactor
      if (spatial.coneInnerAngle !== undefined) panner.coneInnerAngle = spatial.coneInnerAngle
      if (spatial.coneOuterAngle !== undefined) panner.coneOuterAngle = spatial.coneOuterAngle
      if (spatial.coneOuterGain !== undefined) panner.coneOuterGain = spatial.coneOuterGain
      return panner
    }

    /**
     * What every voice has after its source: [stereo] -> [spatial] -> gain -> output,
     * and the controls that act on those nodes. The source node comes later, from `setInput`,
     * and may be replaced as many times as the voice is paused or sought.
     */
    const buildChain = (options: PlayOptions, output: AudioNodeLike) => {
      const gain = ctx.createGain()
      // The optional stages between the source and the gain, in signal order.
      const route: { stereo?: StereoPannerNodeLike; spatial?: PannerNodeLike } = {}
      let input: AudioNodeLike | undefined
      // stage -> stage -> gain: a stage is only built for voices that ask for one.
      const link = () => {
        let from: AudioNodeLike | undefined
        for (const stage of [route.stereo, route.spatial]) {
          if (stage === undefined) continue
          from?.connect(stage)
          from = stage
        }
        from?.connect(gain)
      }
      const feed = () => input?.connect(route.stereo ?? route.spatial ?? gain)
      // Adding a stage means breaking the links of the nodes already chained, then chaining again.
      const rewire = () => {
        input?.disconnect()
        route.stereo?.disconnect()
        route.spatial?.disconnect()
        link()
        feed()
      }
      gain.gain.value = options.volume ?? 1
      if (options.pan !== undefined) route.stereo = createStereo(options.pan)
      if (options.spatial !== undefined) route.spatial = createSpatial(options.spatial)
      link()
      gain.connect(output)
      const controls: Pick<Voice, "fadeTo" | "setVolume" | "setPan" | "setPosition"> = {
        fadeTo: (volume, over) =>
          Effect.sync(() => {
            const now = ctx.currentTime
            gain.gain.setValueAtTime(gain.gain.value, now)
            gain.gain.linearRampToValueAtTime(volume, now + Duration.toSeconds(over))
          }),
        setVolume: (requested) =>
          Effect.sync(() => {
            const volume = decodeVolume(requested)
            const now = ctx.currentTime
            gain.gain.cancelScheduledValues(now)
            gain.gain.setValueAtTime(volume, now)
          }),
        setPan: (requested) =>
          Effect.sync(() => {
            const pan = decodePan(requested)
            if (route.stereo === undefined) {
              route.stereo = createStereo(pan)
              rewire()
            } else {
              route.stereo.pan.value = pan
            }
          }),
        setPosition: (requested) =>
          Effect.sync(() => {
            const position = decodeVector(requested)
            if (route.spatial === undefined) {
              route.spatial = createSpatial(new SpatialOptions({ position }))
              rewire()
            } else {
              const { positionX, positionY, positionZ } = route.spatial
              setVector([positionX, positionY, positionZ], position)
            }
          })
      }
      const setInput = (next: AudioNodeLike) => {
        input = next
        feed()
      }
      const release = () => {
        route.stereo?.disconnect()
        route.spatial?.disconnect()
        gain.disconnect()
      }
      return { controls, setInput, release }
    }

    type Chain = ReturnType<typeof buildChain>

    /**
     * A buffer source plays once and cannot be paused or moved, so pausing drops it and
     * resuming or seeking starts a new one at the wanted point, all on the same chain.
     * The position is worked out from the audio clock: where the voice was started from,
     * when, and how fast it has run since.
     */
    const bufferPlayer = (
      sound: Sound,
      options: PlayOptions,
      segment: SpriteSegment | undefined,
      chain: Chain,
      finish: () => void
    ): Player => {
      // The Web Audio API counts in seconds, sprite segments in milliseconds.
      const base = segment === undefined ? 0 : segment.start / 1000
      const length = segment === undefined ? sound.buffer.duration : segment.duration / 1000
      let loop = options.loop ?? segment?.loop ?? false
      let rate = options.rate ?? 1
      let paused = false
      // Where in the sound, and when on the audio clock, the current source started.
      let offset = 0
      let anchor = 0
      let current: SourceNodeLike | undefined

      const position = () => {
        if (paused) return offset
        const reached = offset + (ctx.currentTime - anchor) * rate
        return loop ? reached % length : Math.min(reached, length)
      }
      const detach = () => {
        if (current === undefined) return
        const source = current
        current = undefined
        source.onended = null
        try {
          source.stop()
        } catch {
          // already stopped
        }
        source.disconnect()
      }
      const launch = (from: number) => {
        const source = ctx.createBufferSource()
        source.buffer = sound.buffer
        source.loop = loop
        source.playbackRate.value = rate
        chain.setInput(source)
        source.onended = () => {
          // It has run out: nothing is left to stop.
          current = undefined
          finish()
        }
        offset = from
        anchor = ctx.currentTime
        current = source
        if (segment === undefined) {
          if (from === 0) source.start()
          else source.start(0, from)
        } else if (loop) {
          // A looping source plays until stopped, so the segment bounds the loop instead.
          source.loopStart = base
          source.loopEnd = base + length
          source.start(0, base + from)
        } else {
          source.start(0, base + from, length - from)
        }
      }
      launch(0)
      return {
        pause: () => {
          offset = position()
          paused = true
          detach()
        },
        resume: Effect.sync(() => {
          paused = false
          launch(offset)
        }),
        seek: (seconds) => {
          if (!loop && seconds >= length) {
            detach()
            finish()
            return
          }
          const at = loop ? seconds % length : seconds
          if (paused) {
            offset = at
          } else {
            detach()
            launch(at)
          }
        },
        position,
        paused: () => paused,
        setRate: (next) => {
          // Count the time run at the old rate before the new one takes over.
          if (!paused) {
            offset = position()
            anchor = ctx.currentTime
          }
          rate = next
          if (current !== undefined) current.playbackRate.value = next
        },
        setLoop: (next) => {
          if (next === loop) return
          const at = position()
          loop = next
          if (paused) return
          detach()
          launch(at)
        },
        stop: detach
      }
    }

    const makeVoice = (
      ended: Deferred.Deferred<void>,
      bus: VoiceBus,
      chain: Chain,
      player: Player
    ): Voice => {
      const alive = () => !Deferred.isDoneUnsafe(ended)
      const stop = () => {
        player.stop()
        bus.finish(new Stopped())
      }
      bus.register(stop)
      // Once a voice has ended nothing is left to pause, move or restart.
      const whileAlive = (act: () => void) =>
        Effect.sync(() => {
          if (alive()) act()
        })
      return {
        ended: Deferred.await(ended),
        events: bus.events,
        stop: Effect.sync(stop),
        pause: whileAlive(() => {
          if (player.paused()) return
          player.pause()
          bus.emit(new Paused())
        }),
        resume: Effect.suspend(() => {
          if (!alive() || !player.paused()) return Effect.void
          return player.resume.pipe(Effect.andThen(Effect.sync(() => bus.emit(new Resumed()))))
        }),
        seek: (milliseconds) => {
          const seconds = decodePosition(milliseconds) / 1000
          return whileAlive(() => {
            player.seek(seconds)
            // A seek past the end of a voice that does not loop ends it instead.
            if (alive()) bus.emit(new Seeked({ position: player.position() * 1000 }))
          })
        },
        position: Effect.sync(() => player.position() * 1000),
        paused: Effect.sync(player.paused),
        setRate: (requested) => {
          const rate = decodeRate(requested)
          return whileAlive(() => {
            player.setRate(rate)
            bus.emit(new RateChanged({ rate }))
          })
        },
        setLoop: (loop) =>
          whileAlive(() => {
            player.setLoop(loop)
            bus.emit(new LoopChanged({ loop }))
          }),
        ...chain.controls,
        setVolume: (volume) =>
          chain.controls
            .setVolume(volume)
            .pipe(Effect.andThen(Effect.sync(() => bus.emit(new VolumeChanged({ volume })))))
      }
    }

    const startVoice = Effect.fnUntraced(function* (
      sound: Sound,
      options: PlayOptions,
      segment: SpriteSegment | undefined,
      output: AudioNodeLike,
      track: Tracker
    ): Effect.fn.Return<Voice, never, Scope.Scope> {
      const ended = yield* Deferred.make<void>()
      const bus = voiceBus(ended, track)
      const {
        resource: { player, chain },
        close
      } = yield* releasable(
        () => {
          const chain = buildChain(options, output)
          const player = bufferPlayer(sound, options, segment, chain, () => bus.finish(new Ended()))
          return { player, chain }
        },
        ({ player, chain }) => {
          player.stop()
          chain.release()
          bus.finish(new Stopped())
        }
      )
      bus.releaseOnEnd(close)
      return makeVoice(ended, bus, chain, player)
    })

    /** The browser's own mapping of `MediaError.code`; a missing or aborted error counts as the network. */
    const streamFailure = (url: string, element: MediaElementLike) => {
      const cause = element.error
      const reason =
        cause?.code === 3
          ? new DecodeFailure({ cause })
          : cause?.code === 4
            ? new UnsupportedFormat({ cause })
            : new NetworkFailure({ cause })
      return new LoadError({ source: url, reason })
    }

    /**
     * Stream elements that finished and wait for the next stream. A browser only lets an element
     * play after a user gesture and an element is routed into the graph once for good, so reusing
     * one lets a stream that starts later (the next track, from a timer) play where a new element
     * would be refused, and spares a media element per stream.
     */
    const idleStreams: Array<StreamSlot> = []

    const startStream = Effect.fnUntraced(function* (
      url: string,
      options: PlayOptions,
      output: AudioNodeLike,
      track: Tracker
    ): Effect.fn.Return<Voice, LoadError | PlaybackBlocked, Scope.Scope> {
      if (createMediaElement === undefined) {
        return yield* new LoadError({ source: url, reason: new StreamingUnavailable() })
      }
      const ended = yield* Deferred.make<void>()
      const bus = voiceBus(ended, track)
      const onEnded = () => bus.finish(new Ended())
      const newSlot = (): StreamSlot => {
        const element = createMediaElement()
        // Without CORS the browser silences a cross-origin element routed into the audio graph.
        element.crossOrigin = "anonymous"
        element.preload = "auto"
        return { element, source: ctx.createMediaElementSource(element) }
      }
      // Released as soon as the voice ends, fails or is interrupted, not only when the scope closes.
      const {
        resource: { element, chain },
        close
      } = yield* releasable(
        () => {
          const { element, source } = idleStreams.pop() ?? newSlot()
          element.loop = options.loop ?? false
          element.playbackRate = options.rate ?? 1
          const chain = buildChain(options, output)
          chain.setInput(source)
          element.addEventListener("ended", onEnded)
          return { element, source, chain }
        },
        ({ element, source, chain }) => {
          element.removeEventListener("ended", onEnded)
          element.pause()
          // Dropping the source and reloading is how a media element lets go of its connection.
          element.removeAttribute("src")
          element.load()
          source.disconnect()
          chain.release()
          // A failed element is dropped; a sound one waits for the next stream.
          if (element.error === null && idleStreams.length < maxIdleStreams) {
            idleStreams.push({ element, source })
          }
          bus.finish(new Stopped())
        }
      )
      bus.releaseOnEnd(close)
      yield* Effect.callback<void, LoadError>((resume) => {
        const cleanup = () => {
          element.removeEventListener("canplay", onReady)
          element.removeEventListener("error", onError)
        }
        const onReady = () => {
          cleanup()
          resume(Effect.void)
        }
        const onError = () => {
          cleanup()
          resume(Effect.fail(streamFailure(url, element)))
        }
        element.addEventListener("canplay", onReady)
        element.addEventListener("error", onError)
        element.src = url
        return Effect.sync(cleanup)
      }).pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: () => element.play(),
            catch: (cause) => new PlaybackBlocked({ source: url, cause })
          })
        ),
        Effect.onError(() => Effect.sync(close))
      )
      let paused = false
      const player: Player = {
        pause: () => {
          element.pause()
          paused = true
        },
        resume: Effect.tryPromise({
          try: () => element.play(),
          catch: (cause) => new PlaybackBlocked({ source: url, cause })
        }).pipe(
          Effect.andThen(
            Effect.sync(() => {
              paused = false
            })
          )
        ),
        seek: (seconds) => {
          element.currentTime = seconds
        },
        position: () => element.currentTime,
        paused: () => paused,
        setRate: (rate) => {
          element.playbackRate = rate
        },
        setLoop: (loop) => {
          element.loop = loop
        },
        // The end of the voice releases the element, which pauses it.
        stop: () => undefined
      }
      return makeVoice(ended, bus, chain, player)
    })

    const spriteOn = (output: AudioNodeLike, track: Tracker) =>
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
        return yield* startVoice(sheet.sound, options, segment, output, track)
      })

    const buildGroup = Effect.fnUntraced(function* (
      output: AudioNodeLike,
      parent?: Tracker
    ): Effect.fn.Return<
      { readonly group: Group; readonly node: AudioNodeLike; readonly track: Tracker },
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

      // The voices playing through this group, which also count for the group it feeds.
      const playing = new Set<() => void>()
      const track: Tracker = (stop) => {
        playing.add(stop)
        const untrackParent = parent?.(stop)
        return () => {
          playing.delete(stop)
          untrackParent?.()
        }
      }
      // Stopping a voice removes it from the set, so walk a copy.
      const stopAll = Effect.sync(() => {
        for (const stop of Array.from(playing)) stop()
      })

      const group: Group = {
        play: (sound, options = {}) => startVoice(sound, options, undefined, node, track),
        playSprite: spriteOn(node, track),
        stream: (url, options = {}) => startStream(url, options, node, track),
        stopAll,
        setVolume,
        fadeTo,
        mute,
        unmute
      }
      return { group, node, track }
    })

    const {
      group: master,
      node: masterNode,
      track: trackMaster
    } = yield* buildGroup(ctx.destination)

    // Groups live as long as the layer, whichever scope first asks for them.
    const layerScope = yield* Effect.scope
    const groups = new Map<string, Group>()
    const creating = yield* Semaphore.make(1)
    // Stryker disable next-line StringLiteral: the span name is only a label.
    const group = Effect.fn("Audio.group")(function* (name: string) {
      return yield* Effect.gen(function* () {
        const existing = groups.get(name)
        if (existing !== undefined) return existing
        const { group } = yield* buildGroup(masterNode, trackMaster).pipe(
          Effect.provideService(Scope.Scope, layerScope)
        )
        groups.set(name, group)
        return group
      }).pipe(Semaphore.withPermit(creating))
    })

    const { listener } = ctx
    const unsupported = () => {
      throw new Error("this audio context cannot move its listener")
    }
    const listenerService: Listener = {
      setPosition: (requested) =>
        Effect.sync(() => {
          const position = decodeVector(requested)
          const { positionX, positionY, positionZ } = listener
          if (positionX !== undefined && positionY !== undefined && positionZ !== undefined) {
            setVector([positionX, positionY, positionZ], position)
          } else if (listener.setPosition !== undefined) {
            listener.setPosition(position.x, position.y, position.z)
          } else {
            unsupported()
          }
        }),
      setOrientation: (forward, up) =>
        Effect.sync(() => {
          const facing = decodeVector(forward)
          const top = decodeVector(up)
          const { forwardX, forwardY, forwardZ, upX, upY, upZ } = listener
          if (
            forwardX !== undefined &&
            forwardY !== undefined &&
            forwardZ !== undefined &&
            upX !== undefined &&
            upY !== undefined &&
            upZ !== undefined
          ) {
            setVector([forwardX, forwardY, forwardZ], facing)
            setVector([upX, upY, upZ], top)
          } else if (listener.setOrientation !== undefined) {
            listener.setOrientation(facing.x, facing.y, facing.z, top.x, top.y, top.z)
          } else {
            unsupported()
          }
        })
    }

    return Audio.of({
      decode,
      load,
      play: master.play,
      playSprite: master.playSprite,
      stream: master.stream,
      stopAll: master.stopAll,
      master,
      group,
      listener: listenerService,
      resume: Effect.promise(() => ctx.resume())
    })
  })
)

/** The service on the browser audio context. Compose `AudioLive` with another platform layer elsewhere. */
export const AudioBrowserLive: Layer.Layer<Audio> = AudioLive.pipe(
  Layer.provide(BrowserAudioContextLive)
)
