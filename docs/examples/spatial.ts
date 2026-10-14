import * as Effect from "effect/Effect"
import { Audio, type Sound } from "fx-audio"

// #region spatial
export const program = (sound: Sound) =>
  Effect.gen(function* () {
    const audio = yield* Audio
    const voice = yield* audio.play(sound, {
      spatial: { position: { x: 4, y: 0, z: -2 }, distanceModel: "linear", maxDistance: 30 }
    })
    yield* voice.setPosition({ x: -4, y: 0, z: -2 })
    yield* audio.listener.setPosition({ x: 1, y: 0, z: 0 })
    yield* audio.listener.setOrientation({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
  })
// #endregion spatial
