import * as Effect from "effect/Effect"
import { Audio, type Sound } from "fx-audio"

// #region pan
export const program = (sound: Sound) =>
  Effect.gen(function* () {
    const audio = yield* Audio
    const voice = yield* audio.play(sound, { pan: -1 })
    yield* voice.setPan(1)
  })
// #endregion pan
