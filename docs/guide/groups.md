# Groups and master

A group is a mixer bus: every voice played through it shares one gain, so music, effects and voice-over
can each be turned down, faded or muted at once. Groups are named: `audio.group("music")` creates the group
the first time and returns the same one afterwards. Every sound, grouped or not, ends up in the master group,
which plays the role of Howler's global volume and mute.

<<< @/examples/groups.ts#groups{ts}

`setVolume` cancels a fade in progress. While a group is muted, `setVolume` and `fadeTo` only change the volume
that `unmute` restores. A negative or non-finite volume is a defect. Groups live as long as the layer and are released
with it, whichever scope asked for them first.

The promise facade has the same methods (`group(name)`, `master`, and the group methods on the facade itself).
