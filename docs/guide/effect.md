# Using Effect

The core of fx-audio is an [Effect](https://effect.website) service. This page covers what the other guides take
for granted: how to provide it, who releases a voice, and what is an error and what is a defect.

## Providing the service

`Audio` is a service you ask for with `yield* Audio`. It needs a platform layer that supplies the audio context:

<<< @/examples/effect.ts#layers{ts}

`AudioContextService` is the platform layer's interface, if you want to supply your own context. The built-in layers
release their audio context when the layer is released.

## Voices and scopes

`play`, `playSprite` and `stream` need a `Scope`: the voice's audio nodes are released when the scope closes, and the voice
is stopped with them. `Effect.scoped` gives the voice the lifetime of the effect around it:

<<< @/examples/effect.ts#scope{ts}

A voice that should outlive one effect (music for the whole session) needs a scope you keep open for as long as it
should play, for example an `Effect.scoped` around your whole program. `voice.ended` completes when playback ends
naturally, when the voice is stopped, or when its scope closes. [Groups](./groups) are the exception: they belong to
the layer, whichever scope asked for them first.

## Loading

`load` fetches then decodes. Interrupting it aborts the request:

<<< @/examples/effect.ts#interrupt{ts}

`decode` does the second half on bytes you already have (from a cache, a database, a drop event), and fails with the same
typed errors:

<<< @/examples/effect.ts#decode{ts}

## Errors and defects

What can fail for reasons outside your code is a typed error in the Effect's error channel: `LoadError` (with its
`reason`), `UnknownSprite` and `PlaybackBlocked`. See [Errors](./errors).

A bad argument to a setter is your bug, not a failure to handle, so it is a defect (the effect dies): a negative or
non-finite volume for `setVolume` or `fadeTo`, a pan outside -1 to 1 for `setPan`, a non-finite coordinate for `setPosition`
or the listener. The plain options object you give `play` is typed but not checked at
runtime. When the options come from outside (a config file, a message), decode them first. `PlayOptions` is a
`Schema.Class`, and the promise facade does exactly this for you:

<<< @/examples/effect.ts#validate{ts}
