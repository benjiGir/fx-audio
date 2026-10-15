# fx-audio

## 1.0.0

First stable release. fx-audio is an audio library for the browser and Node, built on [Effect](https://effect.website), meant to replace Howler.js.
From here on the public API follows [Semantic Versioning](https://semver.org): it is frozen by API Extractor reports and type tests,
so a breaking change needs a new major version.

### What you get

- **Playback**: load and decode once, play many times (`audio.load`, `audio.play`), with `volume`, `rate`, `loop`, stereo `pan` and 3D `spatial` positioning (voices and a listener).
- **Sprites**: cut one file into named segments (`SpriteSheet`, `playSprite`), times in milliseconds as in Howler.
- **Streaming**: `audio.stream(url)` plays long sounds such as music while they download.
- **Voice control**: `pause`, `resume`, `seek`, live `setVolume`, `setRate` and `setLoop`, `fadeTo`, `fadeOut`, `crossfade`, an `events` stream, `ended`.
- **Scheduling**: start a voice later with `delay` or `startAt`, on the audio clock (`audio.now`).
- **Groups and master**: named mixer buses (`audio.group("music")`), `audio.master`, `mute`, `fadeTo`, `stopAll`, a per-group voice cap with `voiceCount`, and `duck` to lower one group while another plays.
- **Effects and metering**: filter, echo, reverb and compressor on a group; analysers on a voice, a group or the master.
- **Variation**: random pitch and volume, and sound banks (`makeSoundBank`) that never play the same sound twice in a row, or cycle through the list.
- **Autoplay and mobile**: the context resumes on the first user gesture, and again after a phone interruption or a hidden tab; voices are released as soon as they end.
- **Entry points**: `fx-audio` (Effect core), `fx-audio/promise` (promise facade for code without Effect), `fx-audio/node` (plays and reads files under Node through `node-web-audio-api`), `fx-audio/react` (`AudioProvider`, `useAudio`, `useGroup`, `useSound`), `fx-audio/testing` (an audio context double).
- **Typed errors**: `LoadError` (`NetworkFailure`, `DecodeFailure`, `UnsupportedFormat`, `StreamingUnavailable`), `UnknownSprite`, `PlaybackBlocked`.

### Quality

- Unit tests with 100% coverage, and browser tests on Chromium, Firefox and WebKit in CI.
- Mutation testing with Stryker (run by hand before a release, threshold 80%).
- Public API frozen in `api/*.api.md`, checked by CI.
- Documentation site with guides, a Howler migration page, a playground and a generated API reference: <https://benjigir.github.io/fx-audio/>.

### Good to know

- ESM only, Node 22 or later. `effect` 4.x is a peer dependency; `node-web-audio-api` (Node) and `react` (hooks) are optional peers.
- Size: the promise facade, Effect included, is about 41.6 kB gzip, against 9.5 kB for Howler. When the app already ships Effect, fx-audio itself adds about 6.1 kB gzip.
  Numbers and method are on the [benchmark page](https://benjigir.github.io/fx-audio/guide/benchmark).
- Opus cannot be decoded under Node: it fails with the typed `UnsupportedFormat` error.
- Real devices: automated tests render sound offline; no real iPhone testing has been done.
- Not in 1.0: bindings for Vue, Svelte and Solid, playlists, MediaSession, recording, audio worklets.
- The package is not published to npm yet.
