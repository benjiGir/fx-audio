import * as Layer from "effect/Layer"
import type {
  AudioContextLike,
  AudioListenerLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  PannerNodeLike,
  SourceNodeLike,
  StereoPannerNodeLike
} from "./context.ts"
import { AudioContextService } from "./context.ts"

/** A param that records every scheduled change. */
export interface FakeParam extends AudioParamLike {
  readonly calls: Array<{
    readonly kind: "set" | "ramp" | "cancel"
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
  /** Every node this source was connected to, in order. */
  readonly connections: ReadonlyArray<AudioNodeLike>
  /** Arguments of every `start` call, in order. */
  readonly startCalls: ReadonlyArray<{
    readonly when: number | undefined
    readonly offset: number | undefined
    readonly duration: number | undefined
  }>
  /** Simulate the end of playback: fires `onended` like a real engine. */
  end(): void
}

export interface FakeGain extends GainNodeLike {
  readonly gain: FakeParam
  readonly disconnects: number
  /** Every node this gain was connected to, in order. */
  readonly connections: ReadonlyArray<AudioNodeLike>
}

export interface FakePanner extends StereoPannerNodeLike {
  readonly pan: FakeParam
  readonly disconnects: number
  /** Every node this panner was connected to, in order. */
  readonly connections: ReadonlyArray<AudioNodeLike>
}

export interface FakeSpatialPanner extends PannerNodeLike {
  readonly positionX: FakeParam
  readonly positionY: FakeParam
  readonly positionZ: FakeParam
  readonly orientationX: FakeParam
  readonly orientationY: FakeParam
  readonly orientationZ: FakeParam
  readonly disconnects: number
  /** Every node this panner was connected to, in order. */
  readonly connections: ReadonlyArray<AudioNodeLike>
}

/** A listener with `AudioParam`s, as in Chromium and WebKit. */
export interface FakeListener extends AudioListenerLike {
  readonly positionX: FakeParam
  readonly positionY: FakeParam
  readonly positionZ: FakeParam
  readonly forwardX: FakeParam
  readonly forwardY: FakeParam
  readonly forwardZ: FakeParam
  readonly upX: FakeParam
  readonly upY: FakeParam
  readonly upZ: FakeParam
}

/** A listener with only the older `setPosition` and `setOrientation` methods, as in Firefox. */
export interface FakeLegacyListener extends AudioListenerLike {
  /** Arguments of every call, in order. */
  readonly calls: Array<{
    readonly method: "setPosition" | "setOrientation"
    readonly args: ReadonlyArray<number>
  }>
}

/** Pure-JS audio context double: records nodes and calls, does no audio work. */
export interface FakeContext extends AudioContextLike {
  readonly sources: ReadonlyArray<FakeSource>
  readonly gains: ReadonlyArray<FakeGain>
  readonly panners: ReadonlyArray<FakePanner>
  /** The 3D panners, in creation order. */
  readonly spatialPanners: ReadonlyArray<FakeSpatialPanner>
  readonly listener: AudioListenerLike
  currentTime: number
}

export interface FakeContextOptions {
  /** Replace the decoder. By default every decode rejects. */
  readonly decodeAudioData?: (data: ArrayBuffer) => Promise<AudioBuffer>
  /** Replace the listener, by default a `makeFakeListener()`. */
  readonly listener?: AudioListenerLike
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
    },
    cancelScheduledValues(time) {
      calls.push({ kind: "cancel", value: Number.NaN, time })
    }
  }
}

export const makeFakeListener = (): FakeListener => ({
  positionX: makeParam(),
  positionY: makeParam(),
  positionZ: makeParam(),
  forwardX: makeParam(),
  forwardY: makeParam(),
  forwardZ: makeParam(),
  upX: makeParam(),
  upY: makeParam(),
  upZ: makeParam()
})

export const makeLegacyListener = (): FakeLegacyListener => {
  const calls: FakeLegacyListener["calls"] = []
  return {
    calls,
    setPosition: (...args) => {
      calls.push({ method: "setPosition", args })
    },
    setOrientation: (...args) => {
      calls.push({ method: "setOrientation", args })
    }
  }
}

export const makeFakeContext = (options: FakeContextOptions = {}): FakeContext => {
  const sources: Array<FakeSource> = []
  const gains: Array<FakeGain> = []
  const panners: Array<FakePanner> = []
  const spatialPanners: Array<FakeSpatialPanner> = []
  const destination: AudioNodeLike = { connect: () => undefined, disconnect() {} }
  return {
    sources,
    gains,
    panners,
    spatialPanners,
    listener: options.listener ?? makeFakeListener(),
    currentTime: 0,
    state: "running",
    destination,
    createBufferSource() {
      const startCalls: Array<FakeSource["startCalls"][number]> = []
      const connections: Array<AudioNodeLike> = []
      const source: FakeSource & { starts: number; stops: number; disconnects: number } = {
        buffer: null,
        playbackRate: makeParam(),
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        onended: null,
        startCalls,
        connections,
        starts: 0,
        stops: 0,
        disconnects: 0,
        connect(destination) {
          connections.push(destination)
        },
        disconnect() {
          source.disconnects++
        },
        start(when, offset, duration) {
          source.starts++
          startCalls.push({ when, offset, duration })
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
      const connections: Array<AudioNodeLike> = []
      const gain: FakeGain & { disconnects: number } = {
        gain: makeParam(),
        disconnects: 0,
        connections,
        connect(destination) {
          connections.push(destination)
        },
        disconnect() {
          gain.disconnects++
        }
      }
      gains.push(gain)
      return gain
    },
    createStereoPanner() {
      const connections: Array<AudioNodeLike> = []
      const panner: FakePanner & { disconnects: number } = {
        pan: makeParam(),
        disconnects: 0,
        connections,
        connect(destination) {
          connections.push(destination)
        },
        disconnect() {
          panner.disconnects++
        }
      }
      panners.push(panner)
      return panner
    },
    createPanner() {
      const connections: Array<AudioNodeLike> = []
      const panner: FakeSpatialPanner & { disconnects: number } = {
        positionX: makeParam(),
        positionY: makeParam(),
        positionZ: makeParam(),
        orientationX: makeParam(),
        orientationY: makeParam(),
        orientationZ: makeParam(),
        // The Web Audio defaults, which the core leaves alone unless asked.
        panningModel: "equalpower",
        distanceModel: "inverse",
        refDistance: 1,
        maxDistance: 10000,
        rolloffFactor: 1,
        coneInnerAngle: 360,
        coneOuterAngle: 360,
        coneOuterGain: 0,
        disconnects: 0,
        connections,
        connect(destination) {
          connections.push(destination)
        },
        disconnect() {
          panner.disconnects++
        }
      }
      spatialPanners.push(panner)
      return panner
    },
    decodeAudioData:
      options.decodeAudioData ?? (() => Promise.reject(new Error("fake context cannot decode"))),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve()
  }
}

/** Layer providing the given context, for tests of code built on the core. */
export const FakeAudioContextLive = (ctx: AudioContextLike): Layer.Layer<AudioContextService> =>
  Layer.succeed(AudioContextService, { ctx })
