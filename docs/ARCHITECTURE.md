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
| `Simulation`                  | **Implemented** | Owns seed, RNG, tick counter and the world. No villagers yet. |
| Isometric projection          | **Implemented** | One subsystem; the only place tile pixel sizes exist          |
| `TerrainGrid` + generation    | **Implemented** | Seeded, deterministic, `Uint8Array`-backed                    |
| `TerrainRenderer`             | **Implemented** | Reads the world; placeholder art generated at runtime         |
| Depth sorting                 | **Implemented** | Centralised rule, incl. multi-tile footprints                 |
| Pointer-to-grid picking       | **Implemented** | viewport → scene → world → grid                               |
| `Villager` + `VillagerSystem` | **Implemented** | Identity, movement, wandering. Needs inert until Phase 8      |
| `NavigationGrid`              | **Implemented** | Walkability and movement cost; ready for buildings            |
| A\* pathfinding               | **Implemented** | Deterministic, bounded, strict no-corner-cutting              |
| Render interpolation          | **Implemented** | 10Hz simulation drawn smoothly at 60fps via tick alpha        |
| `JobManager` + jobs           | **Implemented** | Priority, reservation, assignment, completion                 |
| Tree felling + designation    | **Implemented** | Clears ground and updates navigation                          |
| Logistics, resource piles     | **Planned**     | Phase 5                                                       |
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

**Four** spaces, deliberately given distinct types _and non-overlapping field names_ in
`src/shared/types/geometry.ts`. Because no two spaces share a field name, passing a value from the
wrong space is a compile error rather than a subtle half-tile offset:

| Space  | Type          | Fields     | Meaning                                      |
| ------ | ------------- | ---------- | -------------------------------------------- |
| Grid   | `GridPoint`   | `gx`, `gy` | Integer simulation tiles. **Authoritative.** |
| World  | `WorldPoint`  | `wx`, `wy` | Continuous tiles, un-projected               |
| Scene  | `ScenePoint`  | `px`, `py` | Isometric pixels — where Phaser puts objects |
| Screen | `ScreenPoint` | `sx`, `sy` | Viewport pixels — where the finger is        |

```text
grid ──gridToWorld──▶ world ──worldToScene──▶ scene ──sceneToViewport──▶ screen
     ◀──worldToGrid──       ◀──sceneToWorld──       ◀──viewportToScene──
     └──────── shared/math/isometric.ts ───────┘   └─── CameraController ───┘
```

One world unit is one grid cell, which keeps villager movement, pathfinding and building footprints
in the same natural unit and confines pixel dimensions to the isometric module.

**A deviation from the brief, deliberately.** The brief names the conversions `worldToScreen` /
`screenToWorld`. Those names assume three spaces; with a pannable camera there are four, and
"screen" would then mean two different things — the projected plane and the actual viewport. The
functions are therefore `worldToScene` / `sceneToWorld`, and the camera owns `viewportToScene` /
`sceneToViewport`. The brief's actual requirement — _one_ subsystem, no scattered projection maths —
is met exactly.

`shared/math/isometric.ts` is the only file that knows a tile is 64×32 pixels.

---

## Camera

`CameraController` (`src/renderer/camera/`) is pure logic with no Phaser import, and is unit tested.
`PhaserCameraBinding` (`src/renderer/phaser/camera/`) copies its state onto the real camera each
frame. Nothing else moves `cameras.main` directly.

It operates in **scene** space, and its bounds come from `World.sceneBounds` — the projected extent
of the actual map — so the camera limit is the map edge by construction rather than a tuned constant
that could drift out of sync.

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

## Rendering and performance

Terrain is built once as individual images: 9,216 tiles plus ~2,000 trees on a 96×96 map. Two
decisions keep that affordable:

- **All tile art lives in one texture atlas, and all tree art in another.** Depth sorting
  interleaves terrain types, and a GPU batch breaks whenever the texture changes between adjacent
  objects. With separate textures, ~9k tiles become thousands of draw calls on exactly the
  low-power tablet GPUs this project targets. One atlas means one batch, whatever the draw order.
- **The display list is only dirtied when something actually changes.** The selection marker, for
  instance, moves only when the selection version changes, because repositioning it every frame
  would force Phaser to re-sort every object.

Measured on the 96×96 default map: `step` 0 ms, render submission 4.1 ms per frame. The JS side is
effectively free.

**Container frame rate is meaningless; real-device behaviour is confirmed but unquantified.** The
development container has no GPU, so WebGL falls back to SwiftShader, a software rasteriser, and
the frame rate measured there scales with pixel count rather than with anything about the game.
Hands-on testing on the target tablet reported smooth panning and zooming and accurate tile
picking. That resolves the concern, but it is a qualitative report — no frame-rate number was
captured, so none is claimed. Repeatable benchmarks are Phase 11.

## Villagers and navigation

A villager is a simulation object. The sprite that represents it holds no state the simulation does
not already own, and decides nothing.

**Pathfinding is bounded and budgeted, by design.** Two limits exist because the project is
architected towards 100-300 villagers, where the naive version fails suddenly rather than gradually:

- every A\* search has a node budget, so an unreachable goal cannot expand the whole grid;
- at most four searches start per tick across all villagers, so no single tick can stall.

**Pathfinding is deterministic**, because save/replay reproducibility depends on it. Neighbours are
visited in a fixed order and equal scores break on insertion order — a heap keyed on object identity
would silently destroy that guarantee.

**Rendering interpolates between ticks.** The simulation steps 10 times a second and the screen
redraws 60; drawing raw tick positions would visibly stutter. Sprites are placed between the
villager's previous and current position using the clock's tick alpha. This is presentation only —
the interpolated position is never fed back into the simulation, so determinism is unaffected.

## Jobs

Villagers do not decide what to do. They ask the job board, and run whatever they are handed. That
is what keeps villager logic from collapsing into one giant conditional as work types multiply.

**Jobs are plain data.** Behaviour is keyed by `type` in the system that executes them, not carried
by the job itself. A job holding closures or subclass identity cannot be written to a save and read
back; this design serialises as-is, which Phase 9 depends on.

**Reservation is enforced twice**, because a race here produces bugs that only appear under load:

- a job can only be claimed while `available`, and claiming assigns it within the same tick;
- the _target_ is reserved as well, so a second job against the same tree cannot be created at all.

Assignment is deterministic: highest priority, then nearest, then lowest job id. That last tiebreak
is not cosmetic — without it, two villagers equidistant from two equal jobs could be assigned in an
order that depends on map iteration, and the simulation would stop being reproducible.

Unreachable work is _released_, not dropped: it returns to the board for someone else to attempt.

One sanctioned exception to isometric sorting lives in `renderer/phaser/sorting.ts`: designation
marks draw in a band above every world object. They are the player's orders rather than things
standing in the world, and sorting them as scenery buried them behind whatever tree stood in front.

## Build

Vite 8 (which bundles with Rolldown, not Rollup — hence `codeSplitting` rather than `manualChunks`).
Phaser is split into its own chunk so game code can be re-downloaded without invalidating the ~1.4MB
engine bundle.

TypeScript runs in strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitReturns` and `verbatimModuleSyntax` on top of `strict`. `tsc` only typechecks; Vite
transpiles.

Development-only code is guarded by `import.meta.env.DEV`, so the debug overlay is removed from
production bundles entirely.
