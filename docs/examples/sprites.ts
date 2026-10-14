import * as Effect from "effect/Effect"
import { Audio, SpriteSegment, SpriteSheet } from "fx-audio"

// #region sprites
export const program = Effect.gen(function* () {
  const audio = yield* Audio
  const sound = yield* audio.load("/sounds/effects.mp3")

  const sheet = new SpriteSheet({
    sound,
    segments: {
      hit: new SpriteSegment({ start: 0, duration: 400 }),
      engine: new SpriteSegment({ start: 500, duration: 2000, loop: true })
    }
  })

  const voice = yield* audio.playSprite(sheet, "hit", { volume: 0.8 })
  yield* voice.ended
})
// #endregion sprites
