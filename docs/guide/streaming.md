# Streaming

`audio.stream(url, options)` plays a long sound, such as music, while it downloads, instead of decoding the whole file first.
It uses a media element routed into the same graph, so `volume`, `pan`, `spatial`, `rate`, `loop`, groups, `fadeTo` and the master
all work as for `play`. It resolves with a voice once the browser can start and playback has begun, and the voice is released
when the scope closes (an interrupted or failed stream is released at once).

<<< @/examples/streaming.ts#streaming{ts}

It fails with:

- `LoadError` (`NetworkFailure`, `DecodeFailure` or `UnsupportedFormat`; browsers report a missing file as `UnsupportedFormat`);
- `PlaybackBlocked` when the page has not seen a user gesture yet: catch it and stream again from a click handler;
- `LoadError` whose `reason` is `StreamingUnavailable` where there is no media element, as under Node.

Cross-origin files need CORS headers: the element is created with `crossOrigin = "anonymous"`, since the browser silences a
cross-origin element routed into the audio graph. A streamed voice cannot start before the user's first gesture, unlike `play`,
which waits on the suspended context.

## Many streams, one after the other

A voice lets go of its media element as soon as it ends, whether it ran out, was stopped or failed, not only when the scope closes.
The element then waits for the next stream (up to four are kept), so a track that follows another reuses it:

- no new media element per stream, which matters on pages that play many tracks, and on browsers that cap how many exist;
- on iOS Safari an element that has played after a gesture may play again later, so the next track can start from a timer or from the
  end of the previous one, where a brand new element would be refused with `PlaybackBlocked`.

A failed element is dropped rather than kept. Nothing to configure.
