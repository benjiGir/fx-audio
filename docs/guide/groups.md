# Groups and master

A group is a mixer bus: every voice played through it shares one gain, so music, effects and voice-over
can each be turned down, faded or muted at once. Groups are named: `audio.group("music")` creates the group
the first time and returns the same one afterwards. Every sound, grouped or not, ends up in the master group,
which plays the role of Howler's global volume and mute.

<<< @/examples/groups.ts#groups{ts}

`setVolume` cancels a fade in progress. While a group is muted, `setVolume` and `fadeTo` only change the volume
that `unmute` restores. A negative or non-finite volume is a defect. Groups live as long as the layer and are released
with it, whichever scope asked for them first.

`stopAll` stops every voice playing through a group. On `audio.stopAll`, which is `audio.master.stopAll`, that means every
voice, in the named groups too. Each voice ends as if `stop` had been called on it, so its `ended` completes and its
`stop` event is sent. A voice started afterwards plays normally, and a `stream` that is still waiting for the browser
to be ready is not reached: it starts once it can.

The promise facade has the same methods (`group(name)`, `master`, and the group methods on the facade itself).

## Limit the voices

A burst of the same sound (gunfire, footsteps, rain) piles up voices and costs CPU. `setMaxVoices(limit)` caps the voices
playing through a group: the one that starts over the cap stops the oldest, which hears a `stop` event. `undefined` removes the cap,
and lowering it stops the oldest voices at once. On the master it counts the voices of every group.

<<< @/examples/groups.ts#max-voices{ts}

`voiceCount` is how many voices play through the group right now (paused ones included), and `audio.state` is the state of the
audio context: a sound that stays silent while the state is not `running` is waiting for the context, see
[autoplay](./autoplay).

## Ducking

`music.duck(voice, options)` lowers the music while the `voice` group has a voice playing, and brings it back when it has none:
the music that gives way to speech, without you watching for the start and the end of every line.

<<< @/examples/groups.ts#ducking{ts}

The music goes down to `volume` times its own volume (0.3 by default) over `attack` milliseconds (100) and comes back over
`release` (500). `setVolume`, `fadeTo`, `mute` and `unmute` keep working on top of the ducking. Several triggers bring the group
down to the lowest of their levels, and a paused voice of the trigger counts as playing. The ducking ends when the scope closes; on the
promise facade `duck` returns a function that ends it. The master can be ducked too (`audio.master.duck(alarm)`).
