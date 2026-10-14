import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

// `AudioBuffer` is not a global under Node, so a decoded buffer is recognised by shape.
const isAudioBufferLike = (u: unknown): u is AudioBuffer =>
  Predicate.hasProperty(u, "duration") && Predicate.isNumber(u.duration)

/** A decoded sound, ready to be played any number of times. */
export class Sound extends Schema.Class<Sound>("fx-audio/Sound")({
  buffer: Schema.declare(isAudioBufferLike),
  source: Schema.String
}) {}

/** Options of one `play` call. Decode untrusted input with `Schema.decodeUnknownSync(PlayOptions)`. */
export class PlayOptions extends Schema.Class<PlayOptions>("fx-audio/PlayOptions")({
  volume: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  rate: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
  loop: Schema.optionalKey(Schema.Boolean)
}) {}

/** A named slice of one sound. `start` and `duration` are in milliseconds, as in Howler. */
export class SpriteSegment extends Schema.Class<SpriteSegment>("fx-audio/SpriteSegment")({
  start: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  duration: Schema.Finite.check(Schema.isGreaterThan(0)),
  loop: Schema.optionalKey(Schema.Boolean)
}) {}

/** One decoded sound cut into named segments, played with `Audio.playSprite`. */
export class SpriteSheet extends Schema.Class<SpriteSheet>("fx-audio/SpriteSheet")({
  sound: Sound,
  segments: Schema.Record(Schema.String, SpriteSegment)
}) {}
