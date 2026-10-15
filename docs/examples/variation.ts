import * as Effect from "effect/Effect"
import { Audio, makeSoundBank, type Sound } from "fx-audio"
import { createAudio } from "fx-audio/promise"

// #region effect
export const footsteps = (step1: Sound, step2: Sound, step3: Sound) =>
  Effect.gen(function* () {
    const audio = yield* Audio
    // Never the same step twice in a row.
    const steps = makeSoundBank([step1, step2, step3])

    // Each step a little different: speed (and pitch) within 10 %, volume within 20 %.
    yield* audio.play(steps.next(), { rateVariation: 0.1, volumeVariation: 0.2 })
  })
// #endregion effect

export const promise = async () => {
  // #region promise
  const audio = createAudio()
  const steps = makeSoundBank(
    await Promise.all(["/sounds/step1.wav", "/sounds/step2.wav"].map((url) => audio.load(url))),
    { order: "random" } // or "cycle"
  )

  audio.play(steps.next(), { rateVariation: 0.1, volumeVariation: 0.2 })
  // #endregion promise
}
