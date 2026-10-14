// Runs inside a real browser: what one play() call costs the calling thread, Howler and fx-audio.
import { Howl } from "howler"
import { createAudio } from "../src/promise.ts"
import { makeWav } from "../test/helpers/wav.ts"

const BATCH = 100
const WARMUP = 5
const ROUNDS = 60

interface Scenario {
  readonly name: string
  /** Starts one voice and returns what stops it. */
  readonly howler: (howl: Howl) => () => void
  readonly fx: (
    audio: ReturnType<typeof createAudio>,
    sound: Awaited<ReturnType<ReturnType<typeof createAudio>["load"]>>
  ) => () => void
}

const scenarios: ReadonlyArray<Scenario> = [
  {
    name: "play",
    howler: (howl) => {
      const id = howl.play()
      return () => howl.stop(id)
    },
    fx: (audio, sound) => {
      const voice = audio.play(sound)
      return () => voice.stop()
    }
  },
  {
    name: "play with volume and rate",
    howler: (howl) => {
      const id = howl.play()
      howl.volume(0.5, id)
      howl.rate(1.2, id)
      return () => howl.stop(id)
    },
    fx: (audio, sound) => {
      const voice = audio.play(sound, { volume: 0.5, rate: 1.2 })
      return () => voice.stop()
    }
  },
  {
    name: "play with stereo pan",
    howler: (howl) => {
      const id = howl.play()
      howl.stereo(0.5, id)
      return () => howl.stop(id)
    },
    fx: (audio, sound) => {
      const voice = audio.play(sound, { pan: 0.5 })
      return () => voice.stop()
    }
  }
]

const percentile = (sorted: ReadonlyArray<number>, p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? Number.NaN

const batch = (start: () => () => void) => {
  const stops: Array<() => void> = []
  const t0 = performance.now()
  for (let i = 0; i < BATCH; i++) stops.push(start())
  const elapsed = performance.now() - t0
  for (const stop of stops) stop()
  return (elapsed / BATCH) * 1000
}

/**
 * Mean cost of one call in microseconds, per batch of calls: batches, not single calls, because
 * some engines coarsen the clock. The two libraries take turns every round, so a drift in the
 * machine's load or in the engine's warm-up hits both alike.
 */
const compare = (a: () => () => void, b: () => () => void) => {
  const first: Array<number> = []
  const second: Array<number> = []
  for (let round = 0; round < WARMUP + ROUNDS; round++) {
    const x = batch(a)
    const y = batch(b)
    if (round >= WARMUP) {
      first.push(x)
      second.push(y)
    }
  }
  const summary = (values: Array<number>) => {
    const sorted = [...values].sort((p, q) => p - q)
    return { median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) }
  }
  return { howler: summary(first), fx: summary(second) }
}

export const run = async () => {
  const url = URL.createObjectURL(new Blob([makeWav(0.5, 44100)], { type: "audio/wav" }))

  const howl = new Howl({ src: [url], format: ["wav"] })
  await new Promise<void>((resolve, reject) => {
    howl.once("load", () => resolve())
    howl.once("loaderror", (_id, error) => reject(new Error(String(error))))
  })
  const audio = createAudio()
  const sound = await audio.load(url)
  await audio.resume()

  const results = scenarios.map((scenario) => ({
    scenario: scenario.name,
    ...compare(
      () => scenario.howler(howl),
      () => scenario.fx(audio, sound)
    )
  }))
  return { results, contextState: Howler.ctx.state }
}
