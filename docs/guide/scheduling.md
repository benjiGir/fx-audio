# Scheduling

`setTimeout` is off by several milliseconds and drifts, which a rhythm cannot afford. A voice can instead be given a start
time on the **audio clock**, which the audio engine itself follows to the sample.

- `delay` starts the voice that many milliseconds from now.
- `startAt` starts it at a time on the clock; `audio.now` reads the clock, in milliseconds. A time already past starts at once.
  `startAt` wins when both are given.

<<< @/examples/scheduling.ts#effect{ts}

The same with promises:

<<< @/examples/scheduling.ts#promise{ts}

Voices given the same `delay` in the same tick, or the same `startAt`, start together, whichever group they play on. A grid of
`startAt` values keeps its beat for as long as it runs, however busy the page is.

## While a voice waits

A voice that has not started yet is a voice like any other: `stop` cancels it, `setVolume`, `fadeTo`, `setPan` and
`setPosition` already apply, `position` reads 0, and `setRate`, `setLoop` and `seek` keep its start time. `pause` holds it at the
start, and `resume` then starts it at once instead of waiting for what was left.

## Good to know

- The audio clock runs only while the context does: nothing starts before the first user gesture, and a delay is counted from when
  the context is running again (see [autoplay](./autoplay)).
- `delay` and `startAt` apply to sounds and sprites. A [stream](./streaming) starts at once, since a media element cannot be
  scheduled to the sample.
