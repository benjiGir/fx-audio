# Codecs

The browser decodes whatever the browser supports. Under Node, `node-web-audio-api` decodes WAV, MP3, Ogg Vorbis, FLAC and
AAC in M4A (when the `moov` atom comes first), but not Opus: decoding Opus there fails with `LoadError` whose `reason` is
`UnsupportedFormat`, so you can [catch it](./errors) and load another codec.
