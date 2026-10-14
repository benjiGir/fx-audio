import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import {
  PlayOptions,
  Sound,
  SpatialOptions,
  SpriteSegment,
  SpriteSheet,
  Vector3
} from "../src/index.ts"

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

  it("accepts a pan from -1 to 1 and rejects anything beyond", () => {
    assert.strictEqual(decodeOptions({ pan: -1 }).pan, -1)
    assert.strictEqual(decodeOptions({ pan: 1 }).pan, 1)
    assert.throws(() => decodeOptions({ pan: 1.01 }))
    assert.throws(() => decodeOptions({ pan: -1.01 }))
    assert.throws(() => decodeOptions({ pan: Number.NaN }))
  })

  it("validates when constructed", () => {
    assert.strictEqual(new PlayOptions({ volume: 0 }).volume, 0)
    assert.throws(() => new PlayOptions({ rate: -2 }))
  })
})

describe("Vector3", () => {
  it("keeps three finite coordinates", () => {
    const v = new Vector3({ x: 1, y: -2, z: 0.5 })
    assert.deepStrictEqual({ ...v }, { x: 1, y: -2, z: 0.5 })
  })

  it("rejects NaN and infinity", () => {
    assert.throws(() => new Vector3({ x: Number.NaN, y: 0, z: 0 }))
    assert.throws(() => new Vector3({ x: 0, y: Number.POSITIVE_INFINITY, z: 0 }))
  })
})

describe("SpatialOptions", () => {
  const position = { x: 0, y: 0, z: 0 }
  const decodeSpatial = Schema.decodeUnknownSync(SpatialOptions)

  it("needs a position and leaves the rest optional", () => {
    assert.instanceOf(decodeSpatial({ position }).position, Vector3)
    assert.throws(() => decodeSpatial({}))
  })

  it("nests in PlayOptions", () => {
    assert.strictEqual(
      decodeOptions({ spatial: { position, rolloffFactor: 2 } }).spatial?.rolloffFactor,
      2
    )
    assert.throws(() => decodeOptions({ spatial: { position: { x: 0 } } }))
  })

  it("accepts the Web Audio models and rejects other names", () => {
    assert.strictEqual(decodeSpatial({ position, panningModel: "HRTF" }).panningModel, "HRTF")
    assert.strictEqual(
      decodeSpatial({ position, distanceModel: "exponential" }).distanceModel,
      "exponential"
    )
    assert.throws(() => decodeSpatial({ position, panningModel: "hrtf" }))
    assert.throws(() => decodeSpatial({ position, distanceModel: "cubic" }))
  })

  it("keeps distances and angles in their Web Audio ranges", () => {
    assert.strictEqual(decodeSpatial({ position, refDistance: 0 }).refDistance, 0)
    assert.throws(() => decodeSpatial({ position, refDistance: -1 }))
    assert.throws(() => decodeSpatial({ position, maxDistance: 0 }))
    assert.throws(() => decodeSpatial({ position, rolloffFactor: -0.1 }))
    assert.strictEqual(decodeSpatial({ position, coneOuterAngle: 360 }).coneOuterAngle, 360)
    assert.throws(() => decodeSpatial({ position, coneInnerAngle: 361 }))
    assert.throws(() => decodeSpatial({ position, coneOuterAngle: -1 }))
    assert.throws(() => decodeSpatial({ position, coneOuterGain: 1.1 }))
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

describe("model identifiers", () => {
  it("names every class after the package, for error messages and debugging", () => {
    assert.strictEqual(Vector3.identifier, "fx-audio/Vector3")
    assert.strictEqual(SpatialOptions.identifier, "fx-audio/SpatialOptions")
    assert.strictEqual(Sound.identifier, "fx-audio/Sound")
    assert.strictEqual(PlayOptions.identifier, "fx-audio/PlayOptions")
    assert.strictEqual(SpriteSegment.identifier, "fx-audio/SpriteSegment")
    assert.strictEqual(SpriteSheet.identifier, "fx-audio/SpriteSheet")
  })
})
