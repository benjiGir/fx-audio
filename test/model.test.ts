import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import { PlayOptions, Sound } from "../src/index.ts"

const decodeOptions = Schema.decodeUnknownSync(PlayOptions)

describe("PlayOptions", () => {
  it("accepts a full set of options and none at all", () => {
    assert.deepStrictEqual(
      { ...decodeOptions({ volume: 0.5, rate: 2, loop: true }) },
      {
        volume: 0.5,
        rate: 2,
        loop: true
      }
    )
    assert.deepStrictEqual({ ...decodeOptions({}) }, {})
  })

  it("rejects a negative volume, a null rate and a non-finite number", () => {
    assert.throws(() => decodeOptions({ volume: -1 }))
    assert.throws(() => decodeOptions({ rate: 0 }))
    assert.throws(() => decodeOptions({ volume: Number.NaN }))
    assert.throws(() => decodeOptions({ loop: "yes" }))
  })

  it("validates when constructed", () => {
    assert.strictEqual(new PlayOptions({ volume: 0 }).volume, 0)
    assert.throws(() => new PlayOptions({ rate: -2 }))
  })
})

describe("Sound", () => {
  it("wraps a buffer-like value", () => {
    const buffer = { duration: 2 } as AudioBuffer
    assert.strictEqual(new Sound({ buffer, source: "a.wav" }).buffer, buffer)
  })

  it("rejects something that is not a decoded buffer", () => {
    assert.throws(() => new Sound({ buffer: {} as AudioBuffer, source: "a.wav" }))
  })
})
