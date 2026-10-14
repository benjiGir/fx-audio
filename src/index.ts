/**
 * The Effect core: the `Audio` service with its voices, groups and listener, the data
 * classes (`Sound`, `PlayOptions`, `SpriteSheet`...), the typed errors and the browser layers.
 * @module fx-audio
 */

export type {
  AudioContextLike,
  AudioListenerLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  MediaElementLike,
  PannerNodeLike,
  SourceNodeLike,
  StereoPannerNodeLike
} from "./context.ts"
export { AudioContextService, BrowserAudioContextLive } from "./context.ts"
export type { Group, Listener, Voice } from "./core.ts"
export { Audio, AudioBrowserLive, AudioLive } from "./core.ts"
export {
  DecodeFailure,
  LoadError,
  NetworkFailure,
  PlaybackBlocked,
  StreamingUnavailable,
  UnknownSprite,
  UnsupportedFormat
} from "./errors.ts"
export { PlayOptions, Sound, SpatialOptions, SpriteSegment, SpriteSheet, Vector3 } from "./model.ts"
