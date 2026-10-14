import * as Effect from "effect/Effect"
import { assert, describe, it } from "vitest"
import { decode, play } from "../src/index.ts"
import { NodeLive } from "../src/node.ts"

/** Mono 16-bit PCM WAV of a 440 Hz tone, built in memory. */
const makeWav = (seconds: number, sampleRate = 8000): ArrayBuffer => {
  const samples = Math.round(seconds * sampleRate)
  const view = new DataView(new ArrayBuffer(44 + samples * 2))
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, "RIFF")
  view.setUint32(4, 36 + samples * 2, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, "data")
  view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) {
    view.setInt16(
      44 + i * 2,
      Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000),
      true
    )
  }
  return view.buffer as ArrayBuffer
}

describe("NodeLive (real engine, no sound card)", () => {
  it("decodes a WAV and plays it to the end", async () => {
    const program = Effect.gen(function* () {
      const sound = yield* decode(makeWav(0.1), "tone.wav")
      assert.closeTo(sound.buffer.duration, 0.1, 0.001)
      const voice = yield* play(sound, { volume: 0.5 })
      yield* voice.ended
    }).pipe(Effect.scoped, Effect.provide(NodeLive({ silent: true })))
    await Effect.runPromise(program)
  })

  it("reports undecodable bytes as a typed decode error", async () => {
    const program = decode(new ArrayBuffer(64), "garbage.bin").pipe(
      Effect.flip,
      Effect.provide(NodeLive({ silent: true }))
    )
    const error = await Effect.runPromise(program)
    assert.strictEqual(error._tag, "LoadError")
    assert.include(["decode", "unsupported-format"], error.reason)
  })
})
