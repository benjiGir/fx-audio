import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { AudioContextService } from "../src/context.ts"
import type { AudioContextLike } from "../src/context.ts"
import { play } from "../src/core.ts"
import type { Sound } from "../src/core.ts"
import { makeFakeContext } from "../src/testing.ts"

const BATCHES = Number(process.env.BATCHES ?? 60)
const PER_BATCH = Number(process.env.PER_BATCH ?? 500)
const WARMUP_BATCHES = 10

interface Variant {
  readonly name: string
  /** Runs `PER_BATCH` plays; returns a cleanup run outside the timed region. */
  readonly batch: () => { cleanup: () => void }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const percentile = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0

const measure = (variant: Variant) => {
  const perCall: number[] = []
  for (let i = 0; i < BATCHES + WARMUP_BATCHES; i++) {
    const start = process.hrtime.bigint()
    const { cleanup } = variant.batch()
    const elapsed = Number(process.hrtime.bigint() - start)
    cleanup()
    if (i >= WARMUP_BATCHES) perCall.push(elapsed / PER_BATCH)
  }
  return { median: median(perCall), p99: percentile(perCall, 0.99), best: Math.min(...perCall) }
}

const suite = (label: string, ctx: AudioContextLike, sound: Sound) => {
  const services = { ctx }
  const variants: Variant[] = [
    {
      name: "raw Web Audio calls",
      batch: () => {
        const sources: ReturnType<AudioContextLike["createBufferSource"]>[] = []
        for (let i = 0; i < PER_BATCH; i++) {
          const source = ctx.createBufferSource()
          const gain = ctx.createGain()
          source.buffer = sound.buffer
          gain.gain.value = 1
          source.connect(gain)
          gain.connect(ctx.destination)
          source.start()
          sources.push(source)
        }
        return { cleanup: () => sources.forEach((s) => { s.stop(); s.disconnect() }) }
      }
    },
    {
      name: "raw Web Audio calls + onended handler",
      batch: () => {
        const sources: ReturnType<AudioContextLike["createBufferSource"]>[] = []
        for (let i = 0; i < PER_BATCH; i++) {
          const source = ctx.createBufferSource()
          const gain = ctx.createGain()
          source.buffer = sound.buffer
          gain.gain.value = 1
          source.connect(gain)
          gain.connect(ctx.destination)
          source.onended = () => undefined
          source.start()
          sources.push(source)
        }
        return { cleanup: () => sources.forEach((s) => { s.onended = null; s.stop(); s.disconnect() }) }
      }
    },
    {
      name: "Effect.runSync(play(...)) built per call",
      batch: () => {
        const scope = Effect.runSync(Scope.make())
        for (let i = 0; i < PER_BATCH; i++) {
          Effect.runSync(
            play(sound).pipe(
              Effect.provideService(AudioContextService, services),
              Effect.provideService(Scope.Scope, scope)
            )
          )
        }
        return { cleanup: () => Effect.runSync(Scope.close(scope, Exit.void)) }
      }
    },
    (() => {
      let scope = Effect.runSync(Scope.make())
      const prebuilt = Effect.suspend(() => play(sound)).pipe(
        Effect.provideService(AudioContextService, services),
        Effect.provideService(Scope.Scope, scope)
      )
      return {
        name: "Effect.runSync(prebuilt effect)",
        batch: () => {
          scope = Effect.runSync(Scope.make())
          for (let i = 0; i < PER_BATCH; i++) {
            Effect.runSync(
              prebuilt.pipe(Effect.provideService(Scope.Scope, scope))
            )
          }
          return { cleanup: () => Effect.runSync(Scope.close(scope, Exit.void)) }
        }
      }
    })()
  ]
  console.log(`\n${label}`)
  console.log("| Variant | median | best | p99 (of batch means) |")
  console.log("| --- | ---: | ---: | ---: |")
  let base = 0
  for (const variant of variants) {
    const result = measure(variant)
    if (base === 0) base = result.median
    const us = (ns: number) => `${(ns / 1000).toFixed(2)} us`
    console.log(`| ${variant.name} | ${us(result.median)} | ${us(result.best)} | ${us(result.p99)} |`)
  }
  void base
}

const fake = makeFakeContext()
suite("Fake context (isolates the Effect overhead)", fake, { buffer: {} as AudioBuffer, source: "fake" })

if (process.env.FAKE_ONLY === "1") process.exit(0)
const { AudioContext } = await import("node-web-audio-api")
const real = new AudioContext({ sinkId: { type: "none" } } as unknown as AudioContextOptions)
const realBuffer = real.createBuffer(2, 4800, 48000)
suite(
  "Real engine: node-web-audio-api, no sink (includes native node creation)",
  real as unknown as AudioContextLike,
  { buffer: realBuffer as unknown as AudioBuffer, source: "real" }
)
await real.close()
