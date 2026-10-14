import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Audio, AudioLive } from "../src/index.ts"
import { NodeAudioContextLive } from "../src/node.ts"
import { makeWav } from "./helpers/wav.ts"

const nodeAudio = AudioLive.pipe(Layer.provide(NodeAudioContextLive({ silent: true })))

describe("NodeAudioContextLive (real engine, no sound card)", () => {
  it.live("decodes a WAV and plays it to the end", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.1), "tone.wav")
      assert.closeTo(sound.buffer.duration, 0.1, 0.001)
      const voice = yield* audio.play(sound, { volume: 0.5 })
      yield* voice.ended
    }).pipe(Effect.scoped, Effect.provide(nodeAudio))
  )

  it.live("reports undecodable bytes as a typed load error", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.decode(new ArrayBuffer(64), "garbage.bin"))
      assert.strictEqual(error._tag, "LoadError")
      assert.include(["DecodeFailure", "UnsupportedFormat"], error.reason._tag)
    }).pipe(Effect.provide(nodeAudio))
  )
})
