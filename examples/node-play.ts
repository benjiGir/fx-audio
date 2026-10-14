// Play one sound file on the machine's speakers, or on no device at all with SILENT=1.
//   pnpm build && node examples/node-play.ts path/to/sound.wav
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Audio, AudioLive } from "fx-audio"
import { NodeAudioContextLive } from "fx-audio/node"

const file = process.argv[2]
if (file === undefined) {
  console.error("usage: node examples/node-play.ts <sound file>")
  process.exit(1)
}

const program = Effect.gen(function* () {
  const audio = yield* Audio
  // A path (relative to the working directory) or a file: URL both work under Node.
  const sound = yield* audio.load(file)
  console.log(`loaded ${sound.source}, ${sound.buffer.duration.toFixed(2)} s`)
  const voice = yield* audio.play(sound, { volume: 0.8 })
  yield* voice.ended
}).pipe(
  // Decoding and network problems are typed: say what went wrong instead of a stack trace.
  Effect.catchTag("LoadError", (error) =>
    Effect.sync(() => {
      console.error(`could not load ${error.source}: ${error.reason._tag}`)
      process.exitCode = 1
    })
  ),
  Effect.scoped,
  Effect.provide(
    AudioLive.pipe(Layer.provide(NodeAudioContextLive({ silent: process.env.SILENT === "1" })))
  )
)

Effect.runPromise(program)
