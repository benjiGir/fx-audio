# Sprites

A sprite sheet cuts one decoded sound into named segments, so a whole set of effects loads as one file.
Times are in milliseconds, as in Howler.

<<< @/examples/sprites.ts#sprites{ts}

`playSprite` fails with `UnknownSprite` (listing the available names) when the sheet has no such segment.
A looping segment loops inside its own bounds. `PlayOptions.loop`, when given, overrides the segment's `loop` flag.
