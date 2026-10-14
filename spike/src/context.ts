import * as Context from "effect/Context"

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
}

export interface SourceNodeLike extends AudioNodeLike {
  buffer: AudioBuffer | null
  playbackRate: AudioParamLike
  loop: boolean
  onended: ((event: unknown) => void) | null
  start(when?: number, offset?: number, duration?: number): void
  stop(when?: number): void
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly state: string
  readonly destination: AudioNodeLike
  createBufferSource(): SourceNodeLike
  createGain(): GainNodeLike
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>
  resume(): Promise<void>
  close(): Promise<void>
}

/** The audio context as an Effect service, provided by a Layer per platform. */
export class AudioContextService extends Context.Service<
  AudioContextService,
  { readonly ctx: AudioContextLike }
>()("fx-audio/AudioContext") {}
