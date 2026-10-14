import type * as Duration from "effect/Duration"
import type * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { describe, expectTypeOf, it } from "vitest"
import type {
  AudioContextLike,
  AudioContextService,
  DecodeFailure,
  Group,
  Listener,
  LoadError,
  MediaElementLike,
  NetworkFailure,
  PlaybackBlocked,
  PlayOptions,
  Sound,
  SpriteSheet,
  StreamingUnavailable,
  UnknownSprite,
  UnsupportedFormat,
  Vector3,
  Voice
} from "../src/index.ts"
import { type Audio, AudioBrowserLive, AudioLive } from "../src/index.ts"
import type { PromiseAudio, PromiseGroup, PromiseVoice } from "../src/promise.ts"
import { createAudio, createAudioAsync } from "../src/promise.ts"

// The compiler checks these, `pnpm typecheck` fails when a public signature moves.
// `pnpm api` freezes the full surface; these pin the parts users write code against.
describe("public API types", () => {
  it("Voice", () => {
    expectTypeOf<Voice["ended"]>().toEqualTypeOf<Effect.Effect<void>>()
    expectTypeOf<Voice["stop"]>().toEqualTypeOf<Effect.Effect<void>>()
    expectTypeOf<Voice["fadeTo"]>().toEqualTypeOf<
      (volume: number, over: Duration.Input) => Effect.Effect<void>
    >()
    expectTypeOf<Voice["setPan"]>().toEqualTypeOf<(pan: number) => Effect.Effect<void>>()
    expectTypeOf<Voice["setPosition"]>().toEqualTypeOf<(position: Vector3) => Effect.Effect<void>>()
  })

  it("Group", () => {
    expectTypeOf<Group["play"]>().toEqualTypeOf<
      (sound: Sound, options?: PlayOptions) => Effect.Effect<Voice, never, Scope.Scope>
    >()
    expectTypeOf<Group["playSprite"]>().toEqualTypeOf<
      (
        sheet: SpriteSheet,
        name: string,
        options?: PlayOptions
      ) => Effect.Effect<Voice, UnknownSprite, Scope.Scope>
    >()
    expectTypeOf<Group["stream"]>().toEqualTypeOf<
      (
        url: string,
        options?: PlayOptions
      ) => Effect.Effect<Voice, LoadError | PlaybackBlocked, Scope.Scope>
    >()
    expectTypeOf<Group["setVolume"]>().toEqualTypeOf<(volume: number) => Effect.Effect<void>>()
    expectTypeOf<Group["mute"]>().toEqualTypeOf<Effect.Effect<void>>()
    expectTypeOf<Group["unmute"]>().toEqualTypeOf<Effect.Effect<void>>()
  })

  it("Listener", () => {
    expectTypeOf<Listener["setPosition"]>().toEqualTypeOf<
      (position: Vector3) => Effect.Effect<void>
    >()
    expectTypeOf<Listener["setOrientation"]>().toEqualTypeOf<
      (forward: Vector3, up: Vector3) => Effect.Effect<void>
    >()
  })

  it("Audio service", () => {
    type Service = Audio["Service"]
    expectTypeOf<Service["decode"]>().toEqualTypeOf<
      (bytes: ArrayBuffer, source: string) => Effect.Effect<Sound, LoadError>
    >()
    expectTypeOf<Service["load"]>().toEqualTypeOf<
      (url: string) => Effect.Effect<Sound, LoadError>
    >()
    expectTypeOf<Service["master"]>().toEqualTypeOf<Group>()
    expectTypeOf<Service["group"]>().toEqualTypeOf<(name: string) => Effect.Effect<Group>>()
    expectTypeOf<Service["listener"]>().toEqualTypeOf<Listener>()
    expectTypeOf<Service["resume"]>().toEqualTypeOf<Effect.Effect<void>>()
    expectTypeOf<typeof Audio>().toHaveProperty("use")
  })

  it("platform service", () => {
    type Platform = AudioContextService["Service"]
    expectTypeOf<Platform["ctx"]>().toEqualTypeOf<AudioContextLike>()
    expectTypeOf<Platform["createMediaElement"]>().toEqualTypeOf<
      (() => MediaElementLike) | undefined
    >()
    expectTypeOf<Platform["readFile"]>().toEqualTypeOf<
      ((location: string, signal: AbortSignal) => Promise<ArrayBuffer>) | undefined
    >()
  })

  it("layers", () => {
    expectTypeOf(AudioLive).toExtend<Layer.Layer<Audio, never, AudioContextService>>()
    expectTypeOf(AudioBrowserLive).toExtend<Layer.Layer<Audio>>()
  })

  it("load errors keep their reasons apart", () => {
    type Reason = LoadError["reason"]
    expectTypeOf<Reason>().toEqualTypeOf<
      NetworkFailure | DecodeFailure | UnsupportedFormat | StreamingUnavailable
    >()
    expectTypeOf<LoadError["source"]>().toEqualTypeOf<string>()
    expectTypeOf<PlaybackBlocked["source"]>().toEqualTypeOf<string>()
    expectTypeOf<UnknownSprite["available"]>().toEqualTypeOf<ReadonlyArray<string>>()
  })

  it("play options are all optional", () => {
    expectTypeOf<PlayOptions>().toHaveProperty("volume")
    expectTypeOf<Record<never, never>>().toExtend<ConstructorParameters<typeof PlayOptions>[0]>()
  })

  it("promise facade", () => {
    expectTypeOf(createAudioAsync).toEqualTypeOf<
      (platform: Layer.Layer<AudioContextService>) => Promise<PromiseAudio>
    >()
    expectTypeOf(createAudio).returns.toEqualTypeOf<PromiseAudio>()
    expectTypeOf<PromiseAudio>().toExtend<PromiseGroup>()
    expectTypeOf<PromiseAudio["load"]>().toEqualTypeOf<
      (url: string, signal?: AbortSignal) => Promise<Sound>
    >()
    expectTypeOf<PromiseAudio["group"]>().toEqualTypeOf<(name: string) => PromiseGroup>()
    expectTypeOf<PromiseGroup["play"]>().toEqualTypeOf<
      (sound: Sound, options?: unknown) => PromiseVoice
    >()
    expectTypeOf<PromiseGroup["stream"]>().toEqualTypeOf<
      (url: string, options?: unknown) => Promise<PromiseVoice>
    >()
    expectTypeOf<PromiseVoice["ended"]>().toEqualTypeOf<Promise<void>>()
  })
})
