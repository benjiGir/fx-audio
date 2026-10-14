import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import { AudioContextService } from "../src/context.ts"
import type { AudioContextLike } from "../src/context.ts"
import { decode, play } from "../src/core.ts"
import { NodeLive } from "../src/node.ts"

// Fixtures are generated at run time with ffmpeg: nothing binary is committed.
const formats: ReadonlyArray<{ name: string; file: string; args: string[] }> = [
  { name: "wav (pcm16)", file: "a.wav", args: ["-c:a", "pcm_s16le"] },
  { name: "mp3", file: "a.mp3", args: ["-c:a", "libmp3lame"] },
  { name: "ogg (vorbis)", file: "a.ogg", args: ["-c:a", "libvorbis"] },
  { name: "ogg (opus)", file: "a.opus", args: ["-c:a", "libopus"] },
  { name: "webm (opus)", file: "a.webm", args: ["-c:a", "libopus"] },
  { name: "flac", file: "a.flac", args: ["-c:a", "flac"] },
  { name: "m4a (aac, moov first)", file: "a.m4a", args: ["-c:a", "aac", "-movflags", "+faststart"] },
  { name: "m4a (aac, fragmented)", file: "b.m4a", args: ["-c:a", "aac", "-movflags", "+frag_keyframe+empty_moov"] }
]

const dir = mkdtempSync(join(tmpdir(), "fx-audio-"))
try {
  const rows: string[] = []
  for (const format of formats) {
    const path = join(dir, format.file)
    try {
      execFileSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=44100", "-ac", "2", ...format.args, path],
        { stdio: "pipe" }
      )
    } catch {
      rows.push(`| ${format.name} | not generated (ffmpeg lacks encoder) | | | |`)
      continue
    }
    const bytes = readFileSync(path)
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const outcome = await Effect.runPromise(
      decode(arrayBuffer, format.file).pipe(
        Effect.map((sound) => ({ ok: true as const, buffer: sound.buffer })),
        Effect.catchTag("LoadError", (error) => Effect.succeed({ ok: false as const, reason: error.reason })),
        Effect.provide(NodeLive({ silent: true })),
        Effect.scoped
      )
    )
    if (outcome.ok) {
      const { buffer } = outcome
      rows.push(`| ${format.name} | ok | ${buffer.duration.toFixed(3)} s | ${buffer.numberOfChannels} | ${buffer.sampleRate} Hz |`)
    } else {
      rows.push(`| ${format.name} | LoadError: ${outcome.reason} | | | |`)
    }
  }
  console.log("Node decodeAudioData through the fx-audio core (node-web-audio-api)")
  console.log("| Format | Result | Duration | Channels | Sample rate |")
  console.log("| --- | --- | --- | --- | --- |")
  for (const row of rows) console.log(row)

  // Real signal: render play() + fadeTo() offline and inspect the samples.
  // The voice lives in a Scope: it must stay open until rendering is done.
  const { OfflineAudioContext } = await import("node-web-audio-api")
  const wav = readFileSync(join(dir, "a.wav"))
  const wavBytes = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer

  const render = async (options: { volume: number; fadeToZero: boolean }) => {
    const offline = new OfflineAudioContext(2, 44100, 44100)
    const ctx: AudioContextLike = Object.assign(offline as unknown as AudioContextLike, {
      close: () => Promise.resolve()
    })
    const layer = Layer.succeed(AudioContextService, { ctx })
    const scope = Effect.runSync(Scope.make())
    await Effect.runPromise(
      Effect.gen(function* () {
        const sound = yield* decode(wavBytes, "a.wav")
        const voice = yield* play(sound, { volume: options.volume })
        if (options.fadeToZero) yield* voice.fadeTo(0, "1 second")
      }).pipe(Effect.provide(layer), Effect.provideService(Scope.Scope, scope))
    )
    const rendered = await offline.startRendering()
    await Effect.runPromise(Scope.close(scope, Exit.void))
    const data = rendered.getChannelData(0)
    return (from: number, to: number) => {
      let max = 0
      for (let i = from; i < to; i++) max = Math.max(max, Math.abs(data[i] ?? 0))
      return max
    }
  }

  const reference = await render({ volume: 1, fadeToZero: false })
  const faded = await render({ volume: 0.5, fadeToZero: true })
  const full = reference(0, 44100)
  const ratio = (from: number, to: number) => (faded(from, to) / full).toFixed(3)
  console.log("\nOffline render, ratio to an unfaded volume-1 reference (peak %s)", full.toFixed(3))
  console.log("play({ volume: 0.5 }) then fadeTo(0, 1 s):")
  console.log(`  0-50 ms ratio ${ratio(0, 2205)} (expect ~0.5)`)
  console.log(`  475-525 ms ratio ${ratio(20947, 23152)} (expect ~0.25)`)
  console.log(`  950-1000 ms ratio ${ratio(41895, 44100)} (expect ~0.0)`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
