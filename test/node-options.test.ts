import * as Effect from "effect/Effect"
import { assert, beforeEach, describe, it, vi } from "vitest"
import { AudioContextService } from "../src/index.ts"
import { NodeLive } from "../src/node.ts"

const created: Array<{ options: unknown; closed: boolean }> = []

vi.mock("node-web-audio-api", () => ({
  AudioContext: class {
    closed = false
    options: unknown
    constructor(options: unknown) {
      this.options = options
      created.push(this)
    }
    close() {
      this.closed = true
      return Promise.resolve()
    }
  }
}))

const build = (layer: ReturnType<typeof NodeLive>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return (yield* AudioContextService).ctx
    }).pipe(Effect.provide(layer))
  )

describe("NodeLive options", () => {
  beforeEach(() => {
    created.length = 0
  })

  it("uses the default output device unless silent is requested", async () => {
    await build(NodeLive())
    assert.deepStrictEqual(created[0]?.options, {})
  })

  it("asks for no output device when silent", async () => {
    await build(NodeLive({ silent: true }))
    assert.deepStrictEqual(created[0]?.options, { sinkId: { type: "none" } })
  })

  it("closes the context with the scope", async () => {
    await build(NodeLive())
    assert.isTrue(created[0]?.closed)
  })
})
