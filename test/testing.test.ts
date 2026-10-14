import { assert, describe, it } from "vitest"
import { makeFakeContext } from "../src/testing.ts"

describe("makeFakeContext", () => {
  it("rejects decodeAudioData by default", async () => {
    const ctx = makeFakeContext()
    const error = await ctx.decodeAudioData(new ArrayBuffer(1)).catch((e: unknown) => e)
    assert.match(String(error), /cannot decode/)
  })

  it("resumes and closes", async () => {
    const ctx = makeFakeContext()
    await ctx.resume()
    await ctx.close()
    assert.strictEqual(ctx.state, "running")
  })

  it("has a destination that accepts connections", () => {
    const ctx = makeFakeContext()
    ctx.destination.connect(ctx.destination)
    ctx.destination.disconnect()
    const source = ctx.createBufferSource()
    source.connect(ctx.destination)
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    assert.strictEqual(ctx.sources.length, 1)
    assert.strictEqual(ctx.gains.length, 1)
  })
})
