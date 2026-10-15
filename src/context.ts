import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

/**
 * Smallest surface of the Web Audio API the core needs. Browser, Node
 * (`node-web-audio-api`) and test doubles all satisfy it structurally.
 */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown
  /** Without an argument, breaks every connection out of the node; with one, only the one to `destination`. */
  disconnect(destination?: AudioNodeLike): void
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

/** Reads the signal that passes through it, without changing it. */
export interface AnalyserNodeLike extends AudioNodeLike {
  fftSize: number
  readonly frequencyBinCount: number
  getByteFrequencyData(array: Uint8Array): void
  getFloatTimeDomainData(array: Float32Array): void
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type:
    | "lowpass"
    | "highpass"
    | "bandpass"
    | "notch"
    | "allpass"
    | "peaking"
    | "lowshelf"
    | "highshelf"
  readonly frequency: AudioParamLike
  readonly Q: AudioParamLike
  readonly gain: AudioParamLike
}

export interface DelayNodeLike extends AudioNodeLike {
  readonly delayTime: AudioParamLike
}

export interface ConvolverNodeLike extends AudioNodeLike {
  buffer: AudioBuffer | null
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike
  readonly knee: AudioParamLike
  readonly ratio: AudioParamLike
  readonly attack: AudioParamLike
  readonly release: AudioParamLike
}

/** The part of `HTMLAudioElement` the streaming path uses. */
export interface MediaElementLike {
  src: string
  crossOrigin: string | null
  preload: string
  loop: boolean
  playbackRate: number
  /** Seconds from the start of the media. Setting it seeks. */
  currentTime: number
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
  readonly sampleRate: number
  readonly state: string
  readonly destination: AudioNodeLike
  readonly listener: AudioListenerLike
  createBufferSource(): SourceNodeLike
  createGain(): GainNodeLike
  createAnalyser(): AnalyserNodeLike
  createBiquadFilter(): BiquadFilterNodeLike
  createDelay(maxDelayTime: number): DelayNodeLike
  createConvolver(): ConvolverNodeLike
  createDynamicsCompressor(): DynamicsCompressorNodeLike
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer
  createStereoPanner(): StereoPannerNodeLike
  createPanner(): PannerNodeLike
  createMediaElementSource(element: MediaElementLike): AudioNodeLike
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>
  resume(): Promise<void>
  close(): Promise<void>
  /** Present on a real `AudioContext`, which fires `statechange` when it is suspended, interrupted or resumed. */
  addEventListener?(type: "statechange", listener: () => void): void
  removeEventListener?(type: "statechange", listener: () => void): void
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
 * Browsers keep a new `AudioContext` suspended until the page has seen a user gesture, and a phone
 * suspends or interrupts a running one (a call, the lock screen, a hidden tab). Resume it on the
 * first gesture that works, then stop listening; leave the gesture listeners in place when the
 * browser refuses (resume rejects, or the context stays suspended) and put them back each time the
 * context stops running. A tab that becomes visible again tries to resume at once, since a page that
 * already had a gesture is often allowed to.
 */
const keepRunning = (ctx: AudioContextLike) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      if (typeof document === "undefined") return undefined
      let armed = false
      const disarm = () => {
        armed = false
        for (const gesture of gestures) document.removeEventListener(gesture, tryResume, capture)
      }
      const tryResume = () => {
        ctx.resume().then(
          () => {
            if (ctx.state === "running") disarm()
          },
          () => undefined
        )
      }
      const arm = () => {
        if (armed) return
        armed = true
        for (const gesture of gestures) document.addEventListener(gesture, tryResume, capture)
      }
      const onStateChange = () => {
        if (ctx.state === "running") disarm()
        else arm()
      }
      const onVisibilityChange = () => {
        if (document.visibilityState !== "visible" || ctx.state === "running") return
        tryResume()
        arm()
      }
      if (ctx.state !== "running") arm()
      ctx.addEventListener?.("statechange", onStateChange)
      document.addEventListener("visibilitychange", onVisibilityChange)
      return () => {
        disarm()
        ctx.removeEventListener?.("statechange", onStateChange)
        document.removeEventListener("visibilitychange", onVisibilityChange)
      }
    }),
    (stop) => Effect.sync(() => stop?.())
  )

/**
 * Browser layer: one `AudioContext` per layer build, closed with its scope. A context
 * the browser starts suspended is resumed on the first user gesture, so sounds played
 * before it are heard from that moment on. A context that a phone call, the lock screen or
 * a hidden tab suspends or interrupts is resumed the same way, when the tab is visible again
 * or on the next gesture.
 */
export const BrowserAudioContextLive: Layer.Layer<AudioContextService> = Layer.effect(
  AudioContextService,
  Effect.gen(function* () {
    const ctx = yield* Effect.acquireRelease(
      Effect.sync(() => new AudioContext() as unknown as AudioContextLike),
      (ctx) => Effect.promise(() => ctx.close())
    )
    yield* keepRunning(ctx)
    return AudioContextService.of({ ctx, createMediaElement: () => new Audio() })
  })
)
