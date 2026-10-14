# Migrating from Howler

fx-audio replaces Howler.js. It has no compatibility layer, so the code changes, but most of it maps one to one.
This page shows the Howler call next to its fx-audio equivalent, with the promise facade (`fx-audio/promise`),
which reads closest to Howler. Everything also exists in Effect form, see the [guides](./getting-started).

## What changes

- **Sounds and voices are separate.** A `Howl` is a sound that also plays. In fx-audio, `load` returns a `Sound`
  (decoded audio, played any number of times) and each `play` returns a `Voice`, one playing instance.
  Howler's `id` numbers are the voice objects.
- **No events.** `await voice.ended` replaces `on("end")`, and a failed `load` rejects with a typed
  `LoadError` instead of calling `onloaderror`. See [Errors](./errors).
- **Groups exist.** Howler only has a global volume. fx-audio has named [groups](./groups) between your sounds and
  the master, so music and effects can each be turned down.
- **Time units.** Sprite offsets and durations are in milliseconds, as in Howler. Fades on the promise facade take
  seconds, where Howler's `fade` takes milliseconds.

## Playing a sound

```js
// Howler
const sound = new Howl({ src: ["/sounds/hit.mp3"], volume: 0.8, rate: 1.2 })
const id = sound.play()
sound.on("end", () => console.log("done"))
```

<<< @/examples/migrating.ts#basic{ts}

Howler takes a list of formats in `src` and picks the first one the browser supports. fx-audio loads one URL:
pick the codec yourself, or catch `UnsupportedFormat` and load another file, see [Errors](./errors).

## Sprites

```js
// Howler
const sound = new Howl({ src: ["/sounds/effects.mp3"], sprite: { hit: [0, 400], engine: [500, 2000, true] } })
sound.play("hit")
```

<<< @/examples/migrating.ts#sprites{ts}

## Fades and stopping

```js
// Howler
const id = sound.play()
sound.fade(1, 0, 2000, id)
sound.stop(id)
```

<<< @/examples/migrating.ts#fade{ts}

## Volume, mute and groups

```js
// Howler: one global volume
Howler.volume(0.5)
Howler.mute(true)
```

<<< @/examples/migrating.ts#groups{ts}

Every voice ends up in the master, so `audio.master` is Howler's global volume and mute. See [Groups and master](./groups).

## Stereo and 3D

| Howler | fx-audio |
| --- | --- |
| `sound.stereo(-1, id)` | `audio.play(sound, { pan: -1 })`, then `voice.setPan(1)` |
| `sound.pos(x, y, z, id)` | `audio.play(sound, { spatial: { position } })`, then `voice.setPosition(position)` |
| `sound.pannerAttr({ ... }, id)` | The other fields of `spatial`, given at `play` |
| `Howler.pos(x, y, z)` | `audio.listener.setPosition({ x, y, z })` |
| `Howler.orientation(x, y, z, xUp, yUp, zUp)` | `audio.listener.setOrientation(forward, up)` |

<<< @/examples/migrating.ts#spatial{ts}

Howler's 3D voices use the `HRTF` panning model by default. fx-audio keeps the Web Audio default (`equalpower`) unless
you set `panningModel`. See [3D position](./spatial) and [Stereo pan](./pan).

## Streaming (`html5: true`)

```js
// Howler
const music = new Howl({ src: ["/music/theme.mp3"], html5: true, loop: true })
music.play()
```

<<< @/examples/migrating.ts#stream{ts}

`stream` plays while downloading, like `html5: true`, and goes through the same volume, pan, groups and master as
any other voice. It cannot start before the user's first gesture, see [Streaming](./streaming).

## The rest of the API

| Howler | fx-audio |
| --- | --- |
| `Howler.unload()` | `audio.dispose()`: stops every voice and releases the audio context. The facade cannot be used afterwards |
| `Howler.autoUnlock` | Automatic on the first click, key press or touch; `audio.resume()` to do it yourself, see [Autoplay policy](./autoplay) |
| `Howler.codecs(ext)` | Not available. Catch `UnsupportedFormat` instead |
| `sound.loop(true)` | The `loop` option of `play`, set when the voice starts |

## Not available yet

These Howler features have no fx-audio equivalent today:

- pausing and resuming a voice, and `seek`;
- changing the volume or the rate of a voice after it started (`fadeTo` changes the volume over time);
- the `load`, `play`, `pause` and other events (`await voice.ended` covers `end`);
- `Howler.stop()` to stop every sound at once, and `sound.unload()` for one sound.
