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
**completely** (at the repository root, or in `spike/node_modules/effect/` while
only the spike has installed dependencies), and follow its links when needed.
If `node_modules` is missing, install dependencies first. Do not install
`effect@latest`: the version is pinned in `package.json` (peer dependency).

For APIs the guide does not cover, search the source in
`node_modules/effect/src` rather than relying on memory or on external
documentation, which may describe v3.

## Step 2: project rules that override the guide's examples

- **Subpath imports only**: `import * as Effect from "effect/Effect"`, never
  `import { Effect } from "effect"`. The barrel import costs 30 to 38 kB gzip
  (measured in the spike) and defeats tree-shaking. The guide's examples use the
  barrel form; translate them.
- **No `unstable` modules** and no `@stability unstable` or `experimental` API in
  the public surface of the library.
- Prefer `Effect.fnUntraced` on hot paths such as `play()`; use `Effect.fn("name")`
  where a tracing span is useful.
- Typed errors with a `reason` discriminant (see `LoadError` in the spike, `spike/src/errors.ts`), no thrown
  exceptions across the public API.
- Every resource (audio node, event listener, timer) is released through a
  `Scope` finalizer.
- Test doubles go through the `AudioContextService` layer, not module mocks.
