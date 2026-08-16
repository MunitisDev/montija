# Roadmap

Status labels: **Implemented**, **Prototype**, **Planned**.

The repository must remain buildable and runnable after every phase.

---

## Where the project is

**Phases 0–10 complete.** The vertical slice is playable end to end: the player moves the camera,
marks trees and stone, places buildings that villagers physically construct, and runs an economy that
must be stockpiled through a winter capable of killing it. The game saves and loads, speaks English
and Spanish, and needs neither mouse nor keyboard.

**Phase 11 (performance) is complete.** Repeatable benchmarks exist at 25/50/100 villagers, the
simulation sits under 1% of a tick at 100, and a real phone holds its display's full refresh rate
even zoomed fully out — so the game is bound by the screen rather than the GPU, and the terrain
culling this project had nominated as its first optimisation is not needed. **No maximum villager
count is claimed**: nothing has yet pushed the renderer hard enough to find one. See
[PERFORMANCE.md](./PERFORMANCE.md).

Balance is documented, and measured, in [GAME_DESIGN.md](./GAME_DESIGN.md).

| Phase | Name                  | Status          |
| ----- | --------------------- | --------------- |
| 0     | Repository inspection | **Implemented** |
| 1     | Browser foundation    | **Implemented** |
| 2     | Isometric world       | **Implemented** |
| 3     | Villagers             | **Implemented** |
| 4     | Job system            | **Implemented** |
| 5     | Resource logistics    | **Implemented** |
| 6     | Construction          | **Implemented** |
| 7     | Economy               | **Implemented** |
| 8     | Seasons and survival  | **Implemented** |
| 9     | Save / load           | **Implemented** |
| 10    | Mobile UX             | **Implemented** |
| 11    | Performance           | **Implemented** |
| 12    | Homes and population  | **Implemented** |
| 13    | Seasons on screen     | **Implemented** |
| 14    | Roads                 | **Implemented** |
| 15    | Art pass              | **Implemented** |
| 16    | Land use              | **Implemented** |

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

## Phase 6 — Construction — Implemented

**Done:** the player places a house and villagers physically construct it.

- Build menu generated from `data/buildings.ts`; adding a building is a data row.
- Frame-and-confirm placement: the ghost sits at the centre of the view and the camera positions
  it, so placement never needs precision tapping.
- One validation method shared by ghost and command, so a green ghost cannot refuse.
- Sites stay walkable until finished — blocking at placement let a site seal itself off from its
  own delivery point.
- Materials are hauled from storage through the same inventories as any other load.

---

## Phase 7 — Economy — Implemented

**Done:** the settlement produces food and firewood through real worker activity.

- Data-driven recipes; the production system never names a specific good.
- Produced goods drop on the ground beside the workshop and are hauled in, exactly like felled
  logs. Production is not a shortcut past the logistics.
- A woodcutter with no logs posts a haul and waits. It cannot split logs it does not have.

**Limitation:** villagers are not assigned to professions; anyone takes any job.

---

## Phase 8 — Seasons and survival — Implemented

**Done:** winter is capable of killing an unprepared settlement. Asserted both ways in tests — an
unprepared settlement loses people within the first year, a stocked one loses none.

- The year is pure arithmetic over the tick, so a save recording the tick records the season.
- Temperature eases across the back half of each season rather than stepping, which is what gives
  autumn the feeling of the cold closing in.
- Daily upkeep: everyone eats, and below freezing everyone burns firewood. Short rations are shared
  evenly, so a half-fed settlement weakens together.
- Exhausted hunger or warmth costs health; health reaching zero kills. The dead drop what they
  carried and release their job.

**Limitation — the important one:** the numbers are untested by play. Nothing here has been
balanced against actual enjoyment.

---

## Phase 9 — Save / load — Implemented

**Done:** a running settlement survives a browser refresh. Verified in a real browser through
IndexedDB across a full page reload: a fresh page showed a new world, and loading restored the
saved one exactly.

- Versioned format, validated before anything is trusted. A save from another version refuses
  cleanly rather than loading into a broken world.
- Only authoritative simulation state is stored — no Phaser objects, asserted by a test.
- Terrain is saved rather than regenerated, because villagers reshape it; regenerating would undo
  every clearing they made.
- Autosave every five in-game days, plus manual save and load.
- The strongest test: a loaded settlement continues tick-for-tick identically to the original.

---

## Phase 10 — Mobile UX — Implemented

**Done in the browser:** audited at 844x390, 1024x768 and 1280x800. No HUD overflow, no page
scrolling, the canvas fills the viewport at every size, and every control meets the 44px floor.

- The audit caught build buttons at 40px, below the floor this project documented for itself.
- The bottom bar wrapped to two rows on a landscape phone, costing a quarter of the screen. The
  build bar now scrolls sideways instead.
- Portrait was added afterwards, on request: the HUD reflows rather than assuming landscape.
- The resource strip was given icons so it fits one line on a phone.

**Done on hardware since:** the game has been played on a physical Android phone. Gesture feel and
frame rate are recorded in [PERFORMANCE.md](./PERFORMANCE.md). A tablet is still untested.

---

## Phase 11 — Performance — Implemented

