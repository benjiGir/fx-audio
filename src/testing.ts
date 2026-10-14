import * as Layer from "effect/Layer"
import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  SourceNodeLike
} from "./context.ts"
import { AudioContextService } from "./context.ts"

/** A param that records every scheduled change. */
export interface FakeParam extends AudioParamLike {
  readonly calls: Array<{
    readonly kind: "set" | "ramp"
    readonly value: number
    readonly time: number
  }>
}

export interface FakeSource extends SourceNodeLike {
  readonly playbackRate: FakeParam
  /** Number of times `start` and `stop` were called. */
  readonly starts: number
  readonly stops: number
  readonly disconnects: number
  /** Simulate the end of playback: fires `onended` like a real engine. */
  end(): void
}

export interface FakeGain extends GainNodeLike {
  readonly gain: FakeParam
  readonly disconnects: number
}

/** Pure-JS audio context double: records nodes and calls, does no audio work. */
export interface FakeContext extends AudioContextLike {
  readonly sources: ReadonlyArray<FakeSource>
  readonly gains: ReadonlyArray<FakeGain>
  currentTime: number
}

export interface FakeContextOptions {
  /** Replace the decoder. By default every decode rejects. */
  readonly decodeAudioData?: (data: ArrayBuffer) => Promise<AudioBuffer>
}

const makeParam = (): FakeParam => {
  const calls: FakeParam["calls"] = []
  return {
    value: 1,
    calls,
    setValueAtTime(value, time) {
      calls.push({ kind: "set", value, time })
    },
    linearRampToValueAtTime(value, time) {
      calls.push({ kind: "ramp", value, time })
    }
  }
}

export const makeFakeContext = (options: FakeContextOptions = {}): FakeContext => {
  const sources: Array<FakeSource> = []
  const gains: Array<FakeGain> = []
  const destination: AudioNodeLike = { connect: () => undefined, disconnect() {} }
  return {
    sources,
    gains,
    currentTime: 0,
    state: "running",
    destination,
    createBufferSource() {
      const source: FakeSource & { starts: number; stops: number; disconnects: number } = {
        buffer: null,
        playbackRate: makeParam(),
        loop: false,
        onended: null,
        starts: 0,
        stops: 0,
        disconnects: 0,
        connect: () => undefined,
        disconnect() {
          source.disconnects++
        },
        start() {
          source.starts++
        },
        stop() {
          source.stops++
        },
        end() {
          source.onended?.({})
        }
      }
      sources.push(source)
      return source
    },
    createGain() {
      const gain: FakeGain & { disconnects: number } = {
        gain: makeParam(),
        disconnects: 0,
        connect: () => undefined,
        disconnect() {
          gain.disconnects++
        }
      }
      gains.push(gain)
      return gain
    },
    decodeAudioData:
      options.decodeAudioData ?? (() => Promise.reject(new Error("fake context cannot decode"))),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve()
  }
}

/** Layer providing the given context, for tests of code built on the core. */
export const FakeContextLive = (ctx: AudioContextLike): Layer.Layer<AudioContextService> =>
  Layer.succeed(AudioContextService, { ctx })
