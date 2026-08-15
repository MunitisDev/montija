# Roadmap

Status labels: **Implemented**, **Prototype**, **Planned**.

The repository must remain buildable and runnable after every phase.

---

## Where the project is

**Phase 2 complete.** There is still no gameplay: nothing lives in the world and nothing can be
built. What exists is a deterministic isometric wilderness you can pan, zoom and tap around.

| Phase | Name                  | Status          |
| ----- | --------------------- | --------------- |
| 0     | Repository inspection | **Implemented** |
| 1     | Browser foundation    | **Implemented** |
| 2     | Isometric world       | **Implemented** |
| 3     | Villagers             | **Planned**     |
| 4     | Job system            | **Planned**     |
| 5     | Resource logistics    | **Planned**     |
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

- **Frame rate is not validated on real hardware.** The CI container has no GPU — WebGL runs on
  SwiftShader, a software rasteriser — so the 8 fps measured there reflects the absence of a GPU,
  not the game. The measurement that _does_ carry over is the JS cost above, which is negligible.
  Real-device numbers are Phase 11.
- Terrain is static: no rivers, no coastlines, no elevation. Tiles are flat diamonds.
- Trees are scenery. They are not harvestable until Phase 5.
- No occupancy or navigation grid yet — `isWalkable` reads terrain only.
- Placeholder art throughout; no seasonal variants.

---

## Phase 3 — Villagers — Planned

Villager model (id, name, age, position, home, profession, job, inventory, hunger, warmth, health),
renderer representation, movement, simple A\* navigation, idle state, debug selection.

**Done when:** 10 villagers navigate independently.

---

## Phase 4 — Job system — Planned

`JobManager`, job creation, priority, **reservation**, assignment, completion. `MoveToJob` first,
then `ChopTreeJob`.

Reservation matters: two villagers must never claim the same tree.

**Done when:** villagers autonomously find available work.

---

## Phase 5 — Resource logistics — Planned

Trees, logs, stone, inventories, resource piles, storage, hauling. Resources exist _physically_ —
cutting a tree does not increment a counter, it drops logs that someone must carry.

**Done when:** a tree is cut, logs appear on the ground, and another villager hauls them to storage.

The critical milestone. Faking logistics here would undermine every later phase.

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
