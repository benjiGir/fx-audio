// Code samples of the "Migrating from Howler" page, compiled by `pnpm typecheck`.
import { SpriteSegment, SpriteSheet } from "fx-audio"
import { createAudio } from "fx-audio/promise"

const audio = createAudio()

export const basic = async () => {
  // #region basic
  const sound = await audio.load("/sounds/hit.mp3")
  const voice = audio.play(sound, { volume: 0.8, rate: 1.2, loop: false })
  await voice.ended // Howler's "end" event
  // #endregion basic
}

export const sprites = async () => {
  // #region sprites
  const sheet = new SpriteSheet({
    sound: await audio.load("/sounds/effects.mp3"),
    segments: {
      hit: new SpriteSegment({ start: 0, duration: 400 }),
      engine: new SpriteSegment({ start: 500, duration: 2000, loop: true })
    }
  })
  audio.playSprite(sheet, "hit")
  // #endregion sprites
}

export const fade = async () => {
  const sound = await audio.load("/sounds/theme.mp3")
  // #region fade
  const voice = audio.play(sound)
  voice.fadeTo(0, 2) // from the current volume to 0, in seconds
  voice.stop()
  // #endregion fade
}

export const groups = () => {
  // #region groups
  const music = audio.group("music")
  music.setVolume(0.4)
  music.fadeTo(0, 2)
  music.mute()

  audio.master.setVolume(0.5) // Howler.volume(0.5)
  audio.master.mute() // Howler.mute(true)
  // #endregion groups
}

export const spatial = async () => {
  const sound = await audio.load("/sounds/engine.mp3")
  // #region spatial
  const voice = audio.play(sound, {
    spatial: { position: { x: 4, y: 0, z: -2 }, panningModel: "HRTF", refDistance: 2 }
  })
  voice.setPosition({ x: -4, y: 0, z: -2 })
  audio.listener.setPosition({ x: 1, y: 0, z: 0 })
  audio.listener.setOrientation({ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 })
  // #endregion spatial
}

export const stream = async () => {
  // #region stream
  const voice = await audio.stream("/music/theme.mp3", { loop: true })
  voice.stop()
  // #endregion stream
}
