import * as Effect from "effect/Effect"
import { Audio, type Voice } from "fx-audio"
import { createAudio } from "fx-audio/promise"

// #region effect
export const meter = (voice: Voice) =>
  Effect.gen(function* () {
    const analyser = yield* voice.analyser
    const level = yield* analyser.level // 0 (silence) to 1 (full scale)
    const bars = yield* analyser.spectrum // 1024 values, 0 to 255
    return { level, bars }
  })

export const masterLevel = Effect.gen(function* () {
  const audio = yield* Audio
  return yield* (yield* audio.analyser).level
})
// #endregion effect

export const promise = async () => {
  // #region promise
  const audio = createAudio()
  const music = audio.group("music")
  const analyser = music.analyser()
  const canvas = document.querySelector("canvas")!

  const draw = () => {
    const bars = analyser.spectrum()
    const context = canvas.getContext("2d")!
    context.clearRect(0, 0, canvas.width, canvas.height)
    bars.forEach((bar, i) => context.fillRect(i, canvas.height - bar, 1, bar))
    requestAnimationFrame(draw)
  }
  draw()
  music.play(await audio.load("/sounds/theme.mp3"))
  // #endregion promise
}
