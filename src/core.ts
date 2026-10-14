import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import type {
  AudioNodeLike,
  AudioParamLike,
  MediaElementLike,
  PannerNodeLike,
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
  Pan,
  type PlayOptions,
  Sound,
  SpatialOptions,
  type SpriteSegment,
  type SpriteSheet,
  Vector3,
  Volume
} from "./model.ts"

export interface Voice {
  /** Completes when playback ends naturally, the voice is stopped or its scope closes. */
  readonly ended: Effect.Effect<void>
  readonly stop: Effect.Effect<void>
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
const decodeVector = Schema.decodeUnknownSync(Vector3)

const setVector = (
  params: readonly [AudioParamLike, AudioParamLike, AudioParamLike],
  { x, y, z }: Vector3
) => {
  params[0].value = x
  params[1].value = y
  params[2].value = z
}

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
     * and the controls that act on those nodes. The source node is the caller's.
     */
    const buildChain = (input: AudioNodeLike, options: PlayOptions, output: AudioNodeLike) => {
      const gain = ctx.createGain()
      // The optional stages between the source and the gain, in signal order.
      const route: { stereo?: StereoPannerNodeLike; spatial?: PannerNodeLike } = {}
      // source -> [stereo] -> [spatial] -> gain: a stage is only built for voices that ask for one.
      const wire = () => {
        let from: AudioNodeLike = input
        for (const stage of [route.stereo, route.spatial]) {
          if (stage === undefined) continue
          from.connect(stage)
          from = stage
        }
        from.connect(gain)
      }
      // Adding a stage means breaking the links of the nodes already chained, then chaining again.
      const rewire = () => {
        input.disconnect()
        route.stereo?.disconnect()
        route.spatial?.disconnect()
        wire()
      }
      gain.gain.value = options.volume ?? 1
      if (options.pan !== undefined) route.stereo = createStereo(options.pan)
      if (options.spatial !== undefined) route.spatial = createSpatial(options.spatial)
      wire()
      gain.connect(output)
      const controls: Pick<Voice, "fadeTo" | "setPan" | "setPosition"> = {
        fadeTo: (volume, over) =>
          Effect.sync(() => {
            const now = ctx.currentTime
            gain.gain.setValueAtTime(gain.gain.value, now)
            gain.gain.linearRampToValueAtTime(volume, now + Duration.toSeconds(over))
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
      const release = () => {
        route.stereo?.disconnect()
        route.spatial?.disconnect()
        gain.disconnect()
      }
      return { controls, release }
    }

    const startVoice = Effect.fnUntraced(function* (
      sound: Sound,
      options: PlayOptions,
      segment: SpriteSegment | undefined,
      output: AudioNodeLike
    ): Effect.fn.Return<Voice, never, Scope.Scope> {
      const ended = yield* Deferred.make<void>()
      const { source, chain } = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const source = ctx.createBufferSource()
          source.buffer = sound.buffer
          source.loop = options.loop ?? segment?.loop ?? false
          if (options.rate !== undefined) source.playbackRate.value = options.rate
          const chain = buildChain(source, options, output)
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
          return { source, chain }
        }),
        ({ source, chain }) =>
          Effect.suspend(() => {
            source.onended = null
            try {
              source.stop()
            } catch {
              // already stopped
            }
            source.disconnect()
            chain.release()
            return Deferred.succeed(ended, undefined)
          })
      )
      return {
        ended: Deferred.await(ended),
        stop: Effect.sync(() => {
          source.stop()
        }),
        ...chain.controls
      }
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

    const startStream = Effect.fnUntraced(function* (
      url: string,
      options: PlayOptions,
      output: AudioNodeLike
    ): Effect.fn.Return<Voice, LoadError | PlaybackBlocked, Scope.Scope> {
      if (createMediaElement === undefined) {
        return yield* new LoadError({ source: url, reason: new StreamingUnavailable() })
      }
      const ended = yield* Deferred.make<void>()
      const onEnded = () => Deferred.doneUnsafe(ended, Effect.void)
      // Released as soon as the stream fails or is interrupted, not only when the scope closes.
      let released = false
      const release = (
        element: MediaElementLike,
        source: AudioNodeLike,
        chain: { release(): void }
      ) =>
        Effect.suspend(() => {
          if (released) return Effect.void
          released = true
          element.removeEventListener("ended", onEnded)
          element.pause()
          // Dropping the source and reloading is how a media element lets go of its connection.
          element.removeAttribute("src")
          element.load()
          source.disconnect()
          chain.release()
          return Deferred.succeed(ended, undefined)
        })
      const { element, source, chain } = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = createMediaElement()
          // Without CORS the browser silences a cross-origin element routed into the audio graph.
          element.crossOrigin = "anonymous"
          element.preload = "auto"
          element.loop = options.loop ?? false
          if (options.rate !== undefined) element.playbackRate = options.rate
          const source = ctx.createMediaElementSource(element)
          const chain = buildChain(source, options, output)
          element.addEventListener("ended", onEnded)
          return { element, source, chain }
        }),
        ({ element, source, chain }) => release(element, source, chain)
      )
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
        Effect.onError(() => release(element, source, chain))
      )
      return {
        ended: Deferred.await(ended),
        stop: Effect.suspend(() => {
          element.pause()
          return Deferred.succeed(ended, undefined)
        }).pipe(Effect.asVoid),
        ...chain.controls
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
        stream: (url, options = {}) => startStream(url, options, node),
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
    // Stryker disable next-line StringLiteral: the span name is only a label.
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
