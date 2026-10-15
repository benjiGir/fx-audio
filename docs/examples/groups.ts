import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { Audio, type Sound } from "fx-audio"

// #region groups
export const program = (theme: Sound) =>
  Effect.gen(function* () {
    const audio = yield* Audio
    const music = yield* audio.group("music")
    yield* music.setVolume(0.4)
    yield* music.play(theme, { loop: true })

    yield* music.fadeTo(0, Duration.seconds(2)) // linear fade, scheduled on the audio thread
    yield* music.mute // remembers the volume
    yield* music.unmute

    yield* audio.master.mute // silence everything

    yield* music.stopAll // stop every voice in the group
    yield* audio.stopAll // stop every voice there is
  })
// #endregion groups
