import { createElement } from "react"
import type { ReactElement } from "react"
import { act, create } from "react-test-renderer"
import type { ReactTestRenderer } from "react-test-renderer"
import { afterEach, assert, beforeAll, describe, it, vi } from "vitest"
import { Sound } from "../src/index.ts"
import { createAudio } from "../src/promise.ts"
import type { PromiseAudio, PromiseGroup } from "../src/promise.ts"
import { AudioProvider, useAudio, useGroup, useSound } from "../src/react.ts"
import type { SoundState } from "../src/react.ts"
import { FakeAudioContextLive, makeFakeContext } from "../src/testing.ts"

const buffer = { duration: 1 } as AudioBuffer
const loop = new Sound({ buffer, source: "loop.wav" })

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const setup = () => {
  const ctx = makeFakeContext({ decodeAudioData: () => Promise.resolve(buffer) })
  return { ctx, platform: FakeAudioContextLive(ctx) }
}

const render = async (element: ReactElement): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(element)
  })
  return renderer
}

const flush = () => act(async () => {})

describe("AudioProvider", () => {
  it("creates the audio after the first render and hands it to the hooks", async () => {
    const { platform } = setup()
    let seen: PromiseAudio | undefined
    const Probe = () => {
      seen = useAudio()
      return null
    }
    const renderer = await render(createElement(AudioProvider, { platform }, createElement(Probe)))
    assert.isDefined(seen)
    await act(async () => renderer.unmount())
  })

  it("shows the fallback until the audio exists, then the children", async () => {
    const { platform } = setup()
    const first: Array<string> = []
    const Child = () => {
      first.push("child")
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(
        createElement(
          AudioProvider,
          { platform, fallback: createElement("p", null, "wait") },
          createElement(Child)
        )
      )
    })
    assert.deepStrictEqual(first, ["child"])
    await act(async () => renderer.unmount())
  })

  it("renders nothing without a fallback and disposes the audio on unmount", async () => {
    const { ctx, platform } = setup()
    let seen: PromiseAudio | undefined
    const Probe = () => {
      seen = useAudio()
      return null
    }
    const empty = await render(createElement(AudioProvider, { platform }))
    assert.isNull(empty.toJSON())
    await act(async () => empty.unmount())
    const renderer = await render(createElement(AudioProvider, { platform }, createElement(Probe)))
    seen?.play(loop)
    assert.strictEqual(ctx.sources[0]?.stops, 0)
    await act(async () => renderer.unmount())
    await vi.waitFor(() => assert.strictEqual(ctx.sources[0]?.stops, 1))
  })

  it("uses the audio it is given and leaves it alone", async () => {
    const { ctx, platform } = setup()
    const audio = createAudio(platform)
    let seen: PromiseAudio | undefined
    const Probe = () => {
      seen = useAudio()
      return null
    }
    const renderer = await render(createElement(AudioProvider, { audio }, createElement(Probe)))
    assert.strictEqual(seen, audio)
    audio.play(loop)
    await act(async () => renderer.unmount())
    await flush()
    assert.strictEqual(ctx.sources[0]?.stops, 0)
    await audio.dispose()
    assert.strictEqual(ctx.sources[0]?.stops, 1)
  })

  it("creates a new audio when the platform changes and disposes the old one", async () => {
    const one = setup()
    const two = setup()
    const seen: Array<PromiseAudio> = []
    const Probe = () => {
      seen.push(useAudio())
      return null
    }
    const renderer = await render(
      createElement(AudioProvider, { platform: one.platform }, createElement(Probe))
    )
    seen[0]?.play(loop)
    await act(async () => {
      renderer.update(
        createElement(AudioProvider, { platform: two.platform }, createElement(Probe))
      )
    })
    await vi.waitFor(() => assert.strictEqual(one.ctx.sources[0]?.stops, 1))
    assert.notStrictEqual(seen[0], seen.at(-1))
    await act(async () => renderer.unmount())
  })
})

describe("useAudio", () => {
  it("throws outside a provider", () => {
    const Probe = () => {
      useAudio()
      return null
    }
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      assert.throws(() => create(createElement(Probe)), /inside an <AudioProvider>/)
    } finally {
      error.mockRestore()
    }
  })
})

