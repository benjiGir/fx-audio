// A small HTTP server that plays sounds from a folder when asked, with the promise facade.
// No Effect needed in your own code.
//   pnpm build && node examples/node-server.ts path/to/sounds
//   curl localhost:3000/play/doorbell      # plays doorbell.wav
//   curl -X POST localhost:3000/volume/0.3 # master volume
import { readdir } from "node:fs/promises"
import { createServer } from "node:http"
import { basename, extname, join } from "node:path"
import { NodeAudioContextLive } from "fx-audio/node"
import { createAudioAsync } from "fx-audio/promise"

const folder = process.argv[2]
if (folder === undefined) {
  console.error("usage: node examples/node-server.ts <folder of sounds>")
  process.exit(1)
}

// The Node layer builds its audio context on demand, so the facade is created asynchronously.
const audio = await createAudioAsync(NodeAudioContextLive({ silent: process.env.SILENT === "1" }))

const sounds = new Map<string, Awaited<ReturnType<typeof audio.load>>>()
for (const name of await readdir(folder)) {
  if (![".wav", ".mp3", ".ogg", ".flac"].includes(extname(name))) continue
  sounds.set(basename(name, extname(name)), await audio.load(join(folder, name)))
}
console.log(`loaded: ${[...sounds.keys()].join(", ")}`)

const server = createServer((request, response) => {
  const [, action, argument] = (request.url ?? "").split("/")
  const sound = sounds.get(argument ?? "")
  if (request.method === "GET" && action === "play" && sound !== undefined) {
    audio.group("effects").play(sound)
    response.end("playing\n")
  } else if (
    request.method === "POST" &&
    action === "volume" &&
    Number.isFinite(Number(argument))
  ) {
    audio.master.setVolume(Number(argument))
    response.end("ok\n")
  } else {
    response.statusCode = 404
    response.end("not found\n")
  }
})
server.listen(3000, () => console.log("listening on http://localhost:3000"))

process.on("SIGINT", async () => {
  server.close()
  await audio.dispose()
  process.exit(0)
})
