# Effects

Howler plays sounds as they are. A group here can put a chain of effects on everything it plays, with `setEffects`. The effects
run after the group's volume, in the order given, and a new list replaces the old one. Voices already playing are affected too.

<<< @/examples/effects.ts#effect{ts}

The same with promises, where an effect is a plain object with a `_tag`:

<<< @/examples/effects.ts#promise{ts}

| Effect | What it does | Options |
| --- | --- | --- |
| `Filter` | Cuts or boosts part of the spectrum. `lowpass` muffles, `highpass` thins, `bandpass` and `notch` keep or remove a band, `peaking`, `lowshelf` and `highshelf` boost or cut by `gain`. | `type`, `frequency` (Hz), `q` (1), `gain` (dB, 0) |
| `Echo` | Repeats the sound after a delay. | `time` (ms, up to 5000), `feedback` (0 to 0.95, 0.4), `mix` (0 to 1, 0.5) |
| `Reverb` | Gives the sound a room: a tail of decaying noise. | `seconds` (0.1 to 10, 2), `decay` (above 0, 2), `mix` (0 to 1, 0.3) |
| `Compressor` | Evens out the loudness: loud parts come down. | `threshold` (dB, -24), `knee` (dB, 30), `ratio` (1 to 20, 12), `attack` and `release` (s, 0.003 and 0.25) |

Good to know:

- The master takes effects too (`audio.master.setEffects`), and so does a group nested in it: the sound goes through the group's
  effects, then the master's.
- Replacing the effects cuts the tail of an echo or a reverb that is sounding. Keep the same list while a sound plays.
- A reverb builds its tail from random noise when it is set, so two calls with the same options sound alike but not identical.
- An invalid effect (an echo longer than five seconds, a feedback of 1) is refused when the effect is built, with a `SchemaError`
  on the promise facade.
- In tests, `makeFakeContext` records the nodes (`ctx.filters`, `ctx.delays`, `ctx.convolvers`, `ctx.compressors`) and the
  buffers (`ctx.buffers`).