Repeatable benchmarks at 25 / 50 / 100 villagers, plus a real-device frame-rate readout behind
`?stats`. Full figures and methodology in [PERFORMANCE.md](./PERFORMANCE.md).

- The simulation uses under 1% of its tick budget at 100 villagers.
- A real phone holds its display's full refresh rate, zoomed fully out, so the game is bound by the
  screen rather than the GPU.
- **No maximum villager count is claimed.** Nothing has yet pushed the renderer hard enough to find
  one.
- One optimisation was written and then reverted, because re-measuring did not support it. "Profile
  before optimising" taken literally, and written down so nobody re-nominates it without evidence.

---

## Phase 12 — Homes and population — Implemented

A settlement that can only shrink is not a settlement. Villagers age, are born, arrive, and die of
old age as well as of hardship.

- Houses are homes: firewood only warms people who have one.
- Births are considered at settlement level rather than per household, because tying growth to which
  two people happened to hold the spare bed produced no children at all over six simulated years.
- Immigration needs both food to spare and beds to spare, so growth is something the player earns.

---

## Phase 13 — Seasons on screen — Implemented

The year was already lethal; this is where it became visible.

- Seasonal terrain, canopy and structure palettes, drawn rather than tinted where the silhouette
  changes — a bare tree is a different shape from a full one.
- Screen-space rain and snow, running on real elapsed time so weather does not fall four times
  faster at 4x.

---

## Phase 14 — Roads — Implemented

Every economic problem this game has had turned out to be a hauling problem, and priorities only
ever decide _what_ gets carried — never how long the carrying takes. Roads are the answer to the
second half, and the first decision in the game that is about the **shape** of a settlement rather
than its contents.

- A road is a layer over the terrain, not a terrain type: felling the trees under one does not
  un-road it, and lifting one gives back the meadow rather than a patch of dirt.
- Pathfinding prefers roads through the existing cost model — no special case in the search.
- Villagers genuinely walk faster on them. A road only pathfinding believed in would make the
  settlement _slower_, by routing everyone down a track that walks like a field.
- Laying one costs labour and no materials, at the lowest job priority in the game. A settlement
  must never pave a path while its food sits in the field.
- Lifting one is immediate: it is the player correcting a route, not a job.

**Found while building it:** A\*'s heuristic assumed the cheapest possible step cost the same as
plain ground. A road undercuts that, which made the heuristic overestimate — and an overestimating
heuristic stops A\* looking, so it would have routed villagers straight across a field past the road
beside it. The heuristic is now priced at the cheapest step the grid can offer, and only while roads
actually exist, so a village that never laid one pays nothing for the fix. Benchmarks confirm no
regression.

---

## Phase 15 — Art pass — Implemented

The house style is low-poly, and until this pass most of the world was not: terrain was one flat
diamond per type, and a tree was three triangles in a single colour. Repeated nine thousand and two
thousand times respectively, that reads as coloured paper.

- **Ground is faceted**, with four hashed variants per terrain type. Rock became outcrops rather than
  grey floor, water got ripples, forest floor got litter.
- **Trees are volumes**, each with a lit and a shaded side, and there are now broadleaves as well as
  conifers — a mixed wood has a silhouette, a plantation does not.
- **Buildings gained** stone plinths, timber framing, windows, doors with lintels, roof courses,
  thatch for the cheap ones and a chimney for the house — the only building with a hearth.
- **Villagers, piles, yards and construction sites** were all redrawn with the same lit/shaded
  treatment. A site now has a sawhorse and stacked timber, so it reads as work rather than as ruin.
- **Terrain lost its outline.** It was there so tiles stayed legible where two of the same type met,
  which is not worth a lattice ruled over the whole map.

**Found while building it:** the per-cell variant hash produced exactly the diagonal stripes its own
comment claimed to avoid, because only its low bits survive a modulo and the low bits of a product
depend only on the low bits of its factors. A test written for that property caught it before it was
ever committed, and it now guards rows, columns and diagonals.

---

## Phase 16 — Land use — Implemented

The map could only shrink, so the mid-game had a hard arithmetic floor. This is
the answer, and it is an asymmetry: **timber you tend, minerals you pay for.**
Set out in full in [GAME_DESIGN.md](./GAME_DESIGN.md).

- **Woodland grows back**, needing two tree neighbours so it thickens and creeps
  rather than colonising open meadow, and stopping at about a third of the map.
- **A Forester's Lodge** plants below its target density and fells above it, and
  plants past the natural ceiling.
- **A Quarry and a Mine** must be dug into a rock face, produce without any
  input, and are permanent. **Iron** is new.
- **A Blacksmith** turns iron into **tools**, which make every job up to half
  again quicker — a bonus, never a tax, so an unequipped settlement runs at
  exactly its old speed.
- **A Field and an Orchard**, with per-recipe seasonal curves rather than one
  global one. The difference in shape between foraging and farming is the whole
  reason to sow.

**Not done, and deliberately:** this is not a reproduction of any existing
game's building list. The brief forbids copying names, designs and balance, and
the useful thing to take from the genre was the _structure_ — one resource
managed, one paid for — not its contents. Professions, trade, clothing and
health buildings remain unbuilt.
