# Benchmark against Howler.js

Two measurements, both reproducible with one command. Howler is 2.2.4, fx-audio is the code in this repository.

```sh
pnpm bench:size
CHROMIUM_PATH=/path/to/chrome pnpm bench:play   # without CHROMIUM_PATH, Playwright's own Chromium
```

## Size

The same job in every bundle: load one file and play it. Bundled and minified with rolldown (through tsdown), platform `browser`, nothing left external unless stated.

| Bundle | minified | gzip | brotli |
| --- | --- | --- | --- |
| howler (full, with 3D and stereo) | 35.5 kB | 9.5 kB | 8.5 kB |
| howler (core: no 3D, no stereo) | 26.2 kB | 7.7 kB | 6.9 kB |
| fx-audio (promise facade, Effect included) | 108.4 kB | 34.4 kB | 30.9 kB |
| fx-audio (Effect core, Effect included) | 105.2 kB | 33.4 kB | 30.0 kB |
| fx-audio (Effect core alone, Effect shared with the app) | 9.3 kB | 3.3 kB | 2.9 kB |

Reading: for a page that does not use Effect, fx-audio costs about 3.6 times Howler's gzip size, because Effect is part of the bundle. For an app that already ships Effect, fx-audio itself adds 3.3 kB gzip, less than a third of Howler. Howler's full build covers as much as fx-audio does (stereo and 3D); fx-audio also has groups, sprites, streaming and typed errors, which neither bundle above exercises, because a bundler cannot drop the parts of one service.

## Cost of `play()`

What one call costs the calling thread, in a real Chromium with real audio contexts running (autoplay allowed by a flag), so a source node really is created and started each time. Not measured here: latency from the call to sound at the speaker, which depends on the machine's audio stack and is the same for both libraries.

Each scenario runs batches of 100 calls (voices are stopped after the clock stops), 60 batches after 5 warm-up batches, with the two libraries taking turns every batch so a drift in the machine's load hits both alike. The table gives the median cost of one call, and in brackets the lowest and highest median over 3 fresh pages. fx-audio is called through the promise facade (`createAudio`), the form comparable to Howler's synchronous API.

Chromium 141, Linux VM with 4 vCPUs, 2026-10-14 (two runs, the second one shown):

| Scenario | Howler 2.2.4 | fx-audio (promise facade) |
| --- | --- | --- |
| play | 41 µs (34 to 44) | 46 µs (41 to 54) |
| play with volume and rate | 40 µs (38 to 48) | 38 µs (36 to 40) |
| play with stereo pan | 77 µs (76 to 81) | 52 µs (49 to 52) |

Reading: plain playback costs the same within the noise (the first run gave 33 against 38 µs), setting volume and rate too, and a stereo pan is about a third cheaper in fx-audio, because Howler adds the panner after the voice has started and then pauses and restarts the voice (`setupPanner` in `howler.js`), while fx-audio builds the panner with the voice. All of these are around one hundredth of an audio render quantum (2.7 ms): neither library is a bottleneck.

Limits: one engine. Firefox and WebKit are covered by the cost test in `test-browser/browser.test.ts` (fx-audio alone, on an offline context), but a real-time context needs a sound card, which CI machines do not have. The numbers come from a shared VM, so compare the two columns with each other and not with another machine.
