import * as Data from "effect/Data"

export type LoadFailure = "network" | "decode" | "unsupported-format" | "timeout"

/** Every failure of loading a sound, typed in the Effect error channel. */
export class LoadError extends Data.TaggedError("LoadError")<{
  readonly reason: LoadFailure
  readonly source: string
  readonly cause?: unknown
}> {}
