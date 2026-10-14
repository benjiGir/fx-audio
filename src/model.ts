import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

// `AudioBuffer` is not a global under Node, so a decoded buffer is recognised by shape.
const isAudioBufferLike = (u: unknown): u is AudioBuffer =>
  Predicate.hasProperty(u, "duration") && Predicate.isNumber(u.duration)

/** A gain: zero is silence, one is unchanged, above one amplifies. */
export const Volume = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** Stereo position: -1 is all left, 0 is centred, 1 is all right. */
export const Pan = Schema.Finite.check(Schema.isBetween({ minimum: -1, maximum: 1 }))

/** A point or a direction in 3D space. Web Audio's axes: x to the right, y up, z towards the listener. */
export class Vector3 extends Schema.Class<Vector3>("fx-audio/Vector3")({
  x: Schema.Finite,
  y: Schema.Finite,
  z: Schema.Finite
}) {}

const Angle = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 360 }))

/**
 * Where a voice sits in 3D and how it carries. Everything but `position` keeps the
 * Web Audio default when left out: equal-power panning, inverse distance model, reference
 * distance 1, rolloff 1, an omnidirectional source.
 */
export class SpatialOptions extends Schema.Class<SpatialOptions>("fx-audio/SpatialOptions")({
  position: Vector3,
  /** Direction the source faces, which only matters with a cone narrower than 360 degrees. */
  orientation: Schema.optionalKey(Vector3),
  panningModel: Schema.optionalKey(Schema.Literals(["equalpower", "HRTF"])),
  distanceModel: Schema.optionalKey(Schema.Literals(["linear", "inverse", "exponential"])),
  refDistance: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  maxDistance: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
  rolloffFactor: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  /** Degrees inside which the volume is not reduced. */
  coneInnerAngle: Schema.optionalKey(Angle),
  /** Degrees outside which the volume is `coneOuterGain`. */
  coneOuterAngle: Schema.optionalKey(Angle),
  coneOuterGain: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
  )
}) {}

/** A decoded sound, ready to be played any number of times. */
export class Sound extends Schema.Class<Sound>("fx-audio/Sound")({
  buffer: Schema.declare(isAudioBufferLike),
  source: Schema.String
}) {}

/**
 * Options of one `play` call. Decode untrusted input with `Schema.decodeUnknownSync(PlayOptions)`.
 *
 * @example
 * ```ts
 * yield* audio.play(sound, { volume: 0.5, pan: -1, rate: 1.2, loop: true })
 * ```
 */
export class PlayOptions extends Schema.Class<PlayOptions>("fx-audio/PlayOptions")({
  volume: Schema.optionalKey(Volume),
  pan: Schema.optionalKey(Pan),
  spatial: Schema.optionalKey(SpatialOptions),
  rate: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
  loop: Schema.optionalKey(Schema.Boolean)
}) {}

/** A named slice of one sound. `start` and `duration` are in milliseconds, as in Howler. */
export class SpriteSegment extends Schema.Class<SpriteSegment>("fx-audio/SpriteSegment")({
  start: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  duration: Schema.Finite.check(Schema.isGreaterThan(0)),
  loop: Schema.optionalKey(Schema.Boolean)
}) {}

/**
 * One decoded sound cut into named segments, played with `Audio.playSprite`.
 *
 * @example
 * ```ts
 * const sheet = new SpriteSheet({
 *   sound,
 *   segments: {
 *     hit: new SpriteSegment({ start: 0, duration: 400 }),
 *     engine: new SpriteSegment({ start: 500, duration: 2000, loop: true })
 *   }
 * })
 * const voice = yield* audio.playSprite(sheet, "hit")
 * ```
 */
export class SpriteSheet extends Schema.Class<SpriteSheet>("fx-audio/SpriteSheet")({
  sound: Sound,
  segments: Schema.Record(Schema.String, SpriteSegment)
}) {}
