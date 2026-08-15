# Architecture

Status labels used throughout: **Implemented**, **Prototype**, **Planned**.

---

## The one rule

**The simulation must not depend on Phaser.**

Phaser is a presentation and input library. It draws what the simulation says is true. It is never
the place where a villager decides to eat, a job is assigned, or a resource changes hands.

A villager sprite is a _picture of_ a simulation villager. It is not the villager.

This is not a stylistic preference. It is what makes the following possible:

- unit-testing economy and AI logic headlessly, in milliseconds;
- reproducing any bug from a seed;
- saving authoritative state instead of serialising engine objects;
- replacing or upgrading the renderer without touching gameplay;
- profiling simulation cost separately from render cost;
- eventually packaging for mobile.

### How the rule is enforced

Convention alone rots. `eslint.config.js` applies rules scoped to `src/simulation/**`:

| Rule                       | Effect                                                                 |
| -------------------------- | ---------------------------------------------------------------------- |
| `no-restricted-imports`    | Importing `phaser`, `@/renderer/*`, `@/ui/*` or `@/input/*` fails lint |
| `no-restricted-globals`    | `window` and `document` are unavailable — the simulation runs headless |
| `no-restricted-properties` | `Math.random()` fails lint — determinism is not optional               |

`npm run lint` fails the build if any of these are violated.

---

## Layers

```text
        ┌──────────────┐
        │    Input     │  PointerController (mouse), TouchController (touch)
        └──────┬───────┘  Devices produce device-independent *intents*.
               │
        ┌──────▼───────┐
        │     Game     │  Composition root. Owns simulation, clock, camera.
        └──────┬───────┘  Turns intents into commands and drives the frame.
               │
        ┌──────▼───────┐
        │  Simulation  │  Pure TypeScript. The authority on everything.
        └──────┬───────┘  Advances only in fixed ticks.
               │
        ┌──────▼───────┐
        │  Game State  │  Read by presentation. Never written by it.
        └──────┬───────┘
               │
   ┌───────────┴────────────┐
   ▼                        ▼
┌─────────┐          ┌────────────┐
│ Phaser  │          │  HTML HUD  │
│ (world) │          │  (chrome)  │
└─────────┘          └────────────┘
```

Data flows down. Nothing reaches back up.

### Directory map

| Path              | Responsibility                                                            | Depends on                  |
| ----------------- | ------------------------------------------------------------------------- | --------------------------- |
| `src/simulation/` | Authoritative game state and rules                                        | `src/shared` only           |
| `src/game/`       | Composition root; wires layers, owns the frame loop                       | simulation, renderer camera |
| `src/renderer/`   | Drawing. `renderer/phaser/` is engine-specific; `renderer/camera/` is not | simulation (read-only)      |
| `src/input/`      | Devices → intents                                                         | `src/shared`                |
| `src/ui/`         | HTML/CSS chrome: HUD, panels, menus                                       | game (read-only)            |
| `src/data/`       | Data-driven definitions: buildings, resources, recipes                    | nothing                     |
| `src/shared/`     | Types, maths, utilities usable by any layer                               | nothing                     |
| `src/debug/`      | Development-only tooling, excluded from production builds                 | game (read-only)            |
| `tests/`          | Vitest suites. No Phaser, no DOM.                                         | simulation, shared          |

---

## What exists today (Phase 1)

| Component                     | Status          | Notes                                                         |
| ----------------------------- | --------------- | ------------------------------------------------------------- |
| `SimulationClock`             | **Implemented** | Fixed timestep, pause/1x/2x/4x, backlog guard, save-restore   |
| `SeededRandom` + `deriveSeed` | **Implemented** | mulberry32; serialisable state; per-system streams            |
| `CameraController`            | **Implemented** | Pan, smooth zoom, anchored zoom, inertia, bounds, clamping    |
| `PointerController`           | **Implemented** | Mouse drag, wheel zoom, click select                          |
| `TouchController`             | **Implemented** | One-finger pan, pinch zoom, tap select, pinch↔pan handoff     |
| `Hud`                         | **Prototype**   | Speed controls work; resource readouts show `--`              |
| `DebugOverlay`                | **Implemented** | Dev-only; FPS, tick, sim time, camera, seed                   |
| `Simulation`                  | **Skeleton**    | Owns seed, RNG and tick counter. No world, villagers or jobs. |
| `WorldScene`                  | **Placeholder** | Flat checker field. Not isometric. Replaced in Phase 2.       |
| Isometric projection          | **Planned**     | Phase 2 — a single subsystem, not scattered maths             |
| Villagers, jobs, logistics    | **Planned**     | Phases 3-5                                                    |
| Save/load                     | **Planned**     | Phase 9                                                       |

