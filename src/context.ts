import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

/**
 * Smallest surface of the Web Audio API the core needs. Browser, Node
 * (`node-web-audio-api`) and test doubles all satisfy it structurally.
 */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown
  disconnect(): void
}

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  cancelScheduledValues(time: number): unknown
}

export interface SourceNodeLike extends AudioNodeLike {
  buffer: AudioBuffer | null
  playbackRate: AudioParamLike
  loop: boolean
  loopStart: number
  loopEnd: number
  onended: ((event: unknown) => void) | null
  start(when?: number, offset?: number, duration?: number): void
  stop(when?: number): void
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  readonly pan: AudioParamLike
}

export interface PannerNodeLike extends AudioNodeLike {
  readonly positionX: AudioParamLike
  readonly positionY: AudioParamLike
  readonly positionZ: AudioParamLike
  readonly orientationX: AudioParamLike
  readonly orientationY: AudioParamLike
  readonly orientationZ: AudioParamLike
  panningModel: "equalpower" | "HRTF"
  distanceModel: "linear" | "inverse" | "exponential"
  refDistance: number
  maxDistance: number
  rolloffFactor: number
  coneInnerAngle: number
  coneOuterAngle: number
  coneOuterGain: number
}

/**
 * The one listener of a context: where the sound is heard from. Engines that have not
 * adopted the `AudioParam` form (Firefox today) only offer the older `setPosition` and
 * `setOrientation` methods, so the core uses whichever it finds.
 */
export interface AudioListenerLike {
  readonly positionX?: AudioParamLike
  readonly positionY?: AudioParamLike
  readonly positionZ?: AudioParamLike
  readonly forwardX?: AudioParamLike
  readonly forwardY?: AudioParamLike
  readonly forwardZ?: AudioParamLike
  readonly upX?: AudioParamLike
  readonly upY?: AudioParamLike
  readonly upZ?: AudioParamLike
  setPosition?(x: number, y: number, z: number): void
  setOrientation?(x: number, y: number, z: number, xUp: number, yUp: number, zUp: number): void
}

/** The part of `HTMLAudioElement` the streaming path uses. */
export interface MediaElementLike {
  src: string
  crossOrigin: string | null
  preload: string
  loop: boolean
  playbackRate: number
  readonly error: { readonly code: number } | null
  play(): Promise<void>
  pause(): void
  load(): void
  removeAttribute(name: string): void
  addEventListener(type: "canplay" | "ended" | "error", listener: () => void): void
  removeEventListener(type: "canplay" | "ended" | "error", listener: () => void): void
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly state: string
  readonly destination: AudioNodeLike
  readonly listener: AudioListenerLike
  createBufferSource(): SourceNodeLike
  createGain(): GainNodeLike
  createStereoPanner(): StereoPannerNodeLike
  createPanner(): PannerNodeLike
  createMediaElementSource(element: MediaElementLike): AudioNodeLike
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>
  resume(): Promise<void>
  close(): Promise<void>
}

/** The audio context as an Effect service, provided by a Layer per platform. */
export class AudioContextService extends Context.Service<
  AudioContextService,
  {
    readonly ctx: AudioContextLike
    /** Builds the element a stream plays through. Left out where there is none, as under Node. */
    readonly createMediaElement?: () => MediaElementLike
    /**
     * Reads the bytes of a local file, given a path or a `file:` URL. Left out in the browser,
     * where every source goes through `fetch`. When present, `Audio.load` uses it for any source
     * that is a path or a `file:` URL.
     */
    readonly readFile?: (location: string, signal: AbortSignal) => Promise<ArrayBuffer>
  }
  // Stryker disable next-line StringLiteral: the service key is only an identifier.
>()("fx-audio/AudioContext") {}

const gestures = ["pointerdown", "keydown", "touchend"] as const
// Capturing, so a page that stops propagation of its own events cannot hide the gesture.
const capture = { capture: true }

/**
 * Browsers keep a new `AudioContext` suspended until the page has seen a user gesture.
 * Resume it on the first gesture that works, then stop listening. A gesture the browser
 * refuses (resume rejects, or the context stays suspended) leaves the listeners in place
 * for the next one.
 */
const resumeOnGesture = (ctx: AudioContextLike) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      if (ctx.state !== "suspended" || typeof document === "undefined") return undefined
      const stop = () => {
        for (const gesture of gestures) document.removeEventListener(gesture, onGesture, capture)
      }
      const onGesture = () => {
        ctx.resume().then(
          () => {
            if (ctx.state === "running") stop()
          },
          () => undefined
        )
      }
      for (const gesture of gestures) document.addEventListener(gesture, onGesture, capture)
      return stop
    }),
    (stop) => Effect.sync(() => stop?.())
  )

/**
 * Browser layer: one `AudioContext` per layer build, closed with its scope. A context
 * the browser starts suspended is resumed on the first user gesture, so sounds played
 * before it are heard from that moment on.
 */
export const BrowserAudioContextLive: Layer.Layer<AudioContextService> = Layer.effect(
  AudioContextService,
  Effect.gen(function* () {
    const ctx = yield* Effect.acquireRelease(
      Effect.sync(() => new AudioContext() as unknown as AudioContextLike),
      (ctx) => Effect.promise(() => ctx.close())
    )
    yield* resumeOnGesture(ctx)
    return AudioContextService.of({ ctx, createMediaElement: () => new Audio() })
  })
)