describe("useGroup", () => {
  it("gives the same group on every render", async () => {
    const { platform } = setup()
    const groups: Array<PromiseGroup> = []
    const Probe = () => {
      groups.push(useGroup("music"))
      return null
    }
    const renderer = await render(createElement(AudioProvider, { platform }, createElement(Probe)))
    await act(async () => {
      renderer.update(createElement(AudioProvider, { platform }, createElement(Probe)))
    })
    assert.isAbove(groups.length, 1)
    assert.isTrue(groups.every((group) => group === groups[0]))
    await act(async () => renderer.unmount())
  })
})

describe("useSound", () => {
  const stubFetch = () =>
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(new ArrayBuffer(4))))

  it("loads the sound, then plays it", async () => {
    stubFetch()
    const { ctx, platform } = setup()
    const states: Array<SoundState> = []
    const Probe = () => {
      states.push(useSound("https://x/hit.wav"))
      return null
    }
    const renderer = await render(createElement(AudioProvider, { platform }, createElement(Probe)))
    await flush()
    assert.strictEqual(states[0]?.status, "loading")
    assert.isUndefined(states[0]?.play())
    const ready = states.at(-1)
    assert.strictEqual(ready?.status, "ready")
    assert.strictEqual(ready?.sound?.buffer, buffer)
    assert.isDefined(ready?.play({ volume: 0.5 }))
    assert.strictEqual(ctx.sources.length, 1)
    await act(async () => renderer.unmount())
  })

  it("reports a failed load", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")))
    const { platform } = setup()
    const states: Array<SoundState> = []
    const Probe = () => {
      states.push(useSound("https://x/hit.wav"))
      return null
    }
    const renderer = await render(createElement(AudioProvider, { platform }, createElement(Probe)))
    await flush()
    const failed = states.at(-1)
    assert.strictEqual(failed?.status, "error")
    assert.isDefined(failed?.error)
    assert.isUndefined(failed?.sound)
    await act(async () => renderer.unmount())
  })

  it("starts again when the url changes and forgets the previous sound at once", async () => {
    stubFetch()
    const { platform } = setup()
    const states: Array<SoundState> = []
    const Probe = ({ url }: { readonly url: string }) => {
      states.push(useSound(url))
      return null
    }
    const tree = (url: string) =>
      createElement(AudioProvider, { platform }, createElement(Probe, { url }))
    const renderer = await render(tree("https://x/a.wav"))
    await flush()
    assert.strictEqual(states.at(-1)?.status, "ready")
    const before = states.length
    await act(async () => {
      renderer.update(tree("https://x/b.wav"))
    })
    assert.strictEqual(states[before]?.status, "loading")
    await flush()
    assert.strictEqual(states.at(-1)?.status, "ready")
    await act(async () => renderer.unmount())
  })

  it("ignores a load that finishes after the component went away", async () => {
    let finish!: (response: Response) => void
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (finish = resolve)))
    const { platform } = setup()
    const audio = createAudio(platform)
    const load = vi.spyOn(audio, "load")
    const states: Array<SoundState> = []
    const Probe = () => {
      states.push(useSound("https://x/a.wav"))
      return null
    }
    const renderer = await render(createElement(AudioProvider, { audio }, createElement(Probe)))
    await act(async () => renderer.unmount())
    finish(new Response(new ArrayBuffer(4)))
    await Promise.resolve(load.mock.results[0]?.value).catch(() => {})
    await flush()
    assert.isTrue(states.every((state) => state.status === "loading"))
    await audio.dispose()
  })

  it("ignores a failure that arrives after the component went away", async () => {
    let fail!: (error: unknown) => void
    vi.stubGlobal("fetch", () => new Promise<Response>((_, reject) => (fail = reject)))
    const { platform } = setup()
    const states: Array<SoundState> = []
    const Probe = () => {
      states.push(useSound("https://x/a.wav"))
      return null
    }
    const renderer = await render(createElement(AudioProvider, { platform }, createElement(Probe)))
    await act(async () => renderer.unmount())
    fail(new TypeError("offline"))
    await flush()
    assert.isTrue(states.every((state) => state.status === "loading"))
  })
})
