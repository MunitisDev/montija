# Roadmap

Status labels: **Implemented**, **Prototype**, **Planned**.

The repository must remain buildable and runnable after every phase.

---

## Where the project is

**Phase 4 complete.** The settlement now does work. The player marks trees, villagers claim them,
walk over and fell them, clearing the ground. Nothing is yet _produced_ — logs do not exist as
physical resources until Phase 5.

| Phase | Name                  | Status          |
| ----- | --------------------- | --------------- |
| 0     | Repository inspection | **Implemented** |
| 1     | Browser foundation    | **Implemented** |
| 2     | Isometric world       | **Implemented** |
| 3     | Villagers             | **Implemented** |
| 4     | Job system            | **Implemented** |
| 5     | Resource logistics    | **Implemented** |
| 6     | Construction          | **Planned**     |
| 7     | Economy               | **Planned**     |
| 8     | Seasons and survival  | **Planned**     |
| 9     | Save / load           | **Planned**     |
| 10    | Mobile UX             | **Planned**     |
| 11    | Performance           | **Planned**     |

---

## Phase 0 — Repository inspection — Implemented

Findings recorded at the time of scaffolding:

- The repository was **completely empty**: no commits, no files, no remote refs.
- Remote `origin` → `https://github.com/MunitisDev/montija`.
- Working branch `claude/medieval-survival-game-h02i5e`, created from nothing.
- No existing package configuration, source, or history to preserve.
- Toolchain available: Node 22.22.2, npm 10.9.7.

Nothing was overwritten or deleted, because nothing existed.

---

## Phase 1 — Browser foundation — Implemented

**Definition of done:** `npm install`, `npm run dev`, `npm run build` and `npm test` all succeed,
and the browser shows a game world placeholder with a HUD. ✅ Met.

Delivered:

- Vite 8 + TypeScript 5.9 strict + Phaser 4.2 + Vitest 4 + ESLint 10 + Prettier 3.
- Canvas fills the viewport at any aspect ratio; verified at 1280×800 and 844×390.
- HTML/CSS HUD overlay with safe-area insets and 48px touch targets.
- Camera: pan, zoom, inertia, bounds, smooth and anchored zoom — pure logic, unit tested.
- Mouse and touch controllers feeding one device-independent intent interface.
- Simulation clock with pause / 1x / 2x / 4x and a spiral-of-death guard.
- Seeded RNG with per-system streams and serialisable state.
- Dev-only debug overlay.
- 47 tests, no Phaser and no DOM required.
- Lint rules that fail the build if the simulation imports Phaser, touches the DOM, or calls
  `Math.random()`.

**Known limitations** — all expected at this phase:

- The world is a flat checkerboard, not isometric. Phase 2 replaces `WorldScene` entirely.
- `Simulation` holds no world, villagers, buildings or jobs. It counts ticks.
- HUD resource and season readouts show `--`; only the speed controls are live.
- Tapping draws a marker ring. There is nothing selectable yet.
- No save/load, no audio, no asset pipeline (no art exists to load).
- No automated browser tests. Phase 1 was verified with a scripted Chromium pass, not a committed
  E2E suite.

---

## Phase 2 — Isometric world — Implemented

**Definition of done:** the player can move around a deterministic isometric world. ✅ Met.

Delivered:

- Four distinct coordinate spaces with non-overlapping field names, so the compiler catches a value
  used in the wrong space: grid `(gx, gy)`, world `(wx, wy)`, scene `(px, py)`, screen `(sx, sy)`.
- One isometric projection subsystem (`shared/math/isometric.ts`) holding every grid↔world↔scene
  conversion and the only two tile-pixel constants in the codebase.
- `TerrainGrid`: a flat `Uint8Array` of terrain indices — one 9KB buffer rather than ~9k objects,
  and trivially serialisable for Phase 9.
- Seeded world generation from two value-noise fields, producing grass, meadow, forest, water and
  stone, plus scattered trees. Each stage draws from its own named RNG stream.
- Terrain renderer reading the simulation's world, with placeholder art generated at runtime.
- Centralised depth sorting (`renderer/phaser/sorting.ts`), including the front-most-corner rule
  for multi-tile footprints.
