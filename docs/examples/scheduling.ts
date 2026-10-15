import * as Effect from "effect/Effect"
import { Audio, type Sound } from "fx-audio"
import { createAudio } from "fx-audio/promise"

// #region effect
export const program = (kick: Sound, snare: Sound) =>
  Effect.gen(function* () {
    const audio = yield* Audio

    // Half a second from now, counted on the audio clock.
    yield* audio.play(kick, { delay: 500 })

    // On a fixed grid: one beat every 500 ms from the same starting time.
    const start = (yield* audio.now) + 100
    for (let beat = 0; beat < 8; beat++) {
      yield* audio.play(beat % 2 === 0 ? kick : snare, { startAt: start + beat * 500 })
    }
  })
// #endregion effect

export const promise = async () => {
  // #region promise
  const audio = createAudio()
  const kick = await audio.load("/sounds/kick.wav")

  audio.play(kick, { delay: 500 })

  const start = audio.now() + 100
  for (let beat = 0; beat < 8; beat++) {
    audio.play(kick, { startAt: start + beat * 500 })
  }
  // #endregion promise
}
