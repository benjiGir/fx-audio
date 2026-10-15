# Controlling a voice

A voice is one playing instance of a sound. Everything below works on voices from `play`, `playSprite` and `stream`.

<<< @/examples/voices.ts#effect{ts}

The promise facade has the same methods, without the `Effect`:

<<< @/examples/voices.ts#promise{ts}

## Pause, resume and seek

| Method | What it does |
| --- | --- |
| `pause` | Holds the voice where it is. `ended` stays pending. |
| `resume` | Carries on from there. Does nothing on a voice that is not paused. |
| `seek(ms)` | Jumps to `ms` milliseconds from the start, playing or paused. |
| `position` | Where the voice is, in milliseconds. |
| `paused` | Whether `pause` holds the voice right now. |

- For a sprite, the position counts from the start of the segment, not of the whole sound: `seek(0)` is the start of the sprite.
- Seeking past the end wraps around a looping voice and ends any other voice, so `ended` completes.
- `stop` also works on a paused voice, and ends it.
- Once a voice has ended (it finished, was stopped, or its scope closed) these methods do nothing.
- `seek` dies on a negative or non-finite time.

A decoded sound plays through a buffer source, which the Web Audio API cannot pause or move. fx-audio drops it when you
pause, and starts a new one at the right point when you resume or seek, on the same volume, pan and 3D nodes. The position
is worked out from the audio clock, so it stays right across rate changes. A seek or a loop change can leave a gap of a
few milliseconds, the time the new source takes to start.

For a streamed voice, `pause` and `resume` drive the media element, and `seek` sets its `currentTime`. `resume` can fail
with `PlaybackBlocked` if the browser refuses to restart it; the voice then stays paused.

## Change a voice while it plays

| Method | What it does |
| --- | --- |
| `setVolume(volume)` | Sets the gain at once and cancels a fade in progress. Dies on a negative volume. |
| `setRate(rate)` | Changes the speed: 1 is normal, 2 twice as fast. Dies on a rate that is not above zero. |
| `setLoop(loop)` | Turns looping on or off. |
| `fadeTo(volume, over)` | Fades the volume, see [Groups and master](./groups). |

`setRate` changes the pitch with the speed, as `rate` does in Howler. Turning `loop` on or off starts a new source at the
current position, like a seek.
