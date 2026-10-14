// Code samples of the "Getting started" page, compiled by `pnpm typecheck` so they cannot go stale.
import * as Effect from "effect/Effect"
import { Audio, AudioBrowserLive } from "fx-audio"
import { createAudio } from "fx-audio/promise"

// #region effect
const program = Effect.gen(function* () {
  const audio = yield* Audio
  const sound = yield* audio.load("/sounds/hit.mp3")
  const voice = yield* audio.play(sound, { volume: 0.8 })
  yield* voice.ended
}).pipe(Effect.scoped, Effect.provide(AudioBrowserLive))

Effect.runPromise(program)
// #endregion effect

// #region promise
export const playHit = async () => {
  const audio = createAudio()
  const sound = await audio.load("/sounds/hit.mp3")
  const voice = audio.play(sound, { volume: 0.8 })
  await voice.ended
  await audio.dispose()
}
// #endregion promise
