import * as Effect from "effect/Effect"
import { Audio, Compressor, Echo, Filter, Reverb } from "fx-audio"
import { createAudio } from "fx-audio/promise"

// #region effect
export const program = Effect.gen(function* () {
  const audio = yield* Audio
  const music = yield* audio.group("music")

  // Muffled, as if heard through a wall.
  yield* music.setEffects([new Filter({ type: "lowpass", frequency: 800 })])

  // A cave: an echo, then a reverb, then a limiter to keep the level in check.
  yield* music.setEffects([
    new Echo({ time: 300, feedback: 0.4, mix: 0.3 }),
    new Reverb({ seconds: 3, mix: 0.4 }),
    new Compressor({ threshold: -18, ratio: 8 })
  ])

  // Back to the plain sound.
  yield* music.setEffects([])
})
// #endregion effect

export const promise = () => {
  // #region promise
  const audio = createAudio()
  const music = audio.group("music")

  music.setEffects([
    { _tag: "filter", type: "lowpass", frequency: 800 },
    { _tag: "reverb", seconds: 2, mix: 0.3 }
  ])
  // #endregion promise
}
