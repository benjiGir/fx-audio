import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { AudioContextLike } from "./context.ts"
import { AudioContextService } from "./context.ts"

/**
 * Node layer backed by `node-web-audio-api` (loaded lazily so browser users
 * never install or bundle it). `silent` avoids needing a sound card.
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
      return AudioContextService.of({ ctx })
    })
  )
