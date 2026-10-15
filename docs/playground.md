---
aside: false
---

# Playground

Try fx-audio in your browser. Everything below runs the real library, `fx-audio/promise`, on sounds made for this
page. The last box shows the call each button makes.

<ClientOnly>
  <Playground />
</ClientOnly>

## About the sounds

The three sounds (`effects.wav`, `blip.wav`, `music.wav`) are synthesized by
[`scripts/make-playground-sounds.mjs`](https://github.com/benjiGir/fx-audio/blob/main/scripts/make-playground-sounds.mjs),
so they have no third-party licence: they are released under the same MIT licence as the library. Run
`node scripts/make-playground-sounds.mjs` to generate them again.
