import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Audio, AudioLive } from "fx-audio"
import { NodeAudioContextLive } from "fx-audio/node"
import { createAudioAsync } from "fx-audio/promise"

// #region layer
export const layer = AudioLive.pipe(Layer.provide(NodeAudioContextLive()))

export const program = Effect.gen(function* () {
  const audio = yield* Audio
  const sound = yield* audio.load("./sounds/hit.wav")
  const same = yield* audio.load(new URL("./hit.wav", import.meta.url).href)
  return [sound, same]
})
// #endregion layer

// #region promise
export const main = async () => {
  const audio = await createAudioAsync(NodeAudioContextLive())
  audio.play(await audio.load("./sounds/hit.wav"))
}
// #endregion promise
