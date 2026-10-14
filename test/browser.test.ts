import * as Effect from "effect/Effect"
import { afterEach, assert, describe, it, vi } from "vitest"
import { AudioContextService, BrowserLive } from "../src/index.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("BrowserLive", () => {
  it("builds one AudioContext and closes it with the scope", async () => {
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
    const ctx = await Effect.runPromise(
      Effect.gen(function* () {
        return (yield* AudioContextService).ctx
      }).pipe(Effect.provide(BrowserLive))
    )
    assert.strictEqual(instances.length, 1)
    assert.strictEqual(ctx, instances[0])
    assert.strictEqual(close.mock.calls.length, 1)
  })
})
