/**
 * The Effect core: the `Audio` service with its voices, groups and listener, the data
 * classes (`Sound`, `PlayOptions`, `SpriteSheet`...), the typed errors and the browser layers.
 * @module fx-audio
 */

export type {
  AnalyserNodeLike,
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
export type { Analyser, Group, Listener, Voice } from "./core.ts"
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
export {
  Ended,
  LoopChanged,
  Paused,
  PlayOptions,
  RateChanged,
  Resumed,
  Seeked,
  Sound,
  SpatialOptions,
  SpriteSegment,
  SpriteSheet,
  Stopped,
  Vector3,
  VoiceEvent,
  VolumeChanged
} from "./model.ts"
