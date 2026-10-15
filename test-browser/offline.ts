import * as Layer from "effect/Layer"
import type {
  AnalyserNodeLike,
  AudioContextLike,
  GainNodeLike,
  PannerNodeLike,
  SourceNodeLike,
  StereoPannerNodeLike
} from "../src/index.ts"
import { AudioContextService } from "../src/index.ts"

/**
 * A real browser engine without an output device: an `OfflineAudioContext`
 * renders the graph on demand, so the tests behave the same on every engine,
 * including CI machines that have no sound card.
 */
export const makeOfflineContext = (seconds = 0.5, sampleRate = 44100, channels = 1) => {
  const offline = new OfflineAudioContext(channels, Math.round(seconds * sampleRate), sampleRate)
  const ctx: AudioContextLike = {
    get currentTime() {
      return offline.currentTime
    },
    get state() {
      return offline.state
    },
    destination: offline.destination as unknown as AudioContextLike["destination"],
    createBufferSource: () => offline.createBufferSource() as unknown as SourceNodeLike,
    createGain: () => offline.createGain() as unknown as GainNodeLike,
    createAnalyser: () => offline.createAnalyser() as unknown as AnalyserNodeLike,
    listener: offline.listener as unknown as AudioContextLike["listener"],
    createMediaElementSource: () => {
      throw new Error("an OfflineAudioContext cannot take a media element")
    },
    createPanner: () => offline.createPanner() as unknown as PannerNodeLike,
    createStereoPanner: () => offline.createStereoPanner() as unknown as StereoPannerNodeLike,
    decodeAudioData: (data) => offline.decodeAudioData(data),
    resume: () => offline.resume(),
    close: () => Promise.resolve()
  }
  return {
    ctx,
    render: () => offline.startRendering(),
    layer: Layer.succeed(AudioContextService, { ctx })
  }
}

export const peak = (buffer: AudioBuffer, channel = 0): number => {
  let max = 0
  for (const sample of buffer.getChannelData(channel)) max = Math.max(max, Math.abs(sample))
  return max
}
