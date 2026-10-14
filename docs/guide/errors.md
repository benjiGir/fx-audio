# Errors

Every failure of loading a sound is a `LoadError` whose `reason` is itself a tagged error, so you recover from one
kind of failure and let the others through.

| `reason` | Meaning |
| --- | --- |
| `NetworkFailure` | The request failed, or the server answered with an error status (`status`). Also a file that cannot be read under Node (`cause` holds the system error). |
| `DecodeFailure` | The bytes are not valid audio for the decoder. |
| `UnsupportedFormat` | The decoder does not support this codec or container. |
| `StreamingUnavailable` | This platform has no media element to stream with, as under Node. |

Two more errors are not load failures: `UnknownSprite` (`playSprite` was asked for a segment the sheet does not define)
and `PlaybackBlocked` (the browser refused to start a stream before a user gesture).

<<< @/examples/errors.ts#errors{ts}
