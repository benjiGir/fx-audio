// Generates the sounds of the docs playground: `node scripts/make-playground-sounds.mjs`.
// They are synthesized here, so they carry no third-party licence (MIT, like the rest of the repository).
//
//   effects.wav  three effects in one file, played as sprites (offsets below are in milliseconds,
//                keep them in sync with docs/.vitepress/theme/playground.ts)
//   blip.wav     a short ping that loops, to hear pan and 3D position
//   music.wav    a six second arpeggio that loops seamlessly, streamed by the playground
import { mkdirSync, writeFileSync } from "node:fs"

const rate = 22050
const out = new URL("../docs/public/sounds/", import.meta.url)

const wav = (samples) => {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) =>
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2)
  )
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write("WAVEfmt ", 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const seconds = (n) => new Float64Array(Math.round(n * rate))
const at = (ms) => Math.round((ms / 1000) * rate)

/** Add `fn(t)` (seconds since the start of the note) to `track` from `startMs` for `lengthMs`. */
const note = (track, startMs, lengthMs, fn) => {
  const start = at(startMs)
  const length = at(lengthMs)
  for (let i = 0; i < length && start + i < track.length; i++)
    track[start + i] += fn(i / rate, i / length)
}

const tone =
  (freq, shape = Math.sin) =>
  (t) =>
    shape(2 * Math.PI * freq * t)
const triangle = (x) => (2 / Math.PI) * Math.asin(Math.sin(x))
const decay = (k) => (p) => (1 - p) ** k
const attack = (p, n = 0.02) => Math.min(1, p / n)

// Pseudo-random but repeatable noise.
let seed = 12345
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 31 - 1
}

// --- effects -------------------------------------------------------------------------------
const effects = seconds(1.8)
// jump: 0 to 300 ms, a rising sweep
note(effects, 0, 300, (t, p) => {
  const chirp = 2 * Math.PI * (300 * t + (500 / (2 * 0.3)) * t * t) // 300 Hz to 800 Hz in 300 ms
  return 0.5 * Math.sin(chirp) * decay(1.5)(p)
})
// coin: 400 to 800 ms, two notes
note(effects, 400, 120, (t, p) => 0.4 * tone(988, triangle)(t) * decay(0.5)(p))
note(effects, 520, 280, (t, p) => 0.4 * tone(1319, triangle)(t) * decay(2)(p))
// boom: 900 to 1700 ms, low-passed noise with a falling thump
let low = 0
note(effects, 900, 800, (t, p) => {
  low += 0.12 * (noise() - low)
  return (0.3 * low * 3 + 0.25 * Math.sin(2 * Math.PI * (90 - 50 * p) * t)) * decay(2.5)(p)
})

// --- blip ----------------------------------------------------------------------------------
const blip = seconds(0.6)
note(
  blip,
  0,
  220,
  (t, p) => (0.55 * tone(660)(t) + 0.2 * tone(1320)(t)) * attack(p, 0.03) * decay(2)(p)
)

// --- music ---------------------------------------------------------------------------------
const music = seconds(6)
const chords = [
  [220, 261.63, 329.63], // Am
  [174.61, 220, 261.63], // F
  [261.63, 329.63, 392], // C
  [196, 246.94, 293.66] //  G
]
chords.forEach((chord, c) => {
  for (let n = 0; n < 6; n++) {
    const freq = [...chord, chord[2] * 2, chord[1] * 2, chord[0] * 2][n]
    note(
      music,
      c * 1500 + n * 250,
      380,
      (t, p) => 0.22 * tone(freq, triangle)(t) * attack(p, 0.04) * decay(1.6)(p)
    )
  }
  // a soft bass note under each chord
  note(
    music,
    c * 1500,
    1500,
    (t, p) => 0.18 * tone(chord[0] / 2)(t) * attack(p, 0.03) * (1 - p ** 3)
  )
})

mkdirSync(out, { recursive: true })
for (const [name, samples] of Object.entries({ effects, blip, music })) {
  writeFileSync(new URL(`${name}.wav`, out), wav(samples))
}
console.log("sounds written to docs/public/sounds/")
