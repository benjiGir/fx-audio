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
| `fadeOut(over)` | Fades to silence, then stops the voice. Completes once it has stopped. |

`setRate` changes the pitch with the speed, as `rate` does in Howler. Turning `loop` on or off starts a new source at the
current position, like a seek.

## Crossfade

`crossfade(out, sound, over, options)` hands over from a playing voice to a new sound, on the master or on a group: the new voice
starts silent and fades up to `options.volume` (1 by default) while `out` fades down and stops, both over the same time. It
returns the new voice as soon as it has started.

<<< @/examples/voices.ts#crossfade-effect{ts}

<<< @/examples/voices.ts#crossfade-promise{ts}

The old voice may be a stream, the new one is a decoded sound. If the scope closes before the fade is over, the old voice is
stopped where it is. Chain it from the previous result for a playlist: each call returns the voice to hand over from next time.

## Events

A voice tells what happens to it, like Howler's `on`. With Effect, `voice.events` is a stream:

<<< @/examples/voices.ts#events-effect{ts}

With the promise facade, `voice.on(type, listener)` calls the listener for each event of that type and returns a
function that stops listening:

<<< @/examples/voices.ts#events-promise{ts}

| `_tag` | When | Extra field |
| --- | --- | --- |
| `pause` | `pause` held the voice | |
| `resume` | `resume` let it carry on | |
| `seek` | `seek` moved it | `position`, in milliseconds, after wrapping a loop |
| `rate` | `setRate` changed the speed | `rate` |
| `volume` | `setVolume` set the volume. A fade sends nothing | `volume` |
| `loop` | `setLoop` turned looping on or off | `loop` |
| `stop` | `stop`, or the scope closed. The last event | |
| `end` | The sound played to its end, or a `seek` went past it. The last event | |

- The stream starts at the moment it runs: earlier events are not replayed, and the stream of a voice that has already
  ended is empty. It completes after `stop` or `end`.
- A voice nobody listens to pays nothing for events.
- Pausing a paused voice, or resuming one that plays, sends nothing, and `resume` sends nothing when it fails.
- A listener given to `on` that throws does not stop the voice or the other listeners: the error is rethrown
  outside, where the page reports it.
- Howler's `end` also fires at each pass of a loop. `end` here is the end of the voice only.
