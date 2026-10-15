# Variation

The same footstep ten times in a row sounds like a machine. Two small tools make a repeated sound feel alive.

## Random speed and volume

`rateVariation` and `volumeVariation` on `play`, `playSprite` and `stream` pick the speed (and so the pitch) and the volume at
random, each time the voice starts:

- `rateVariation: 0.1` plays at a speed between 0.9 and 1.1 times `rate` (from 0 to 0.9);
- `volumeVariation: 0.2` plays at a volume between 0.8 and 1.2 times `volume` (from 0 to 1).

They apply to what you give as `rate` and `volume`, one does not need the other, and without them nothing is drawn.

## A bank of sounds

`makeSoundBank(sounds, { order })` hands out the next sound to play: in `random` order, the default, it is never the same as the one
before, and in `cycle` order it goes through the list and starts again. `size` is the number of sounds; an empty list throws a
`RangeError`. It has no Effect in its types, so it is the same on the promise facade.

<<< @/examples/variation.ts#effect{ts}

<<< @/examples/variation.ts#promise{ts}
