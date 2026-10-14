import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { afterEach, vi } from "vitest"
import { Audio, AudioContextService } from "../src/index.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

const stubAudioContext = () => {
  const close = vi.fn(() => Promise.resolve())
  const instances: Array<unknown> = []
  vi.stubGlobal(
    "AudioContext",
    class {
      close = close
      constructor() {
        instances.push(this)
      }
    }
  )
  return { close, instances }
}

describe("AudioContextService.layerBrowser", () => {
  it.effect("builds one AudioContext and closes it with the scope", () =>
    Effect.gen(function* () {
      const { close, instances } = stubAudioContext()
      const ctx = yield* Effect.gen(function* () {
        return (yield* AudioContextService).ctx
      }).pipe(Effect.provide(AudioContextService.layerBrowser))
      assert.strictEqual(instances.length, 1)
      assert.strictEqual(ctx, instances[0])
      assert.strictEqual(close.mock.calls.length, 1)
    })
  )
})

describe("Audio.layer", () => {
  it.effect("provides the service on the browser context", () =>
    Effect.gen(function* () {
      const { instances } = stubAudioContext()
      yield* Audio.use(() => Effect.void).pipe(Effect.provide(Audio.layer))
      assert.strictEqual(instances.length, 1)
    })
  )
})
