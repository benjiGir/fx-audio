# 3D position

`PlayOptions.spatial` puts a voice in 3D space, heard from the listener. Axes are Web Audio's: x to the right, y up,
z towards the listener. Only `position` is required; every other attribute keeps the Web Audio default (equal-power
panning, inverse distance model, reference distance 1, rolloff 1, omnidirectional source).

`voice.setPosition(position)` moves the voice afterwards, also one that started without `spatial`.
`audio.listener` moves the listener, which starts at the origin facing -z with +y up.
Positions are unitless: scale them as you like and tune `refDistance` to match.

<<< @/examples/spatial.ts#spatial{ts}

Attributes: `orientation`, `panningModel` (`"equalpower"` or `"HRTF"`), `distanceModel` (`"linear"`, `"inverse"` or `"exponential"`),
`refDistance`, `maxDistance`, `rolloffFactor`, `coneInnerAngle`, `coneOuterAngle` and `coneOuterGain`.
A non-finite coordinate is a defect for the setters. `pan` and `spatial` can be combined: the stereo pan is applied first.
The panner is only built for voices that use one.

::: info Firefox
Firefox does not expose the listener as `AudioParam`s yet, so the listener falls back to the older `setPosition`
and `setOrientation` methods there.
:::