- Camera bounds derived from the world's projected extent, so the map edge is the camera limit.
- Pointer-to-grid picking: viewport → camera → scene → isometric → world → grid.
- A contextual tile panel showing what was tapped.

**Measured, not assumed:**

- 96×96 map = 9,216 tiles + 1,973 trees = 11,190 render objects.
- JS cost per frame: `step` 0 ms, render submission 4.1 ms.
- Terrain mix varies widely by seed (water 2%–35%); every surveyed seed stays above 50% habitable.

**Known limitations:**

- **Frame rate is confirmed smooth on a real tablet, but not yet quantified.** The CI container
  has no GPU — WebGL runs on SwiftShader, a software rasteriser — so the 8 fps measured there
  reflects the absence of a GPU, not the game. Hands-on testing on the target device reported
  smooth panning, zooming and accurate tile picking, which resolves the concern raised by the
  container numbers. No frame-rate figure is recorded because none was captured; repeatable
  benchmarks remain Phase 11.
- Terrain is static: no rivers, no coastlines, no elevation. Tiles are flat diamonds.
- Trees are scenery. They are not harvestable until Phase 5.
- No occupancy or navigation grid yet — `isWalkable` reads terrain only.
- Placeholder art throughout; no seasonal variants.

---

## Phase 3 — Villagers — Implemented

**Definition of done:** 10 villagers navigate independently. ✅ Met — verified in-browser: all ten
spawned, all ten moved, 8 walking concurrently, 0 pathfinding failures, all on walkable ground.

Delivered:

- `Villager`: id, name, age, continuous position, activity. `hunger`, `warmth` and `health` exist
  because the brief's initial model lists them, but **nothing changes them until Phase 8** — they
  are inert fields, not a working needs system.
- `NavigationGrid`: walkability and movement cost derived from terrain, with `block()` ready for
  buildings in Phase 6. Pathfinding reads this, never the terrain directly.
- Grid A\* with a binary heap and an octile heuristic. Eight-way movement with **strict**
  no-corner-cutting: a diagonal needs both orthogonal neighbours clear, so a villager can never
  clip the corner of an obstacle.
- Deterministic by construction: fixed neighbour order and insertion-order tie-breaking, so the
  same request always returns the identical path.
- Bounded by construction: every search has a node budget, so an unreachable target cannot expand
  the whole map and stall a frame.
- Wandering behaviour for idle villagers — a placeholder for the Phase 4 job system, so navigation
  could be seen and tested on its own.
- Path requests budgeted to 4 per tick, so the two hundred villagers the project targets cannot all
  search on the same tick.
- Render interpolation: sprites are drawn between the previous and current tick position using the
  clock's tick alpha, so 10Hz simulation looks smooth at 60fps. Presentation only — the
  interpolated position never re-enters the simulation.
- Tap-to-select a villager, showing name, age and activity.

**Known limitations:**

- Villagers wander aimlessly. They have no purpose until the job system exists.
- No animation: sprites are a single static pose, with no walk cycle and no facing direction.
- Villagers pass through each other; there is no collision or local avoidance.
- `homeId`, `profession` and `currentJobId` are not modelled yet (Phases 6, 7 and 4).
- Paths are not re-planned if the world changes underneath them; nothing changes the world yet.

---

## Phase 4 — Job system — Implemented

**Definition of done:** villagers autonomously find available work. ✅ Met — verified in-browser:
10 trees designated, jobs claimed and worked without intervention, trees felled, ground cleared.

Delivered:

- Jobs are **plain data**, not objects with behaviour. Behaviour lives in the system that runs
  them, keyed by type. A job carrying closures or subclass identity could not be written to a save;
  this serialises as-is, which is what Phase 9 will need.
- `JobManager` with priority, distance and id tie-breaking, so assignment is reproducible.
- **Reservation enforced twice.** A job can only be claimed while available, _and_ its target is
  reserved so a second job against the same tree cannot even be created. Two villagers claiming one
  tree is the failure this phase exists to prevent.
- Full lifecycle: available → reserved → inProgress → complete, plus release (unreachable work goes
  back on the board rather than vanishing) and cancel.
