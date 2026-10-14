import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Audio, AudioLive, BrowserAudioContextLive } from "../../src/index.ts"

const program = Effect.gen(function* () {
  const audio = yield* Audio
  yield* audio.play(yield* audio.load("a.wav"))
}).pipe(Effect.scoped, Effect.provide(AudioLive.pipe(Layer.provide(BrowserAudioContextLive))))

Effect.runFork(program)
