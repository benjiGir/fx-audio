/**
 * An audio context double that records every node, param and scheduled change, for unit tests.
 * @module fx-audio/testing
 */

import * as Layer from "effect/Layer"
import type {
  AudioContextLike,
  AudioListenerLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  MediaElementLike,
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

/** A media element that records what it is asked to do and fires its events on demand. */
export interface FakeMediaElement extends MediaElementLike {
  readonly plays: number
  readonly pauses: number
  readonly loads: number
  readonly removedAttributes: ReadonlyArray<string>
  /** Fire an event on the listeners that are registered for it. */
  emit(type: "canplay" | "ended" | "error"): void
  /** Number of listeners registered for `type`. */
  listenerCount(type: "canplay" | "ended" | "error"): number
  /** What `error` reports, `null` by default. */
  error: { readonly code: number } | null
}

/** The node `createMediaElementSource` returns. */
export interface FakeMediaSource extends AudioNodeLike {
  readonly element: FakeMediaElement
  readonly disconnects: number
  /** Every node this source was connected to, in order. */
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
  /** The media elements built by `createMediaElement`, in creation order. */
  readonly elements: ReadonlyArray<FakeMediaElement>
  /** The nodes `createMediaElementSource` returned, in creation order. */
  readonly mediaSources: ReadonlyArray<FakeMediaSource>
  /** What the fake elements' `play` returns. */
  playResult: () => Promise<void>
  /** The factory to give `FakeAudioContextLive`, so streams can build elements. */
  createMediaElement(): FakeMediaElement
  /** Number of `resume` calls. */
  readonly resumes: number
  /** The 3D panners, in creation order. */
  readonly spatialPanners: ReadonlyArray<FakeSpatialPanner>
  readonly listener: AudioListenerLike
  currentTime: number
}

export interface FakeContextOptions {
  /** Replace the decoder. By default every decode rejects. */
  readonly decodeAudioData?: (data: ArrayBuffer) => Promise<AudioBuffer>
  /** Replace what `resume` returns, by default a resolved promise. */
  readonly resume?: () => Promise<void>
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

/**
 * Build an audio context double that records the nodes, params and calls the core makes.
 * Give it to `FakeAudioContextLive`, then check what the code under test did.
 *
 * @example
 * ```ts
 * const ctx = makeFakeContext({ decodeAudioData: () => Promise.resolve(buffer) })
 * const layer = AudioLive.pipe(Layer.provide(FakeAudioContextLive(ctx)))
 * ```
 */
export const makeFakeContext = (options: FakeContextOptions = {}): FakeContext => {
  const sources: Array<FakeSource> = []
  const gains: Array<FakeGain> = []
  const panners: Array<FakePanner> = []
  const spatialPanners: Array<FakeSpatialPanner> = []
  let resumes = 0
  const elements: Array<FakeMediaElement> = []
  const mediaSources: Array<FakeMediaSource> = []
  const destination: AudioNodeLike = { connect: () => undefined, disconnect() {} }
  // Named so the elements it builds can ask what `play` should return.
  const ctx: FakeContext = {
    sources,
    gains,
    panners,
    spatialPanners,
    elements,
    mediaSources,
    playResult: () => Promise.resolve(),
    createMediaElement() {
      const listeners: Record<"canplay" | "ended" | "error", Set<() => void>> = {
        canplay: new Set(),
        ended: new Set(),
        error: new Set()
      }
      const removedAttributes: Array<string> = []
      const element: FakeMediaElement & { plays: number; pauses: number; loads: number } = {
        src: "",
        crossOrigin: null,
        preload: "",
        loop: false,
        playbackRate: 1,
        error: null,
        plays: 0,
        pauses: 0,
        loads: 0,
        removedAttributes,
        play() {
          element.plays++
          return ctx.playResult()
        },
        pause() {
          element.pauses++
        },
        load() {
          element.loads++
        },
        removeAttribute(name) {
          removedAttributes.push(name)
        },
        addEventListener(type, listener) {
          listeners[type].add(listener)
        },
        removeEventListener(type, listener) {
          listeners[type].delete(listener)
        },
        emit(type) {
          // Listeners remove themselves while the event is dispatched, so iterate a copy.
          // oxlint-disable-next-line unicorn/no-useless-spread
          for (const listener of [...listeners[type]]) listener()
        },
        listenerCount: (type) => listeners[type].size
      }
      elements.push(element)
      return element
    },
    createMediaElementSource(element) {
      const connections: Array<AudioNodeLike> = []
      const source: FakeMediaSource & { disconnects: number } = {
        element: element as FakeMediaElement,
        disconnects: 0,
        connections,
        connect(destination) {
          connections.push(destination)
        },
        disconnect() {
          source.disconnects++
        }
      }
      mediaSources.push(source)
      return source
    },
    get resumes() {
      return resumes
    },
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
    resume: () => {
      resumes++
      return options.resume?.() ?? Promise.resolve()
    },
    close: () => Promise.resolve()
  }
  return ctx
}

/** Layer providing the given context, for tests of code built on the core. */
export const FakeAudioContextLive = (
  ctx: AudioContextLike,
  options: {
    readonly createMediaElement?: () => MediaElementLike
    readonly readFile?: (location: string, signal: AbortSignal) => Promise<ArrayBuffer>
  } = {}
): Layer.Layer<AudioContextService> => Layer.succeed(AudioContextService, { ctx, ...options })
