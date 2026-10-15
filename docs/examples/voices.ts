import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { Audio, type Sound, type Voice } from "fx-audio"
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

// #region events-effect
export const watch = (sound: Sound) =>
  Effect.gen(function* () {
    const audio = yield* Audio
    const voice = yield* audio.play(sound)
    yield* Effect.forkChild(
      Stream.runForEach(voice.events, (event) =>
        Effect.sync(() => {
          if (event._tag === "seek") console.log("now at", event.position, "ms")
          if (event._tag === "end") console.log("played to the end")
        })
      )
    )
    yield* voice.ended
  })
// #endregion events-effect

export const listen = async () => {
  // #region events-promise
  const audio = createAudio()
  const voice = audio.play(await audio.load("/sounds/theme.mp3"))

  const stopListening = voice.on("seek", (event) => console.log("now at", event.position, "ms"))
  voice.on("end", () => console.log("played to the end"))
  voice.seek(30_000)
  stopListening()
  // #endregion events-promise
}

// #region crossfade-effect
export const nextTrack = (current: Voice, next: Sound) =>
  Effect.gen(function* () {
    const audio = yield* Audio
    // `next` fades in while `current` fades out and stops, three seconds for both.
    return yield* audio.crossfade(current, next, 3000, { loop: true })
  })
// #endregion crossfade-effect

export const crossfadePromise = async () => {
  // #region crossfade-promise
  const audio = createAudio()
  const first = audio.play(await audio.load("/sounds/day.mp3"), { loop: true })

  // Later, hand over to the night track.
  const second = audio.crossfade(first, await audio.load("/sounds/night.mp3"), 3000, {
    loop: true
  })

  await second.fadeOut(1000) // or simply fade a voice out and stop it
  // #endregion crossfade-promise
}
