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

export interface AudioContextLike {
  readonly currentTime: number
  readonly state: string
  readonly destination: AudioNodeLike
  readonly listener: AudioListenerLike
  createBufferSource(): SourceNodeLike
  createGain(): GainNodeLike
  createStereoPanner(): StereoPannerNodeLike
  createPanner(): PannerNodeLike
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>
  resume(): Promise<void>
  close(): Promise<void>
}

/** The audio context as an Effect service, provided by a Layer per platform. */
export class AudioContextService extends Context.Service<
  AudioContextService,
  { readonly ctx: AudioContextLike }
>()("fx-audio/AudioContext") {}

/** Browser layer: one `AudioContext` per layer build, closed with its scope. */
export const BrowserAudioContextLive: Layer.Layer<AudioContextService> = Layer.effect(
  AudioContextService,
  Effect.gen(function* () {
    const ctx = yield* Effect.acquireRelease(
      Effect.sync(() => new AudioContext() as unknown as AudioContextLike),
      (ctx) => Effect.promise(() => ctx.close())
    )
    return AudioContextService.of({ ctx })
  })
)
