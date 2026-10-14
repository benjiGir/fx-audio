---
name: effect-ts
description: Use this skill before writing or reviewing any Effect (v4) code in fx-audio, to follow the official Effect guide and the project's own import and API rules.
---

<!--
Adapted from https://github.com/Effect-TS/skills (skills/effect-ts/SKILL.md),
MIT License, Copyright (c) 2023 Effectful Technologies Inc.
-->

# Effect in fx-audio

## Step 1: read the official guide

Before writing any Effect code, read `node_modules/effect/AGENTS.md`
**completely**, then read the linked examples in
`node_modules/effect/ai-docs/src/` that match the code you are about to write
(services, errors, resources, testing, integration). If `node_modules` is
missing, install dependencies first. Do not install `effect@latest`: the
version is pinned in `package.json` (peer dependency).

For APIs the guide does not cover, search the source in
`node_modules/effect/src` rather than relying on memory or on external
documentation, which may describe v3.

## Step 2: follow the guide's patterns

- Errors: `Schema.TaggedError`. When a failure has several causes, the error
  carries a `reason` field that is itself a tagged error (or a union of them),
  handled with `Effect.catchReason`. Do not use string literal discriminants.
- Data shapes (options, values handed to the user): `Schema.Class`, one
  declaration for the type, runtime validation of untrusted input and, later,
  encoding and property-test arbitraries. Plain TypeScript interfaces stay for
  ports that other code implements structurally (`AudioContextLike`) and for
  objects made of Effects (`Voice`).
- Services: `Context.Service` with an empty class body (`class Audio extends
  Context.Service<Audio, {...}>()("fx-audio/Audio") {}`), and the layer as a
  separate exported constant named `xLive` (`AudioLive`,
  `BrowserAudioContextLive`), built with `Layer.effect` and methods written with
  `Effect.fn("Service.method")`. This is benji's convention and overrides the
  guide's static `layer`.
- Resources (audio nodes, listeners, timers): `Effect.acquireRelease`, never a
  hand-written finalizer or an `Effect.runSync` inside an effect.
- `Effect.fnUntraced` for hot paths such as `play()`.
- Tests: `@effect/vitest` (`it.effect`, `it.live`, `layer`), with test doubles
  provided through the `AudioContextService` layer (`FakeAudioContextLive`), not module mocks. Plain
  vitest only for the promise facade and other non-Effect code.

## Step 3: project rules that override the guide's examples

- **Subpath imports only**: `import * as Effect from "effect/Effect"`, never
  `import { Effect } from "effect"`. The barrel import costs 30 to 38 kB gzip
  (measured) and defeats tree-shaking. The guide's examples use the barrel
  form; translate them.
- **No `unstable` modules** and no `@stability unstable` or `experimental` API in
  the public surface of the library.
