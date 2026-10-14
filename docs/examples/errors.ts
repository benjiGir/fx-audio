import * as Effect from "effect/Effect"
import { Audio } from "fx-audio"

// #region errors
export const program = Effect.gen(function* () {
  const audio = yield* Audio
  // `reason` is itself a tagged error: recover from one kind of failure and let the others through.
  return yield* audio
    .load("/sounds/theme.opus")
    .pipe(
      Effect.catchReason("LoadError", "UnsupportedFormat", () => audio.load("/sounds/theme.mp3"))
    )
})
// #endregion errors
