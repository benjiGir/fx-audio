import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { afterAll } from "vitest"
import { Audio, AudioContextService, AudioLive } from "../src/index.ts"
import { NodeAudioContextLive } from "../src/node.ts"
import { createAudio, createAudioAsync } from "../src/promise.ts"
import { makeWav } from "./helpers/wav.ts"

const nodeAudio = AudioLive.pipe(Layer.provide(NodeAudioContextLive({ silent: true })))

describe("NodeAudioContextLive (real engine, no sound card)", () => {
  it.live("decodes a WAV and plays it to the end", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.decode(makeWav(0.1), "tone.wav")
      assert.closeTo(sound.buffer.duration, 0.1, 0.001)
      const voice = yield* audio.play(sound, { volume: 0.5 })
      yield* voice.ended
    }).pipe(Effect.scoped, Effect.provide(nodeAudio))
  )

  it.live("reports undecodable bytes as a typed load error", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.decode(new ArrayBuffer(64), "garbage.bin"))
      assert.strictEqual(error._tag, "LoadError")
      assert.include(["DecodeFailure", "UnsupportedFormat"], error.reason._tag)
    }).pipe(Effect.provide(nodeAudio))
  )

  // node-web-audio-api has no Opus decoder. The core reports that as a typed
  // `UnsupportedFormat` so callers can fall back to another codec. If this test
  // starts failing after an engine upgrade, Opus works and the doc can say so.
  it.live("reports Opus as UnsupportedFormat", () =>
    Effect.gen(function* () {
      const bytes = readFileSync(new URL("./fixtures/tone.opus", import.meta.url))
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.decode(copy as ArrayBuffer, "tone.opus"))
      assert.strictEqual(error.source, "tone.opus")
      assert.strictEqual(error.reason._tag, "UnsupportedFormat")
    }).pipe(Effect.provide(nodeAudio))
  )
})

describe("loading from disk under Node", () => {
  const directory = mkdtempSync(join(tmpdir(), "fx-audio-"))
  const wav = join(directory, "tone.wav")
  writeFileSync(wav, new Uint8Array(makeWav(0.1)))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  it.live("loads a file by its absolute path", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.load(wav)
      assert.strictEqual(sound.source, wav)
      assert.closeTo(sound.buffer.duration, 0.1, 0.001)
    }).pipe(Effect.provide(nodeAudio))
  )

  it.live("loads a file by a path relative to the working directory", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.load(relative(process.cwd(), wav))
      assert.closeTo(sound.buffer.duration, 0.1, 0.001)
    }).pipe(Effect.provide(nodeAudio))
  )

  it.live("loads a file by a file: URL, as import.meta.url builds them", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const sound = yield* audio.load(pathToFileURL(wav).href)
      assert.closeTo(sound.buffer.duration, 0.1, 0.001)
    }).pipe(Effect.provide(nodeAudio))
  )

  it.live("reports a missing file as NetworkFailure with the system error", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const missing = join(directory, "missing.wav")
      const error = yield* Effect.flip(audio.load(missing))
      assert.strictEqual(error.source, missing)
      assert.strictEqual(error.reason._tag, "NetworkFailure")
      const cause = error.reason._tag === "NetworkFailure" ? error.reason.cause : undefined
      assert.strictEqual((cause as NodeJS.ErrnoException).code, "ENOENT")
    }).pipe(Effect.provide(nodeAudio))
  )

  it.live("reports a file: URL that is not a local path as NetworkFailure", () =>
    Effect.gen(function* () {
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.load("file://remote-host/tone.wav"))
      assert.strictEqual(error.reason._tag, "NetworkFailure")
    }).pipe(Effect.provide(nodeAudio))
  )

  it.live("reports a file that is not audio as a decode failure, not a read failure", () =>
    Effect.gen(function* () {
      const text = join(directory, "notes.txt")
      writeFileSync(text, "not audio at all")
      const audio = yield* Audio
      const error = yield* Effect.flip(audio.load(text))
      assert.include(["DecodeFailure", "UnsupportedFormat"], error.reason._tag)
    }).pipe(Effect.provide(nodeAudio))
  )

  it.live("gives up on a read whose signal is already aborted", () =>
    Effect.gen(function* () {
      const { readFile } = yield* AudioContextService
      assert.isDefined(readFile)
      const error = yield* Effect.flip(
        Effect.tryPromise({
          try: () => readFile?.(wav, AbortSignal.abort()) ?? Promise.resolve(wav),
          catch: (e) => e
        })
      )
      assert.strictEqual((error as Error).name, "AbortError")
    }).pipe(Effect.provide(NodeAudioContextLive({ silent: true })))
  )

  it("loads and plays a file through the promise facade", async () => {
    const audio = await createAudioAsync(NodeAudioContextLive({ silent: true }))
    const sound = await audio.load(wav)
    await audio.play(sound).ended
    assert.isAbove(sound.buffer.duration, 0)
    await audio.dispose()
  })
})

describe("the promise facade under Node", () => {
  it("cannot be built synchronously on a layer that builds asynchronously", () => {
    assert.throws(() => createAudio(NodeAudioContextLive({ silent: true })), /asynchronous/i)
  })
})
