import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  SourceNodeLike
} from "./context.ts"

/** Pure-JS audio context double: records node creation, does no audio work. */
export interface FakeContext extends AudioContextLike {
  readonly created: { sources: number; gains: number }
}

const param = (): AudioParamLike => ({
  value: 1,
  setValueAtTime() {},
  linearRampToValueAtTime() {}
})

export const makeFakeContext = (): FakeContext => {
  const created = { sources: 0, gains: 0 }
  const destination: AudioNodeLike = { connect: () => undefined, disconnect() {} }
  return {
    created,
    currentTime: 0,
    state: "running",
    destination,
    createBufferSource(): SourceNodeLike {
      created.sources++
      return {
        buffer: null,
        playbackRate: param(),
        loop: false,
        onended: null,
        connect: () => undefined,
        disconnect() {},
        start() {},
        stop() {}
      }
    },
    createGain(): GainNodeLike {
      created.gains++
      return { gain: param(), connect: () => undefined, disconnect() {} }
    },
    decodeAudioData: () => Promise.reject(new Error("fake context cannot decode")),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve()
  }
}
