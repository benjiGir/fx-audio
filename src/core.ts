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
  GainNodeLike,
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
  type AudioEffect,
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

/**
 * What a voice or a group sounds like right now, read from the signal as it passes. Reading costs
 * nothing until you do it: poll it from `requestAnimationFrame` for a level meter or a visualiser.
 */
export interface Analyser {
  /** How loud it is: the RMS of the last `fftSize` (2048) samples, from 0 (silence) to 1 (full scale). */
  readonly level: Effect.Effect<number>
  /** The highest absolute sample of the same window, from 0 to 1. */
  readonly peak: Effect.Effect<number>
  /** The sound by frequency: 1024 values from 0 to 255, from 0 Hz up to half the sample rate. */
  readonly spectrum: Effect.Effect<Uint8Array>
  /** The signal itself over the same window as `level`, each sample from -1 to 1. */
  readonly waveform: Effect.Effect<Float32Array>
}

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
  /**
   * Reads this voice's level and spectrum, as it leaves the voice, after volume, pan and position. Built on
   * the first call and the same object afterwards; it is released with the voice.
   */
  readonly analyser: Effect.Effect<Analyser>
  /** Linear fade of this voice's gain, scheduled on the audio thread. */
  readonly fadeTo: (volume: number, over: Duration.Input) => Effect.Effect<void>
  /**
   * Fade the voice to silence, then stop it. Completes once the voice has stopped, which is at the
   * end of the fade, or sooner if the voice ends by itself or is stopped meanwhile.
   */
  readonly fadeOut: (over: Duration.Input) => Effect.Effect<void>
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
   * Hand over from `out` to `sound`: the new voice starts silent and fades up to `options.volume`
   * (1 by default) while `out` fades down and stops, both over `over`. Resolves with the new voice
   * as soon as it has started; the old one goes on fading in the background, and is stopped at once if
   * the scope closes before the fade is over.
   */
  readonly crossfade: (
    out: Voice,
    sound: Sound,
    over: Duration.Input,
    options?: PlayOptions
  ) => Effect.Effect<Voice, never, Scope.Scope>
  /**
   * Stop every voice playing through this group, Howler's `Howler.stop()` for the master. A voice
   * started afterwards plays normally, and a stream still waiting to start is not reached.
   */
  readonly stopAll: Effect.Effect<void>
  /**
   * Reads the level and spectrum of everything this group plays (of everything, for the master),
   * after the group's own volume. Built on the first call and the same object afterwards.
   */
  readonly analyser: Effect.Effect<Analyser>
  /**
   * Put these effects on everything this group plays, in order, after the group's own volume,
   * replacing the ones set before: `[]` takes them all off. Voices already playing are affected
   * too. The tail of an echo or a reverb that is sounding is cut by the swap.
   */
  readonly setEffects: (effects: ReadonlyArray<AudioEffect>) => Effect.Effect<void>
  /** How many voices are playing through this group right now, paused ones included. */
  readonly voiceCount: Effect.Effect<number>
  /**
   * Cap the voices playing through this group: a voice that starts over the cap stops the oldest one,
   * so a burst of sounds (gunfire, footsteps) cannot pile up. `undefined` removes the cap. Lowering it
   * stops the oldest voices at once. Dies on anything but a whole number of one or more.
   */
  readonly setMaxVoices: (limit: number | undefined) => Effect.Effect<void>
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
const decodeMaxVoices = Schema.decodeUnknownSync(
  Schema.UndefinedOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)))
)
const decodeVector = Schema.decodeUnknownSync(Vector3)

const setVector = (
  params: readonly [AudioParamLike, AudioParamLike, AudioParamLike],
  { x, y, z }: Vector3
) => {
  params[0].value = x
  params[1].value = y
  params[2].value = z
}

/** The nodes of one effect: where the sound goes in, where it comes out, and everything to let go of. */
interface EffectNodes {
  readonly input: AudioNodeLike
  readonly output: AudioNodeLike
  readonly nodes: ReadonlyArray<AudioNodeLike>
}

