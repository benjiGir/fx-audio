import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { beforeEach, vi } from "vitest"
import { AudioContextService } from "../src/index.ts"
import { layerNode } from "../src/node.ts"

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

const build = (layer: ReturnType<typeof layerNode>) =>
  Effect.gen(function* () {
    return (yield* AudioContextService).ctx
  }).pipe(Effect.provide(layer))

describe("layerNode options", () => {
  beforeEach(() => {
    created.length = 0
  })

  it.effect("uses the default output device unless silent is requested", () =>
    Effect.gen(function* () {
      yield* build(layerNode())
      assert.deepStrictEqual(created[0]?.options, {})
    })
  )

  it.effect("asks for no output device when silent", () =>
    Effect.gen(function* () {
      yield* build(layerNode({ silent: true }))
      assert.deepStrictEqual(created[0]?.options, { sinkId: { type: "none" } })
    })
  )

  it.effect("closes the context with the scope", () =>
    Effect.gen(function* () {
      yield* build(layerNode())
      assert.isTrue(created[0]?.closed)
    })
  )
})
