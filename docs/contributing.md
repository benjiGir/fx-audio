# Contributing

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm coverage     # unit tests, coverage thresholds: 95%
pnpm test:browser # real browsers through Playwright (all three engines by default)
pnpm api          # public API against the reports committed in api/ (pnpm api:update after a deliberate change)
pnpm mutation     # mutation testing with Stryker, break threshold: 80% (about 12 minutes, not run in CI)
pnpm build
pnpm check:package
pnpm docs:dev     # this site, with live reload
pnpm docs:build   # the site as it is published
```

## Browser tests

Browser tests run on Chromium, Firefox and WebKit. Sound is rendered with an `OfflineAudioContext`, so no output device is needed.
Locally, install them with `pnpm exec playwright install`, or restrict the run with `FX_BROWSERS=chromium`
(and `CHROMIUM_PATH` to use an existing Chromium binary).

## Mutation testing

Mutation testing changes the source on purpose (flips a condition, drops a call, empties a string) and checks that a unit test
fails each time. A mutant that survives is behaviour no test pins down. It takes about 12 minutes, so it is not part of CI:
run it by hand before a release or after a change to the core. The HTML report is written to `reports/mutation/index.html`.
Vitest is pinned to 4.1.x because Stryker's Vitest runner does not support Vitest 5 yet.

## Frozen API

The public surface of every entry point (`fx-audio`, `fx-audio/promise`, `fx-audio/node`, `fx-audio/testing`) is written to
`api/*.api.md` by API Extractor, and CI fails when the built declarations no longer match. A pull request that changes a signature
has to update those files, so the change shows up in review. `test/api.test.ts` pins the signatures users write code against
with type tests, checked by `pnpm typecheck`.

## Writing these docs

The code samples are real files in `docs/examples/`, included into the pages and compiled by `pnpm typecheck`.
Change the file, not a copy in the Markdown.
