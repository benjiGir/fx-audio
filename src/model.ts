import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

// `AudioBuffer` is not a global under Node, so a decoded buffer is recognised by shape.
const isAudioBufferLike = (u: unknown): u is AudioBuffer =>
  Predicate.hasProperty(u, "duration") && Predicate.isNumber(u.duration)

/** A gain: zero is silence, one is unchanged, above one amplifies. */
export const Volume = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** A playback speed: one is the sound's own speed, two is twice as fast. */
export const Rate = Schema.Finite.check(Schema.isGreaterThan(0))

/** A point in time inside a voice, in milliseconds from its start. */
export const Position = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

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
  rate: Schema.optionalKey(Rate),
  loop: Schema.optionalKey(Schema.Boolean),
  /**
   * Start this many milliseconds from now, counted on the audio clock, so voices that are started
   * together with the same `delay` stay in step. Sounds only: a stream starts at once.
   */
  delay: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  /**
   * Start at this time on the audio clock, in milliseconds, as `audio.now` reports it. A time already
   * past starts at once. It wins over `delay`. Sounds only: a stream starts at once.
   */
  startAt: Schema.optionalKey(Schema.Finite),
  /**
   * Vary the speed, and so the pitch, at random each time: `rateVariation: 0.1` plays at a speed
   * between 0.9 and 1.1 times `rate`. From 0 (the default) to 0.9.
   */
  rateVariation: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 0.9 }))
  ),
  /**
   * Vary the volume at random each time: `volumeVariation: 0.2` plays between 0.8 and 1.2 times
   * `volume`. From 0 (the default) to 1.
   */
  volumeVariation: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
  )
}) {}

const FilterType = Schema.Literals([
  "lowpass",
  "highpass",
  "bandpass",
  "notch",
  "allpass",
  "peaking",
  "lowshelf",
  "highshelf"
])

/**
 * A biquad filter. `lowpass` cuts what is above `frequency` (muffled), `highpass` what is below
 * (thin), `bandpass` and `notch` keep or remove a band around it. `peaking`, `lowshelf` and
 * `highshelf` boost or cut by `gain` decibels. `q` is the sharpness of the band (1 by default).
 */
export class Filter extends Schema.TaggedClass<Filter>()("filter", {
  type: FilterType,
  /** In hertz. */
  frequency: Schema.Finite.check(Schema.isGreaterThan(0)),
  q: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
  /** In decibels, for `peaking`, `lowshelf` and `highshelf` only. */
  gain: Schema.optionalKey(Schema.Finite)
}) {}

/** Repeats the sound after `time` milliseconds (5000 at most). `feedback` feeds it back into the delay for more repeats, 0 to 0.95 (0.4 by default), `mix` is how much is added to the dry sound, 0 to 1 (0.5 by default). */
export class Echo extends Schema.TaggedClass<Echo>()("echo", {
  time: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 5000 })),
  feedback: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 0.95 }))
  ),
  mix: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })))
}) {}

/**
 * A room: the sound with a tail made of decaying noise. `seconds` is how long the tail lasts, 0.1 to
 * 10 (2 by default), `decay` how fast it dies away, above 0 (2 by default, higher is quicker), `mix`
 * how much is added to the dry sound, 0 to 1 (0.3 by default).
 */
export class Reverb extends Schema.TaggedClass<Reverb>()("reverb", {
  seconds: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 0.1, maximum: 10 }))),
  decay: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
  mix: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })))
}) {}

/**
 * Evens out the loudness: what goes above `threshold` (decibels, -100 to 0, -24 by default) is
 * brought down by `ratio` (1 to 20, 12 by default), starting gently over `knee` decibels (0 to 40, 30
 * by default). `attack` and `release` are in seconds (0 to 1, 0.003 and 0.25 by default).
 */
export class Compressor extends Schema.TaggedClass<Compressor>()("compressor", {
  threshold: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: -100, maximum: 0 }))
  ),
  knee: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 40 }))),
  ratio: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 1, maximum: 20 }))),
  attack: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  release: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })))
}) {}

/** One stage of a group's effect chain. */
export const AudioEffect = Schema.Union([Filter, Echo, Reverb, Compressor])
export type AudioEffect = typeof AudioEffect.Type

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

/** The voice was held by `pause`. */
export class Paused extends Schema.TaggedClass<Paused>()("pause", {}) {}

/** The voice carried on after `pause`. */
export class Resumed extends Schema.TaggedClass<Resumed>()("resume", {}) {}

/** The voice jumped to `position`, in milliseconds from its start. */
export class Seeked extends Schema.TaggedClass<Seeked>()("seek", { position: Position }) {}

/** The voice changed speed. */
export class RateChanged extends Schema.TaggedClass<RateChanged>()("rate", { rate: Rate }) {}

/** The voice's volume was set at once with `setVolume`. A fade does not send it. */
export class VolumeChanged extends Schema.TaggedClass<VolumeChanged>()("volume", {
  volume: Volume
}) {}

/** Looping was turned on or off with `setLoop`. */
export class LoopChanged extends Schema.TaggedClass<LoopChanged>()("loop", {
  loop: Schema.Boolean
}) {}

/** The voice was stopped, with `stop` or by its scope closing. Always the last event. */
export class Stopped extends Schema.TaggedClass<Stopped>()("stop", {}) {}

/** The voice played to its end. Always the last event. */
export class Ended extends Schema.TaggedClass<Ended>()("end", {}) {}

/**
 * Everything that happens to a voice, told by its `events` stream. Match on `_tag`, which
 * carries the Howler name of the event: `pause`, `resume`, `seek`, `rate`, `volume`, `loop`,
 * `stop` and `end`.
 */
export const VoiceEvent = Schema.Union([
  Paused,
  Resumed,
  Seeked,
  RateChanged,
  VolumeChanged,
  LoopChanged,
  Stopped,
  Ended
])
export type VoiceEvent = typeof VoiceEvent.Type
