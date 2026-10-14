import * as Schema from "effect/Schema"

/** The request failed, or the server answered with an error status. */
export class NetworkFailure extends Schema.TaggedError<NetworkFailure>()("NetworkFailure", {
  status: Schema.optionalKey(Schema.Int),
  cause: Schema.optionalKey(Schema.Defect())
}) {}

/** The bytes are not valid audio for the decoder. */
export class DecodeFailure extends Schema.TaggedError<DecodeFailure>()("DecodeFailure", {
  cause: Schema.Defect()
}) {}

/** The decoder does not support this codec or container. */
export class UnsupportedFormat extends Schema.TaggedError<UnsupportedFormat>()(
  "UnsupportedFormat",
  {
    cause: Schema.Defect()
  }
) {}

/** This platform has no media element to stream with, as under Node. */
export class StreamingUnavailable extends Schema.TaggedError<StreamingUnavailable>()(
  "StreamingUnavailable",
  {}
) {}

/** `playSprite` was asked for a segment the sprite sheet does not define. */
export class UnknownSprite extends Schema.TaggedError<UnknownSprite>()("UnknownSprite", {
  name: Schema.String,
  available: Schema.Array(Schema.String)
}) {}

/**
 * Every failure of loading a sound. The `reason` is itself a tagged error, so
 * callers can recover with `Effect.catchReason("LoadError", "NetworkFailure", ...)`.
 */
export class LoadError extends Schema.TaggedError<LoadError>()("LoadError", {
  source: Schema.String,
  reason: Schema.Union([NetworkFailure, DecodeFailure, UnsupportedFormat, StreamingUnavailable])
}) {}

/**
 * The browser refused to start a stream because the page has not seen a user gesture yet.
 * Catch it, then call `stream` again from a click or key handler.
 */
export class PlaybackBlocked extends Schema.TaggedError<PlaybackBlocked>()("PlaybackBlocked", {
  source: Schema.String,
  cause: Schema.Defect()
}) {}
