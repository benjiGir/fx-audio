import * as Effect from "effect/Effect"
import { Audio, type Sound } from "fx-audio"
import { createAudio } from "fx-audio/promise"

// #region effect
export const program = (sound: Sound) =>
  Effect.gen(function* () {
    const audio = yield* Audio
    const voice = yield* audio.play(sound, { loop: true })

    yield* voice.pause
    yield* voice.seek(30_000) // thirty seconds in, still paused
    yield* voice.resume

    yield* voice.setRate(1.5)
    yield* voice.setVolume(0.4)
    const where = yield* voice.position // milliseconds
    return where
  })
// #endregion effect

export const promise = async () => {
  // #region promise
  const audio = createAudio()
  const voice = audio.play(await audio.load("/sounds/theme.mp3"))

  voice.pause()
  voice.seek(30_000)
  await voice.resume() // resolves at once, except for a streamed voice
  voice.setRate(1.5)
  voice.setVolume(0.4)
  const where = voice.position() // milliseconds
  // #endregion promise
  return where
}
