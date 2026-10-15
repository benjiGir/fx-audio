// The engine of the playground page: the real fx-audio Promise facade, with no UI in it.
// The sounds come from scripts/make-playground-sounds.mjs; keep the sprite offsets in sync.
import { SpriteSegment, SpriteSheet } from "fx-audio"
import { createAudio, type PromiseGroup, type PromiseVoice } from "fx-audio/promise"

/** Sprites of `effects.wav`, in milliseconds. */
export const effectSegments = {
  jump: { start: 0, duration: 300 },
  coin: { start: 400, duration: 400 },
  boom: { start: 900, duration: 800 }
} as const

export type EffectName = keyof typeof effectSegments
export type GroupName = "music" | "effects" | "master"

/** Where a voice sits on the 3D pad: x to the right, z towards the listener, in metres. */
export interface Point {
  readonly x: number
  readonly z: number
}

const describe = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

/**
 * Build the audio engine. Call it from a user gesture: the browser keeps audio suspended before.
 * Every call made on fx-audio is also reported to `log`, as the line of code that did it.
 */
export const createPlayground = async (base: string, log: (line: string) => void) => {
  const audio = createAudio()
  await audio.resume()
  const [effects, blip] = await Promise.all([
    audio.load(`${base}sounds/effects.wav`),
    audio.load(`${base}sounds/blip.wav`)
  ])
  log(`const effects = await audio.load("sounds/effects.wav")`)

  const sheet = new SpriteSheet({
    sound: effects,
    segments: Object.fromEntries(
      Object.entries(effectSegments).map(([name, s]) => [name, new SpriteSegment(s)])
    )
  })
  const groups: Record<GroupName, PromiseGroup> = {
    music: audio.group("music"),
    effects: audio.group("effects"),
    master: audio.master
  }
  const muted: Record<GroupName, boolean> = { music: false, effects: false, master: false }
  let music: PromiseVoice | undefined
  const loops: { pan?: PromiseVoice; space?: PromiseVoice } = {}

  /** Run `action`, report the line of code it stands for, and turn a failure into a log line. */
  const run = async (line: string, action: () => unknown) => {
    try {
      await action()
      log(line)
    } catch (error) {
      log(`// ${describe(error)}`)
    }
  }

  return {
    playEffect: (name: EffectName) =>
      run(`effects.playSprite(sheet, "${name}")`, () => groups.effects.playSprite(sheet, name)),

    get musicPlaying() {
      return music !== undefined
    },
    startMusic: () =>
      run(`await music.stream("sounds/music.wav", { loop: true })`, async () => {
        music?.stop()
        music = await groups.music.stream(`${base}sounds/music.wav`, { loop: true })
      }),
    stopMusic: () =>
      run(`musicVoice.stop()`, () => {
        music?.stop()
        music = undefined
      }),

    setVolume: (group: GroupName, volume: number) =>
      run(`${group}.setVolume(${volume.toFixed(2)})`, () => groups[group].setVolume(volume)),
    fadeTo: (group: GroupName, volume: number, milliseconds: number) =>
      run(`${group}.fadeTo(${volume.toFixed(2)}, ${milliseconds})`, () =>
        groups[group].fadeTo(volume, milliseconds)
      ),
    toggleMute: (group: GroupName) => {
      const next = !muted[group]
      muted[group] = next
      void run(`${group}.${next ? "mute" : "unmute"}()`, () =>
        next ? groups[group].mute() : groups[group].unmute()
      )
      return next
    },

    /** A looping ping to hear the stereo pan. */
    startPan: (pan: number) =>
      run(`const voice = effects.play(blip, { loop: true, pan: ${pan.toFixed(2)} })`, () => {
        loops.pan?.stop()
        loops.pan = groups.effects.play(blip, { loop: true, pan })
      }),
    setPan: (pan: number) =>
      run(`voice.setPan(${pan.toFixed(2)})`, () => {
        loops.pan?.setPan(pan)
      }),
    stopPan: () =>
      run(`voice.stop()`, () => {
        loops.pan?.stop()
        delete loops.pan
      }),

    /** A looping ping in 3D, heard from the listener standing at the origin and facing -z. */
    startSpace: ({ x, z }: Point) =>
      run(
        `const voice = effects.play(blip, { loop: true, spatial: { position: { x: ${x.toFixed(1)}, y: 0, z: ${z.toFixed(1)} } } })`,
        () => {
          loops.space?.stop()
          loops.space = groups.effects.play(blip, {
            loop: true,
            spatial: { position: { x, y: 0, z } }
          })
        }
      ),
    setPosition: ({ x, z }: Point) =>
      run(`voice.setPosition({ x: ${x.toFixed(1)}, y: 0, z: ${z.toFixed(1)} })`, () => {
        loops.space?.setPosition({ x, y: 0, z })
      }),
    stopSpace: () =>
      run(`voice.stop()`, () => {
        loops.space?.stop()
        delete loops.space
      }),

    dispose: async () => {
      await audio.dispose()
    }
  }
}

export type Playground = Awaited<ReturnType<typeof createPlayground>>
