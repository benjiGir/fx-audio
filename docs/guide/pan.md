# Stereo pan

`PlayOptions.pan` places a voice between the left speaker (-1) and the right one (1); 0 is centred.
`voice.setPan(pan)` moves it afterwards, also for a voice that started without a pan.

<<< @/examples/pan.ts#pan{ts}

The stereo panner is only built for voices that use one. A value outside -1 to 1 is rejected when options are decoded
and is a defect for `setPan`.
