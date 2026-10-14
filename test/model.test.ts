import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import { PlayOptions, Sound, SpriteSegment, SpriteSheet } from "../src/index.ts"

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

describe("SpriteSegment", () => {
  it("accepts a start at zero and an optional loop flag", () => {
    const segment = new SpriteSegment({ start: 0, duration: 0.5, loop: true })
    assert.deepStrictEqual({ ...segment }, { start: 0, duration: 0.5, loop: true })
    assert.isUndefined(new SpriteSegment({ start: 1, duration: 2 }).loop)
  })

  it("rejects a negative start, an empty duration and non-finite times", () => {
    assert.throws(() => new SpriteSegment({ start: -1, duration: 1 }))
    assert.throws(() => new SpriteSegment({ start: 0, duration: 0 }))
    assert.throws(() => new SpriteSegment({ start: Number.NaN, duration: 1 }))
    assert.throws(() => new SpriteSegment({ start: 0, duration: Number.POSITIVE_INFINITY }))
  })
})

describe("SpriteSheet", () => {
  const sound = new Sound({ buffer: { duration: 3 } as AudioBuffer, source: "fx.wav" })

  it("keeps the sound and its named segments", () => {
    const hit = new SpriteSegment({ start: 0, duration: 1 })
    const sheet = new SpriteSheet({ sound, segments: { hit } })
    assert.strictEqual(sheet.sound, sound)
    assert.strictEqual(sheet.segments["hit"], hit)
  })

  it("rejects a segment that is not a valid SpriteSegment", () => {
    assert.throws(
      () =>
        new SpriteSheet({
          sound,
          segments: { bad: { start: -1, duration: 1 } as SpriteSegment }
        })
    )
  })
})
