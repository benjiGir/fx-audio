import * as Layer from "effect/Layer"
import type { AudioContextLike, GainNodeLike, SourceNodeLike } from "../src/index.ts"
import { AudioContextService } from "../src/index.ts"

/**
 * A real browser engine without an output device: an `OfflineAudioContext`
 * renders the graph on demand, so the tests behave the same on every engine,
 * including CI machines that have no sound card.
 */
export const makeOfflineContext = (seconds = 0.5, sampleRate = 44100) => {
  const offline = new OfflineAudioContext(1, Math.round(seconds * sampleRate), sampleRate)
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

export const peak = (buffer: AudioBuffer): number => {
  let max = 0
  for (const sample of buffer.getChannelData(0)) max = Math.max(max, Math.abs(sample))
  return max
}
