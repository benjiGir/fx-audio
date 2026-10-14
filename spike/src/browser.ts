import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { AudioContextService } from "./context.ts"
import type { AudioContextLike } from "./context.ts"

/** Browser layer: one AudioContext per layer build, closed with its scope. */
export const BrowserLive: Layer.Layer<AudioContextService> = Layer.effect(
  AudioContextService,
  Effect.acquireRelease(
    Effect.sync(() => ({ ctx: new AudioContext() as unknown as AudioContextLike })),
    ({ ctx }) => Effect.promise(() => ctx.close())
  )
)
