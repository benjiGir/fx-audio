import type { FakeContext } from "../../src/testing.ts"

/** Gain nodes of the voices only: the first gain the core creates is the master group's. */
export const voiceGains = (ctx: FakeContext) => ctx.gains.slice(1)

/** The gain node created in position `index`, failing loudly when there is none. */
export const gainAt = (ctx: FakeContext, index: number) => {
  const gain = ctx.gains[index]
  if (gain === undefined) throw new Error(`no gain node at ${index}`)
  return gain
}

/** The stereo panner created in position `index`, failing loudly when there is none. */
export const pannerAt = (ctx: FakeContext, index: number) => {
  const panner = ctx.panners[index]
  if (panner === undefined) throw new Error(`no panner node at ${index}`)
  return panner
}

/** The 3D panner created in position `index`, failing loudly when there is none. */
export const spatialAt = (ctx: FakeContext, index: number) => {
  const panner = ctx.spatialPanners[index]
  if (panner === undefined) throw new Error(`no spatial panner node at ${index}`)
  return panner
}
