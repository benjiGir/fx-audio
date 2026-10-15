# React

`fx-audio/react` wraps the [promise facade](/guide/getting-started) in a provider and a few hooks. It needs React 18 or later,
which is an optional peer dependency: nothing else in fx-audio imports it.

```tsx
import { AudioProvider, useGroup, useSound } from "fx-audio/react"

const HitButton = () => {
  const hit = useSound("/sounds/hit.mp3")
  const effects = useGroup("effects")
  return (
    <>
      <button disabled={hit.status !== "ready"} onClick={() => hit.play({ volume: 0.8 })}>
        Hit
      </button>
      <button onClick={() => effects.fadeTo(0, 500)}>Fade effects out</button>
    </>
  )
}

export const App = () => (
  <AudioProvider>
    <HitButton />
  </AudioProvider>
)
```

## `AudioProvider`

Owns one audio for the components below it. The audio is created after the first render, so the provider is safe to render
on the server, where there is no `AudioContext`; until then it shows the `fallback` prop (nothing by default). It is
disposed when the provider unmounts, which stops every voice still playing.

| Prop       | Meaning                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| `platform` | Platform layer. The browser audio context by default. Changing it creates a new audio.               |
| `audio`    | An audio you made yourself. The provider uses it and leaves it alone: you dispose it.                 |
| `fallback` | What to render until the audio exists.                                                                |

## Hooks

- `useAudio()` returns the `PromiseAudio` of the nearest provider and throws outside one. Use it for everything the
  facade does: `play`, `stream`, `master`, `listener`, `stopAll`.
- `useGroup(name)` returns the named group, the same object on every render.
- `useSound(url)` loads the sound and returns `{ status, sound, error, play }`. `status` is `"loading"`, `"ready"` or
  `"error"`. `play(options)` does nothing and returns `undefined` until the sound is loaded, then returns the voice. Loading
  restarts when `url` changes, and is cancelled when the component unmounts.

Voices are plain facade voices, so `pause`, `seek`, `on("end", ...)` and the rest work as in
[Controlling a voice](/guide/voices). Voices started from a component are not stopped when that component unmounts; stop
them yourself, or let the provider's disposal do it.

## Other frameworks

The facade has no framework dependency: in Vue, Svelte or Solid, create one audio with `createAudio()` where the app
starts, share it however the framework shares services, and call `dispose()` when it ends.
