import * as Effect from "effect/Effect"
import { Audio } from "fx-audio"

// #region streaming
export const program = Effect.gen(function* () {
  const audio = yield* Audio
  const music = yield* audio.group("music")
  const voice = yield* music.stream("/music/theme.mp3", { loop: true, volume: 0.6 })
  yield* voice.fadeTo(0, "3 seconds")
  yield* voice.stop
})
// #endregion streaming