---

## The simulation clock

Render frame rate and simulation rate are independent, and deliberately so.

```text
requestAnimationFrame  (Phaser, variable rate)
        │
        ▼
   Game.advance(deltaMs)
        │
        ▼
   SimulationClock.advance()   accumulates real time
        │
        ▼
   Simulation.update(tick)     fixed 100ms steps, N times per frame
```

Default is 10 ticks per second. Consequences:

- economy maths never runs per rendered frame, so a 144Hz display does not run the economy 2.4×
  faster than a 60Hz one;
- a save stores `tick`, which fully identifies simulation time;
- a test can call `advance()` with synthetic deltas and assert exact outcomes.

**Backlog guard.** After a long stall — a backgrounded tab, a breakpoint — the accumulated time
could demand thousands of ticks, each making the next frame later still (the "spiral of death").
`maxTicksPerAdvance` caps the catch-up at 20 ticks and records the shortfall in `droppedTickCount`,
which the debug overlay displays. Time is dropped visibly rather than silently.

---

## Determinism

The same seed must produce the same world, always.

- `SeededRandom` is mulberry32: fast, well-distributed, and its entire state is one 32-bit integer,
  so a save can restore the exact position in the sequence.
- `Math.random()` is a lint error inside `src/simulation`.
- `deriveSeed(parentSeed, label)` gives each system its own stream. Without this, adding one RNG
  call to world generation would shift every villager name generated afterwards. With it, streams
  stay independent.

---

## Coordinate spaces

Three spaces, deliberately given distinct types in `src/shared/types/geometry.ts` so the compiler
catches confusion between them:

| Space  | Type          | Fields     | Meaning                                      |
| ------ | ------------- | ---------- | -------------------------------------------- |
| Grid   | `GridPoint`   | `gx`, `gy` | Integer simulation tiles. **Authoritative.** |
| World  | `WorldPoint`  | `wx`, `wy` | Continuous world units, un-projected         |
| Screen | `ScreenPoint` | `sx`, `sy` | Viewport pixels                              |

`CameraController` converts between world and screen via `viewportToWorld` / `worldToViewport` —
**camera transforms only** (pan and zoom).

The isometric projection between grid and world space is a _separate_ Phase 2 subsystem
(`gridToWorld`, `worldToGrid`, `worldToScreen`, `screenToWorld`). It will live in exactly one file.
Scattering isometric maths across the codebase is the failure mode this naming is designed to
prevent.

---

## Camera

`CameraController` (`src/renderer/camera/`) is pure logic with no Phaser import, and is unit tested.
`PhaserCameraBinding` (`src/renderer/phaser/camera/`) copies its state onto the real camera each
frame. Nothing else moves `cameras.main` directly.

It handles zoom limits, world bounds, exponential-decay inertia, frame-rate-independent smooth zoom,
and anchored zoom that keeps the world point under the cursor or pinch centre stationary. When the
world is smaller than the viewport on an axis, it centres rather than clamping to an edge.

---

## Input

Devices do not talk to the camera. They emit intents through `InputIntentSink`:

```ts
onGestureStart(); // interrupt inertia
onPan(dx, dy); // pixels since last sample
onPanEnd(vx, vy); // px/s, for the inertia handoff
onZoom(factor, anchor); // factor > 1 zooms in
onSelect(point); // a tap that did not become a drag
```

`Game` implements this and translates intents into camera and (later) simulation commands. Two
controllers feed it:

- `PointerController` — filtered to `pointerType === 'mouse'`, plus wheel;
- `TouchController` — touch events only.

They are mutually exclusive by device type, so a hybrid laptop never processes one gesture twice.
Gesture velocity is exponentially smoothed, so a single jittery sample cannot throw the flick.

---

## Rendering boundaries

**Phaser draws** terrain, trees, buildings, villagers, resource piles, roads, particles, weather and
selection indicators — everything that lives in the world.

**HTML/CSS draws** the HUD, menus, dialogs, building panels, settings and debug output.

No DOM node ever represents a world object. At the eventual target of 100-300 villagers, DOM nodes
per entity would be fatal to performance, and the world would not compose correctly with the canvas.

---

## Build

Vite 8 (which bundles with Rolldown, not Rollup — hence `codeSplitting` rather than `manualChunks`).
Phaser is split into its own chunk so game code can be re-downloaded without invalidating the ~1.4MB
engine bundle.

TypeScript runs in strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitReturns` and `verbatimModuleSyntax` on top of `strict`. `tsc` only typechecks; Vite
transpiles.

Development-only code is guarded by `import.meta.env.DEV`, so the debug overlay is removed from
production bundles entirely.
