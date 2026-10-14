import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { AudioContextLike } from "./context.ts"
import { AudioContextService } from "./context.ts"

const readLocalFile = async (location: string, signal: AbortSignal): Promise<ArrayBuffer> => {
  const path = location.startsWith("file:") ? fileURLToPath(location) : location
  const bytes = await readFile(path, { signal })
  // A Buffer may be a view into a larger shared pool: copy out exactly its bytes.
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/**
 * Node layer backed by `node-web-audio-api` (loaded lazily so browser users
 * never install or bundle it). `silent` avoids needing a sound card.
 * Sounds load from disk: `Audio.load` takes a path (relative to the working directory)
 * or a `file:` URL, such as `new URL("./hit.wav", import.meta.url).href`.
 */
export const NodeAudioContextLive = (
  options: { readonly silent?: boolean } = {}
): Layer.Layer<AudioContextService> =>
  Layer.effect(
    AudioContextService,
    Effect.gen(function* () {
      const ctx = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const { AudioContext } = await import("node-web-audio-api")
          // `sinkId: { type: "none" }` is a node-web-audio-api extension absent from DOM typings.
          const contextOptions = options.silent === true ? { sinkId: { type: "none" } } : {}
          return new AudioContext(
            contextOptions as AudioContextOptions
          ) as unknown as AudioContextLike
        }),
        (ctx) => Effect.promise(() => ctx.close())
      )
      return AudioContextService.of({ ctx, readFile: readLocalFile })
    })
  )