/** A random factor between `1 - amount` and `1 + amount`. */
const spread = (amount: number) => 1 + (Math.random() * 2 - 1) * amount

/** The options with the speed and the volume of this play picked at random, when it asks for variation. */
const varied = (options: PlayOptions): PlayOptions => {
  const { rateVariation, volumeVariation } = options
  if (rateVariation === undefined && volumeVariation === undefined) return options
  return {
    ...options,
    ...(rateVariation === undefined ? {} : { rate: (options.rate ?? 1) * spread(rateVariation) }),
    ...(volumeVariation === undefined
      ? {}
      : { volume: (options.volume ?? 1) * spread(volumeVariation) })
  }
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
    /** Hand over from a playing voice to a new sound on the master group, see `Group.crossfade`. */
    crossfade(
      out: Voice,
      sound: Sound,
      over: Duration.Input,
      options?: PlayOptions
    ): Effect.Effect<Voice, never, Scope.Scope>
    /** How many voices are playing, in every group. See `Group.voiceCount`. */
    readonly voiceCount: Effect.Effect<number>
    /**
     * The state of the audio context: `running`, `suspended` (before the first user gesture, or after
     * the browser paused it), `interrupted` (on iOS, by a call) or `closed`. A sound that stays silent
     * on a context that is not `running` is waiting for it.
     */
    readonly state: Effect.Effect<string>
    /** Stop every voice playing, in every group: Howler's `Howler.stop()`. See `Group.stopAll`. */
    readonly stopAll: Effect.Effect<void>
    /** Reads the level and spectrum of everything that plays, see `Group.analyser`. */
    readonly analyser: Effect.Effect<Analyser>
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
    /**
     * The audio clock, in milliseconds. It runs only while the context does, and is the time
     * `PlayOptions.startAt` is counted on: `now + 500` is half a second from now.
     */
    readonly now: Effect.Effect<number>
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

    /** An analyser that listens to `tap` without being part of the way to the output. */
    const makeAnalyser = (tap: AudioNodeLike): Analyser => {
      const node = ctx.createAnalyser()
      tap.connect(node)
      const waveform = Effect.sync(() => {
        const samples = new Float32Array(node.fftSize)
        node.getFloatTimeDomainData(samples)
        return samples
      })
      return {
        level: waveform.pipe(
          Effect.map((samples) => {
            let sum = 0
            for (const sample of samples) sum += sample * sample
            return Math.sqrt(sum / samples.length)
          })
        ),
        peak: waveform.pipe(
          Effect.map((samples) => {
            let peak = 0
            for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
            return peak
          })
        ),
        spectrum: Effect.sync(() => {
          const bins = new Uint8Array(node.frequencyBinCount)
          node.getByteFrequencyData(bins)
          return bins
        }),
        waveform
      }
    }

    /** Noise that dies away over `seconds`: what a reverb convolves the sound with. */
    const impulseResponse = (seconds: number, decay: number) => {
      const length = Math.max(1, Math.round(seconds * ctx.sampleRate))
      const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel)
        for (let i = 0; i < length; i++)
          data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay
      }
      return buffer
    }

    /** The sound goes through `process` (which ends in `wet`) and past it, the two added at `mix`. */
    const mixed = (mix: number, process: (input: GainNodeLike, wet: GainNodeLike) => void) => {
      const input = ctx.createGain()
      const dry = ctx.createGain()
      const wet = ctx.createGain()
      const output = ctx.createGain()
      dry.gain.value = 1 - mix
      wet.gain.value = mix
      input.connect(dry)
      dry.connect(output)
      process(input, wet)
      wet.connect(output)
      return { input, output, nodes: [input, dry, wet, output] }
    }

    const buildEffect = (effect: AudioEffect): EffectNodes => {
      switch (effect._tag) {
        case "filter": {
          const node = ctx.createBiquadFilter()
          node.type = effect.type
          node.frequency.value = effect.frequency
          node.Q.value = effect.q ?? 1
          node.gain.value = effect.gain ?? 0
          return { input: node, output: node, nodes: [node] }
        }
        case "compressor": {
          const node = ctx.createDynamicsCompressor()
          // Whatever is left out keeps the Web Audio default.
          if (effect.threshold !== undefined) node.threshold.value = effect.threshold
          if (effect.knee !== undefined) node.knee.value = effect.knee
          if (effect.ratio !== undefined) node.ratio.value = effect.ratio
          if (effect.attack !== undefined) node.attack.value = effect.attack
          if (effect.release !== undefined) node.release.value = effect.release
          return { input: node, output: node, nodes: [node] }
        }
        case "echo": {
          const delay = ctx.createDelay(5)
          const feedback = ctx.createGain()
          delay.delayTime.value = effect.time / 1000
          feedback.gain.value = effect.feedback ?? 0.4
          const { input, output, nodes } = mixed(effect.mix ?? 0.5, (input, wet) => {
            input.connect(delay)
            delay.connect(wet)
          })
          delay.connect(feedback)
          feedback.connect(delay)
          return { input, output, nodes: [...nodes, delay, feedback] }
        }
        case "reverb": {
          const convolver = ctx.createConvolver()
          convolver.buffer = impulseResponse(effect.seconds ?? 2, effect.decay ?? 2)
          const { input, output, nodes } = mixed(effect.mix ?? 0.3, (input, wet) => {
            input.connect(convolver)
            convolver.connect(wet)
          })
          return { input, output, nodes: [...nodes, convolver] }
        }
      }
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
      let analyser: Analyser | undefined
      const controls: Pick<Voice, "analyser" | "fadeTo" | "setVolume" | "setPan" | "setPosition"> =
        {
          analyser: Effect.sync(() => (analyser ??= makeAnalyser(gain))),
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

    /** The time on the audio clock, in seconds, a voice with these options starts at. */
    const startOf = (options: PlayOptions) =>
      options.startAt === undefined
        ? ctx.currentTime + (options.delay ?? 0) / 1000
        : options.startAt / 1000

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
      // Where in the sound, and when on the audio clock, the current source started. The time
      // is ahead of the clock for a voice that waits to start.
      let offset = 0
      let anchor = 0
      let current: SourceNodeLike | undefined

      const position = () => {
        if (paused) return offset
        const reached = offset + Math.max(0, ctx.currentTime - anchor) * rate
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
      // The time a source launched now starts: the one still ahead for a voice that waits.
      const startTime = () => Math.max(anchor, ctx.currentTime)
      const launch = (from: number, when = ctx.currentTime) => {
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
        anchor = when
        current = source
        // Zero is "now" to Web Audio, as is any time already past.
        const at = when > ctx.currentTime ? when : 0
        if (segment === undefined) {
          if (from === 0 && at === 0) source.start()
          else source.start(at, from)
        } else if (loop) {
          // A looping source plays until stopped, so the segment bounds the loop instead.
          source.loopStart = base
          source.loopEnd = base + length
          source.start(at, base + from)
        } else {
          source.start(at, base + from, length - from)
        }
      }
      launch(0, startOf(options))
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
            const when = startTime()
            detach()
            launch(at, when)
          }
        },
        position,
        paused: () => paused,
        setRate: (next) => {
          // Count the time run at the old rate before the new one takes over.
          if (!paused && ctx.currentTime >= anchor) {
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
          const when = startTime()
          detach()
          launch(at, when)
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
        fadeOut: (over) =>
          Effect.suspend(() =>
            alive()
              ? chain.controls
                  .fadeTo(0, over)
                  .pipe(
                    Effect.andThen(Effect.raceFirst(Effect.sleep(over), Deferred.await(ended))),
                    Effect.andThen(whileAlive(stop))
                  )
              : Effect.void
          ),
        setVolume: (volume) =>
          chain.controls
            .setVolume(volume)
            .pipe(Effect.andThen(Effect.sync(() => bus.emit(new VolumeChanged({ volume })))))
      }
    }

    const startVoice = Effect.fnUntraced(function* (
      sound: Sound,
      requested: PlayOptions,
      segment: SpriteSegment | undefined,
      output: AudioNodeLike,
      track: Tracker
    ): Effect.fn.Return<Voice, never, Scope.Scope> {
      const options = varied(requested)
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
      requested: PlayOptions,
      output: AudioNodeLike,
      track: Tracker
    ): Effect.fn.Return<Voice, LoadError | PlaybackBlocked, Scope.Scope> {
      if (createMediaElement === undefined) {
        return yield* new LoadError({ source: url, reason: new StreamingUnavailable() })
      }
      const options = varied(requested)
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
      let maxVoices = Number.POSITIVE_INFINITY
      // A set walks in the order it was filled, so the oldest voice comes first.
      const trim = () => {
        for (const oldest of Array.from(playing)) {
          if (playing.size <= maxVoices) return
          oldest()
        }
      }
      const track: Tracker = (stop) => {
        playing.add(stop)
        const untrackParent = parent?.(stop)
        if (playing.size > maxVoices) trim()
        return () => {
          playing.delete(stop)
          untrackParent?.()
        }
      }
      // Stopping a voice removes it from the set, so walk a copy.
      const stopAll = Effect.sync(() => {
        for (const stop of Array.from(playing)) stop()
      })

      let analyser: Analyser | undefined
      // The effects between the group's gain and its output, in signal order.
      let effects: ReadonlyArray<EffectNodes> = []
      const setEffects: Group["setEffects"] = (requested) =>
        Effect.sync(() => {
          const [first] = effects
          if (first === undefined) node.disconnect(output)
          else node.disconnect(first.input)
          for (const { nodes } of effects) for (const stage of nodes) stage.disconnect()
          effects = requested.map(buildEffect)
          let from: AudioNodeLike = node
          for (const stage of effects) {
            from.connect(stage.input)
            from = stage.output
          }
          from.connect(output)
        })

      const play: Group["play"] = (sound, options = {}) =>
        startVoice(sound, options, undefined, node, track)

      const group: Group = {
        analyser: Effect.sync(() => (analyser ??= makeAnalyser(node))),
        setEffects,
        play,
        playSprite: spriteOn(node, track),
        stream: (url, options = {}) => startStream(url, options, node, track),
        crossfade: Effect.fnUntraced(function* (out, sound, over, options = {}) {
          const next = yield* play(sound, { ...options, volume: 0 })
          yield* next.fadeTo(options.volume ?? 1, over)
          // A scope that closes mid-fade ends the hand-over: the old voice stops where it is.
          const fading = out.fadeOut(over).pipe(Effect.onInterrupt(() => out.stop))
          yield* Effect.forkIn(fading, yield* Scope.Scope)
          return next
        }),
        stopAll,
        voiceCount: Effect.sync(() => playing.size),
        setMaxVoices: (limit) =>
          Effect.sync(() => {
            maxVoices = decodeMaxVoices(limit) ?? Number.POSITIVE_INFINITY
            trim()
          }),
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
      crossfade: master.crossfade,
      stopAll: master.stopAll,
      analyser: master.analyser,
      voiceCount: master.voiceCount,
      state: Effect.sync(() => ctx.state),
      master,
      group,
      listener: listenerService,
      resume: Effect.promise(() => ctx.resume()),
      now: Effect.sync(() => ctx.currentTime * 1000)
    })
  })
)

/** The service on the browser audio context. Compose `AudioLive` with another platform layer elsewhere. */
export const AudioBrowserLive: Layer.Layer<Audio> = AudioLive.pipe(
  Layer.provide(BrowserAudioContextLive)
)
