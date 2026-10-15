# Level meters and visualisers

Howler leaves you to dig into `Howler.ctx` to see what is playing. Here a voice, a group and the master each have an
`analyser` that reads the signal as it passes, without changing it.

<<< @/examples/analyser.ts#effect{ts}

The same with promises, drawing the spectrum of a group on a canvas:

<<< @/examples/analyser.ts#promise{ts}

| Read | What it gives |
| --- | --- |
| `level` | How loud it is: the RMS of the last 2048 samples, from 0 (silence) to 1 (full scale). For a VU meter. |
| `peak` | The highest absolute sample of the same window, from 0 to 1. For a clip light. |
| `spectrum` | 1024 values from 0 to 255, one per frequency band from 0 Hz up to half the sample rate. For bars. |
| `waveform` | The 2048 samples themselves, each from -1 to 1. For an oscilloscope. |

- `voice.analyser`, `group.analyser` and `audio.analyser` (the master, so everything) are built on the first call and are the same
  object on every call after that. Nothing is computed until you read, so a voice nobody measures pays nothing.
- A voice is measured as it leaves the voice, after its volume, pan and position. A group is measured after its own volume, so a
  muted group reads silence.
- Every read returns a new array, so you can keep it. Poll from `requestAnimationFrame` for a smooth display.
- In tests, `makeFakeContext` records the analysers (`ctx.analysers`) and reads whatever you put in their `frequencyData` and
  `timeData`.