- `chop-tree` jobs, designated by tapping a tree and pressing Fell.
- Felling clears the ground: forest becomes grass, and the navigation grid is updated in step. This
  is how the player will open land for building in Phase 6.
- Villagers walk to an adjacent cell to work, since a tree occupies its own.
- Debug overlay reports open, taken and completed jobs.

**Tested:** 31 job tests, including one that runs 600 ticks asserting no two villagers ever hold
the same job, and one that asserts the whole run stays deterministic with jobs in play.

**Known limitations:**

- Felling a tree produces nothing. Logs become physical resources in Phase 5.
- Only two job types exist, and `move-to` is not yet reachable from the UI.
- No job cancellation from the villager's side — a villager holding an unreachable job releases it
  only at claim time, not if the world changes mid-walk.
- No professions or work priorities per villager; anyone takes any job.

---

## Phase 5 — Resource logistics — Implemented

**Definition of done:** a tree is cut, logs appear on the ground, and another villager hauls them to
storage. ✅ Met — verified in-browser: six trees felled, up to 12 logs lying in the field and 8 in
villagers' arms at once, all delivered to the yard.

Delivered:

- Data-driven resources: logs, firewood, stone, food, each with a stack size and a carry limit.
- One `Inventory` class serving villagers, ground piles and storage yards. **Every transfer in the
  game goes through `Inventory.transfer`**, which conserves: it removes exactly what the destination
  accepted, so nothing is created and nothing evaporates in transit.
- `ResourcePile`: resources lying on a cell, merging by resource, reserved while a hauler is en
  route.
- `Storage` and a founding storage yard, since construction does not exist until Phase 6.
- Two-stage `haul` jobs — collect, then deliver — modelled as a stage on one job so the pile stays
  reserved for the whole round trip.
- `gather-stone`: mining a surface deposit drops stone and turns impassable rock into walkable
  grass.
- HUD totals that are an explicit **cached summary** of what the yards hold, with a `+n` hint for
  units still in the field.

**The invariant that makes this honest**, asserted in the tests: for any run,

```text
trees felled x logs per tree  ==  stored + lying on the ground + carried by villagers
```

**Tested:** 32 logistics tests, including that invariant, that a full yard makes a hauler put the
remainder back on the ground rather than deleting it, and that no two villagers ever haul the same
pile across 3,000 ticks.

**Known limitations:**

- Nothing consumes resources yet. Firewood and food have definitions but no source.
- Only one storage yard, granted at founding; the player cannot place more until Phase 6.
- Haulers carry from one pile at a time — no route planning or multi-pickup trips.
- A villager whose destination yard fills mid-delivery drops the remainder where they stand, which
  is safe but not clever.

---

## Phase 6 — Construction — Planned

Build menu driven by data, ghost placement, footprint validation, construction sites, material
requirements, physical delivery, builder jobs, completion.

**Done when:** the player places a house and villagers physically construct it.

---

## Phase 7 — Economy — Planned

Gatherer Hut, Woodcutter, profession slots, recipes, production jobs.

**Done when:** the settlement produces food and firewood through real worker activity.

---

## Phase 8 — Seasons and survival — Planned

Year clock, four seasons, temperature, food and firewood consumption, health consequences, death.

**Done when:** winter can kill an unprepared settlement.

At this point the MVP goal — _survive the first winter_ — becomes playable.

---

## Phase 9 — Save / load — Planned

Versioned save schema, IndexedDB persistence, autosave, manual save/load. Authoritative simulation
state only; never serialised Phaser objects.

`docs/SAVE_FORMAT.md` is written in this phase, when there is a real format to describe.

**Done when:** a running settlement survives a browser refresh.

---

## Phase 10 — Mobile UX — Planned

Real-device testing and refinement of touch camera, pinch zoom, building placement, selection,
menus, text size, safe areas, landscape phone and tablet.

**Done when:** no mouse or keyboard is required to play.

---

## Phase 11 — Performance — Planned

Repeatable benchmarks at 25 / 50 / 100 villagers, recording FPS, simulation tick time, pathfinding
time and render object count.

Initial target: 50 villagers comfortably. Architected toward 100-300. **No maximum will be claimed
until benchmarks exist.**

Profile before optimising.
