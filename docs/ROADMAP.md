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

| Phase | Name                           | Status          |
| ----- | ------------------------------ | --------------- |
| 0     | Repository inspection          | **Implemented** |
| 1     | Browser foundation             | **Implemented** |
| 2     | Isometric world                | **Implemented** |
| 3     | Villagers                      | **Implemented** |
| 4     | Job system                     | **Implemented** |
| 5     | Resource logistics             | **Implemented** |
| 6     | Construction                   | **Implemented** |
| 7     | Economy                        | **Implemented** |
| 8     | Seasons and survival           | **Implemented** |
| 9     | Save / load                    | **Implemented** |
| 10    | Mobile UX                      | **Implemented** |
| 11    | Performance                    | **Implemented** |
| 12    | Homes and population           | **Implemented** |
| 13    | Seasons on screen              | **Implemented** |
| 14    | Roads                          | **Implemented** |
| 15    | Art pass                       | **Implemented** |
| 16    | Land use                       | **Implemented** |
| 17    | Professions                    | **Implemented** |
| 18    | Clothing                       | **Implemented** |
| 19    | Trade                          | **Implemented** |
| 20    | Demolition                     | **Implemented** |
| 21    | Health                         | **Implemented** |
| 22    | Start screen and guide         | **Implemented** |
| 23    | People, families and postings  | **Implemented** |
| 24    | Households                     | **Implemented** |
| 25    | The coast and the camp         | **Implemented** |
| 26    | Smoke and trade props          | **Implemented** |
| 27    | The settings cog               | **Implemented** |
| 28    | Stores, clock and ledger       | **Implemented** |
| 29    | Getting home                   | **Removed**     |
| 30    | The build menu                 | **Implemented** |
| 31    | Light and value                | **Implemented** |
| 32    | Spirit                         | **Implemented** |
| 33    | The silent dead ends           | **Implemented** |
| 34    | Roads, growth and the ages     | **Implemented** |
| 35    | Whole numbers and a last page  | **Implemented** |
| 36    | The labour panel               | **Implemented** |
| 37    | The wood tends itself          | **Implemented** |
| 38    | Room left in the sheds         | **Implemented** |
| 39    | The river                      | **Implemented** |
| 40    | The harvest that arrives       | **Implemented** |
| 41    | Each thing in its own building | **Implemented** |
| 42    | Castilian names                | **Implemented** |
| 43    | Built off the ground           | **Implemented** |
| 44    | The store nobody could reach   | **Implemented** |
| 45    | Buildings that sit on plots    | **Implemented** |
| 46    | The house, from a recipe       | **Implemented** |

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
- Terrain mix varies by seed (water 3%–12% since Phase 39 lowered the pond line); every surveyed seed
  stays well above 50% habitable.

**Known limitations:**

- **Frame rate is confirmed smooth on a real tablet, but not yet quantified.** The CI container
  has no GPU — WebGL runs on SwiftShader, a software rasteriser — so the 8 fps measured there
  reflects the absence of a GPU, not the game. Hands-on testing on the target device reported
  smooth panning, zooming and accurate tile picking, which resolves the concern raised by the
  container numbers. No frame-rate figure is recorded because none was captured; repeatable
  benchmarks remain Phase 11.
- Terrain is flat: no elevation, no cliffs. Tiles are flat diamonds. (A river arrived in Phase 39; it
  is cut into the map rather than flowing downhill, because there is no downhill.)
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

---

## Phase 17 — Professions — Implemented

Villagers take posts at buildings rather than drifting to whichever job is
nearest. Set out in [GAME_DESIGN.md](./GAME_DESIGN.md).

- Employment rather than a profession list: the buildings carry the trades, so
  adding a workshop adds a trade and nothing has to learn its name.
- A worker quota per building, adjustable from its panel — the lever the
  settlement was missing.
- Employees are reserved _to_ their workshop, not _idled in_ it: they fell and
  haul when their workshop has nothing for them.
- A workshop whose season yields nothing posts no work at all, and cancels what
  is left on the board. Two gatherers miming a harvest all winter, at the
  highest priority in the game, would have refused to haul while producing
  nothing.

**Found while building it:** the difficulty curve moved, because committing four
of ten people to workshops is a genuine cost. The balance tests were rewritten
to describe the new curve rather than retuned to hide it — one hut now starves,
two scrape through, three prosper.

---

## Phase 18 — Clothing — Implemented

The third need, with a production chain behind it rather than a number bolted
on. Set out in [GAME_DESIGN.md](./GAME_DESIGN.md).

- A **Hunter's Cabin** yields meat and hides, and is the only work in the game
  that still pays under snow.
- A **Tailor** sews hides into clothing.
- A coat is a second line of warmth, never a replacement for a fire: measured,
  it turns an empty woodshed from fatal on day 13 into survivable past day 17,
  against a season of 15.

The resource strip only shows a readout once the settlement has ever had any of
it. Eight resources plus a population count do not fit across a phone held
upright, and a strip that scrolls sideways to reveal a row of zeroes is worse
than one that shows what the settlement actually has.

---

## Phase 19 — Trade — Implemented

The way out of a map that will not give you something. Set out in
[GAME_DESIGN.md](./GAME_DESIGN.md).

- A **Trading Post**, and a merchant who calls in fair weather and never in
  winter.
- Largest surplus swapped for scarcest good, at three to one — deliberately a
  bad rate, because trade must never be the efficient way to get anything.
- Food and firewood are never sold, and a surplus has to clear a floor before it
  counts as one.

The player names what to buy and sell from the post's panel, or leaves either on
automatic. Naming a good does not override the safeguards.

---

## Phase 20 — Demolition — Implemented

Nothing could be un-built, which mattered more the moment quarries and mines
arrived: a permanent building in the wrong place was a permanent mistake.

- A construction site is cancelled at once and hands back its delivered
  materials.
- A finished building is a job: somebody tears it down, and half the cost comes
  back as salvage on the plot.
- Ordering again cancels the order, so the button is its own undo.
- Lowest priority in the game, alongside roads.

Five things hold a reference to a building — its plot in the navigation grid,
its staff, its yard, the jobs aimed at it and anyone walking to one — and each
has its own test, because a demolition that misses one leaves a ghost the player
cannot see and cannot fix.

---

## Phase 21 — Health — Implemented

Health already existed and had exactly one cause: it fell when somebody was
starving or freezing. That made it a second readout of hunger and warmth rather
than a thing of its own, and it meant a settlement with full stores could never
be in any trouble at all, however large or badly housed.

- **Illness** arrives on its own schedule, five times as often for somebody with
  no roof over them, and does not care how full the granary is.
- An ill villager **stops working** for eight days. That is the whole cost:
  illness takes hands, not health.
- A **Herbalist's Hut** gathers herbs while things grow. They keep.
- A **Healer's House** shortens a case, using both staff and herbs. Either one
  missing and it treats nobody.
- Nothing is contagious. Each villager is rolled independently.

Illness costing work rather than health took three measurements to arrive at.
Every version that drained health did the same damage: a settlement that would
have reached winter lost somebody in _autumn_ instead, because a villager who
had been ill during the good days met the bad ones with less to spare. Softening
the numbers did not help, and neither did a floor, and neither did suppressing
the drain while somebody was already starving — the front-loading was the
problem, not its size. Costing work still kills a marginal settlement, but it
kills by starvation in winter, which is the failure this game is about.

The base rate is measured rather than picked. A case costs eight days of
somebody's work, and a ten-person settlement has only two or three pairs of
hands not already committed to a workshop — so the labour bill is far steeper
than the case count suggests. At twice the shipped rate, a settlement playing
well lost most of the food it had banked for winter, which made sickness the
game's dominant mechanic rather than its third one.

---

## Phase 22 — Start screen and guide — Implemented

The game began mid-simulation, with no title and no explanation. A player who did not already know
what Montija was had nowhere to find out, and the only route back to a saved settlement was a button
in the corner of a HUD they had not yet learned to read.

- A **start screen** over the founded world: Continue, New settlement, How to play, and the language
  toggle. The clock is paused while it is open.
- **How to play**, reachable from the menu and from the settings cog while playing. Opening it
  mid-game pauses; closing it puts the clock back where it was.
- Seven sections: the objective, how work happens, the controls, the year, what kills a settlement,
  every resource, and every building.

**The building and resource sections are generated from `data/buildings.ts` and `data/resources.ts`**,
with real costs and real staffing read from the definitions. A guide written by hand rots — someone
adds a building or changes a cost and the page quietly starts lying, and nothing fails, because prose
does not compile. `tests/guide.test.ts` holds it to that: every building covered, every resource
covered, costs matching the definitions, and no missing string in either language.

Content and rendering are separate for the same reason. `guideContent.ts` produces the guide as
data with no DOM, so it can be tested headlessly; `Guide.ts` only decides how it looks.

Two notes on what this deliberately is not. **"New settlement" does not found a new one** — the world
behind the menu is already new, and re-founding would discard it to generate an identical
replacement. And there is no in-game pause menu; the settings sheet covers the case that matters, and
beginning again after a settlement dies is the failure overlay's job, which it already does.

---

## Phase 23 — People, families and postings — Implemented

Three things the settlement could not do: show you its people, tell you who they
are to each other, or let you say who does what.

### Postings

Quotas already answered "how many people at this workshop". They could not
answer "this person, at that workshop". A villager now carries one of three
states — automatic, posted to a building, or kept a labourer on purpose.

The third is the one that could not be expressed before: an unemployed villager
is exactly who automatic hiring grabs for the next vacancy, so there was no way
to say "leave this one carrying things".

A posting displaces somebody the settlement merely placed at a building, never
somebody else the player posted. Without that it silently did nothing whenever
the workshop was full, which is most of the time, and the control would have
looked broken for reasons the game never explains.

### Families

Couples form on their own and have the children; a child records its parents and
joins their household. Set out in [GAME_DESIGN.md](./GAME_DESIGN.md), including
why pairing is not conditional on sharing a house and the measurement showing
families cost the growth curve nothing.

### The people panel

Everyone, grouped by household, with a work picker per adult. Content and
rendering are separate, as with the guide: `rosterModel.ts` produces the panel
as data with no DOM so it can be tested headlessly, and `Roster.ts` only decides
how it looks.

**Tools and clothing are shown as settlement-wide coverage, not per person,**
because that is what they are. Anything else would have been an invention.

### Job priorities — investigated, deliberately unchanged

Whether the player should set per-building work priorities was measured rather
than guessed. Construction is not starved by hauling, four concurrent sites all
complete, and the backlog that forms under load is felling — which is what
should queue. A priority slider would be a third lever overlapping two that
already exist. See
[GAME_DESIGN.md](./GAME_DESIGN.md#should-the-player-set-priorities--measured-and-no)
for the figures and for what would change the decision.

---

## Phase 24 — Households — Implemented

Families that read like families. Set out in
[GAME_DESIGN.md](./GAME_DESIGN.md#families--implemented).

- Villagers have a **sex**, used for nothing but who pairs with whom and which
  given-name list they are drawn from.
- A child takes **its father's family name**, so a household shares one.
- **Couples move in together** — his house, then an empty one, then hers.
- **A house is a household, not a dormitory:** a couple only settles somewhere
  with no other adults in it.

That last rule fixed something real. The daily housing pass packed four
unrelated adults into every four-bed cottage, so a child born to either couple
had nowhere to sleep but a different house — measured, _none_ of a settlement's
children lived with a parent. They do now.

Both changes were measured against the same six-year run before them and cost
the growth curve nothing: population 28 on six seeds out of six, 8-12 births,
unchanged even on the seeds that founded 6f/4m and 4f/6m.

Two existing tests had to change, and neither was retuned to hide anything:

- The balance suite claimed two gatherer huts survive the first winter. That was
  true by a couple of days' margin, and adding one random draw per villager
  tipped it. It now asserts the **ordering** - one hut dies, two huts die later,
  three survive - which is what the game actually promises and is stable.
- The tools test compared one settlement over twelve days, where the bonus is
  worth about one completed job. It now sums four seeds.

---

## Phase 25 — The coast and the camp — Implemented

The settlement finally has a reason to exist. Set out in
[GAME_DESIGN.md](./GAME_DESIGN.md#where-they-came-from--implemented).

> Built as a **shipwreck** and rewritten in Phase 34: castaways contradicted two
> systems the game already had — newcomers walking in, and a merchant calling
> every twelve days. The world generation below is unchanged; only the story is.
>
> **And the sea itself went in Phase 39**, replaced by a river through the middle
> of the map. Water at one edge was scenery; water through the middle is a
> decision. What follows describes the map as it was, not as it is.

- **Every map has a sea**, on one edge, chosen from the seed and cut out of the
  same elevation noise so the coast wanders.
- The settlers **make camp** within sight of it, and the starting yard is what
  they carried. The camera opens on it.
- What they carried is **timber, food and a little unusable iron - and no stone**.
- The Gatherer Hut costs timber only, so finding a quarry is urgent without
  being fatal.

Three existing tests changed, and none of them was retuned to hide anything:

- `prepared` banks about 40 food by winter rather than about 100, because the
  whole settlement runs a few days later without salvaged stone. The bar moved
  from 60 to 30 and the reason is written next to it.
- The no-houses run used to freeze in winter with full yards. It now **starves
  in autumn with its warmth at 100**, because sleeping rough makes people ill,
  an ill villager does no work, and a short-handed settlement cannot gather -
  19% idle against 12%, and 148 food brought in against 231. The test now
  describes that instead of a cause of death that has moved.
- The trade test named its trade. With no salvaged stone, _stone_ is what a new
  settlement has least of, so an automatic post quite correctly buys that
  instead of the iron the test is about.

---

## Phase 26 - Smoke and trade props - Implemented

Two changes, both aimed at the same complaint: the settlement looked like a
diagram of a settlement. Set out in [ART_BIBLE.md](./ART_BIBLE.md).

- **Hearth smoke** from the four buildings with a fire in them, rising, drifting
  downwind, thinning and dying. Heaviest in winter, never quite zero.
- **A trade prop** on the plot of seven buildings - a log pile, a forge, drying
  racks, a cart, a heap of spoil - because mass and colour alone leave a
  Woodcutter and a Tailor looking identical.

Both are procedural rather than painted assets, which is what makes them free
to keep consistent: one lighting direction, one palette, one projection, and
seasonal variants that cost nothing. Smoke could not have been a static image
at all.

---

## Phase 27 - The settings cog - Implemented

**If it is not about the settlement, it is not on the screen.** The rules, full
screen, language, save and load had accumulated into a row of buttons in the top
bar and a pair in the corner of the bottom one. On a phone held upright that was
enough to push the top strip onto a third line, costing a band of the world on
both edges to show controls a player touches once a session.

They are behind one cog now, in a sheet built like the guide and the people
panel: it pauses on open through the same helper, and puts the clock back
exactly as it was on close. What is left on the main screen is the settlement -
resources, the calendar, the people icon, the cog, the build bar, the speed
buttons.

Two details in [MOBILE_UX.md](./MOBILE_UX.md): **How to play** opens from the
sheet and returns to it rather than dropping the player back in the settlement,
and there is **no audio control**, because there is no audio and a slider that
adjusts nothing is worse than no slider.

The language chip stays on the start screen too. Somebody who cannot read the
interface has to be able to change it before founding anything.

---

## Phase 28 - The stores, the clock and the ledger - Implemented

Three changes to the top bar, all answering the same question: where do the
settlement's numbers live as the game learns to make more things.

- **The resource strip is a button.** It carries the four a settlement lives or
  dies by; a tap opens a drawer with every good it has met, each with what is
  stored, what is lying in the field, and the net over a season. The drawer does not
  pause and does not take the screen — a glance at the stores is not stopping to
  read.
- **One button for the clock**, cycling pause, 1x, 2x, 4x. The four speed
  buttons in the bottom bar are gone, and the build menu has that row to itself.
- **A ledger**, in four tabs: people, buildings, production, consumption. It
  pauses like the other sheets.

The ledger is where the honesty question lives. Its counts are the settlement
restated and must be exact; its production and consumption figures are estimates
and say so in as many words. Demand is read from `SurvivalSystem`'s own
constants rather than a second set copied into the UI, so a balance change
cannot leave the sheet lying, and `tests/ledger.test.ts` checks all of that.

Set out in [MOBILE_UX.md](./MOBILE_UX.md), including why the drawer is the one
overlay in the game that leaves the clock running.

---

## Phase 29 - Getting home - Removed

The game's only **win condition**, built in this phase and **taken out again in
Phase 34**. Recorded rather than deleted, because the reasoning is worth keeping
and half of it survives.

What it was: a **School** let the settlement write for help, a villager carried a
bottle to the waterline, and about forty years later a ship came. A rescue tab led
the ledger, and a closing page opened itself when the ship landed.

Why it went: it was the other half of the shipwreck, and the shipwreck went. A
premise about castaways on an unreachable coast contradicted two systems the game
already had — strangers walk in to join a settlement, and a merchant calls every
twelve days. The endgame is now meant to be walls and a watch against the thing
the settlers left, and a ship home does not belong in that story.

What survived it:

- **The chronicle**, which was always the interesting part of that ending. It now
  has a ledger tab of its own, last rather than first, because it is the only page
  about the past.
- **The School**, still buildable and currently doing nothing, kept because
  settlements already have them standing and because a school is the right
  building for the specialisation system that is coming. Its description says it
  has no effect, which is better than a panel promising one it has not got.
- The observation that **a save must survive a feature being removed**. Saves
  written before this carry a `rescue` field nothing reads; an unknown field is
  ignored rather than rejected, and `tests/save.test.ts` pins that.

Gone with it: `RescueSystem`, the `carry-message` job, the tideline lookup, the
closing page, and about thirty translated strings in two languages.

---

## Phase 30 - The build menu - Implemented

Seventeen buttons in a horizontal scroller is not a menu. Finding a House meant
swiping sideways past sixteen other things, and the strip only gets longer.

The bar carries **five categories** now - Shelter, Food, Materials, Workshops,
Settlement - and tapping one opens a grid of that category's buildings above it.
Two to four buildings each: one row on a tablet, two on a phone, nothing
scrolling at any size. The category is a field on the building definition, so
adding a building is still a row in a data file.

The cards carry the **price**, with a material the settlement has none of marked
in red. Not "cannot afford" - materials are hauled to a site as they arrive, so
a site can be started short. Having none usually means an economy that has not
been built yet, which is why a School reads as out of reach until there is a
quarry.

Set out in [MOBILE_UX.md](./MOBILE_UX.md), including why the panel sits above
the bar rather than over the world and why the bar wraps in portrait rather than
truncating what it says.

---

## Phase 31 - Light and value - Implemented

Asked whether the art could reach the quality of a low-poly 3D render. Two
findings, and the second was the one that mattered.

**Shading detail helps a little.** Contact shadows with a penumbra, ambient
occlusion where walls meet the ground and the roof, a lit arris on the wall
corner, a fascia so the roof slab has thickness, and framed and recessed doors
and windows. All of it now lives in one module, `shading.ts`, so buildings,
trees and villagers cast the same way - and all of it is free at runtime,
because every object is drawn into its texture once at load.

**Value separation helps enormously.** Every building was brown walls under a
slightly darker brown roof, which zoomed out is one silhouette with no parts.
Repainting the seventeen palettes so a roof and its wall differ clearly in
lightness - limewashed daub under russet tile for a house, pale cut stone under
slate for a quarry, dressed stone for the school - did more than every piece of
shading above put together. "Muted" had been read as "low contrast".

Set out in [ART_BIBLE.md](./ART_BIBLE.md).

**What this does not reach**, and cannot: the ray-traced soft shadows and
bevelled geometry of an actual 3D render. That needs pre-rendered sprites - a
model, one camera, one sun, batch rendered - which is roughly 70 images for the
finished buildings alone plus construction stages, and costs the free seasonal
variants and continuous build progress that procedural art gives. A separate
decision, and one that needs an artist.

---

## Phase 32 - Spirit - Implemented

A cemetery and a temple, and the fourth need they answer.

The settlement had nowhere to put its grief: people died and simply stopped
being in the list. **Spirit** gives that somewhere to go, as a meter alongside
hunger, warmth and health - and unlike those three it **cannot kill anybody**.

It sits at 50, which is neutral and worth nothing. Above it everyone works
faster, up to +25%. Below it nothing at all happens. A settlement that builds
neither building plays exactly the game it played before either existed, which
is the property the tests hold hardest: adding depth must not be a way of
quietly adding difficulty to an opening that already kills seven seeds in
eight.

The **Cemetery** is cheap, unstaffed and mostly stone, and is worth a third of
the settlement's solace. The **Temple** costs timber and a villager's working
life, and is worth nearly two thirds. Either alone is worth building. Only
death pushes spirit down, and what a death really costs is the climb back -
which a settlement with a temple makes and one without does not.

The build menu grew a sixth category, **Care**, taking the herbalist and the
healer: the settlement group had reached six buildings, which is past the point
where a group still reads without scrolling.

Set out in [GAME_DESIGN.md](./GAME_DESIGN.md), including why the fourth need is
a bonus rather than a requirement.

---

## Phase 33 - The silent dead ends - Implemented

A played game reported a blockage: piles of logs on the ground, villagers
walking back and forth doing nothing, and a dozen houses that never finished.

Reproduced headlessly rather than guessed at, and the cause was exact: **every
site was waiting for stone, and the settlement had none.** A wrecked settlement
comes ashore with no stone at all, so a player who orders houses before finding
a rock face stalls every one of them. The board fills with felling work, the
villagers get on with that, and nothing is ever built.

The banner made it worse. It was saying _"people have no house for the winter -
build Houses"_ to a player who had ordered twelve. The game was answering a
question nobody asked while the actual problem went unmentioned for forty days.

Two warnings, and one thing the guidance stops saying:

- **Building work has stopped** - naming the material, and only when the store
  is at zero. A site short of stone while a quarry cuts it is waiting, not
  stalled.
- **Goods are lying in the field with nowhere to go** - the other silent dead
  end, where `createHaulJobs` correctly leaves a pile alone because no yard will
  take it, and said nothing.
- **No more asking for houses that are already going up.**

And one real logistics fix, asked for while the above was being written: when
no yard will take a pile, the settlement now carries it **straight to a building
site that needs it**. Full yards of stone used to block timber entirely - the
pile sat, the sites waited for that timber, and the yard was never going to
empty itself. A fallback rather than a preference: sites first would reroute the
whole economy and starve the yards, so it only fires where the alternative is
nothing happening at all.

The stalled-site warning was not a simulation bug - a house cannot be built
without stone, and what was broken is that the game knew and did not say. Set
out in [GAME_DESIGN.md](./GAME_DESIGN.md).

---

## Phase 34 — Roads, growth and the ages — Implemented

Three player reports from a year-six game, plus the story rewrite they made
necessary.

**"Nobody makes roads."** Paving was the only job in the game at `low` priority,
on the theory that roads get built with the hours nobody else needed. There are no
such hours: a running settlement always has a tree marked or a load to carry, so
the order sat on the board for ever. Measured on a two-year-old settlement of
nineteen people — nine roads ordered, **nought laid** in fifteen days. At `normal`
all nine go down, and hauling being `high` keeps the rule `low` was protecting.

**"The population has settled at twenty."** Measured on a kept-fed, kept-housed
settlement over twenty years: 24 people in year four, still 24 in year twenty.
Sixteen years flat. Three causes, each reasonable on its own — one birth roll per
_settlement_ per day rather than per couple; a house counting _residents_ rather
than grown-ups, so a family of four blocked every birth in the village; and one
age doing the work of three. Same fixture after: 35 by year two, 63 by year six.

**The four ages.** Working age 14, adulthood 18, retirement 60, and a lifespan
near seventy that illness shortens — which is what a Healer's House is finally
worth. Pairing needs both partners 18+ and within six years, matches the closest
in age rather than whoever arrived first, and has no upper limit so a widow can
marry again. Bearing children is the mother's window alone, 18 to 40.

**The founding party is seven grown-ups and three near-adults.** Without them the
second generation does not arrive until year eighteen and then arrives all at once.

**The shipwreck went, and the rescue arc with it.** See Phase 29 above, and
[GAME_DESIGN.md](./GAME_DESIGN.md#where-they-came-from--implemented). The world
generation is untouched; the premise is now simply that they left a village
something came into one night. The **starting seed is random**, so a new game is a
new valley — `Math.random` in `app/config.ts`, which is the one place before a
world exists and three directories away from the simulation that must never roll
its own dice.

Two balance claims had to be rewritten rather than retuned. A one-hut settlement
no longer _dies_ on the reference seed — a village with three teenagers in it is
smaller in its first year, and one hut nearly feeds it — so the hut ladder is now
asserted where it is still visible: **food banked entering winter**, 5 on one hut,
47 on two, 52 on three, averaged over 24 seeds.

---

## Phase 35 — Whole numbers, whole rocks, and a closing page — Implemented

Three more player reports, and the last one turned into the end of the game.

**"Tools are generated in decimals."** Quite right: three things wear at less than
one a day, and the fraction came straight out of the yard, so a settlement of ten
held 99.5 tools. Stores now hold whole things and the remainder is carried as a
running tab — see
[GAME_DESIGN.md](./GAME_DESIGN.md#stores-hold-whole-things--implemented).

**"Show estimates by the month so they round."** There are no months — the calendar
is four seasons of twelve days — so every rate on screen is quoted **by the season**
instead: 123 stone rather than 10.3, −6 tools rather than −0.5. The conversion
happens once, at the point of printing, in `ui/format/rates.ts`; everything behind
it is still per-day, because the simulation spends by the day and "stores last about
four days" needs a daily figure to divide by.

**"The cross on a stone deposit sits too high, as if it were a tree."** It was
literally that: the mark table gave mining the same 34-pixel lift as felling. A tree
is a 96-pixel sprite; a deposit is a few low boulders drawn into the ground tile.
The lift is now derived from the boulder art itself, so retuning the rocks moves the
mark with them.

**The closing page.** Asked for as "statistics at the end of the game, including the
whole population, what each of them died of and at what age" — and it replaces four
words and a button. Every death is recorded as it happens, and the end screen shows
the settlement's totals, a count by cause, and the roll of everyone who lived here.
See [GAME_DESIGN.md](./GAME_DESIGN.md#the-closing-page--implemented), including why
illness is not one of the causes.

Also verified rather than changed: selecting the ground under a building. Every cell
of a footprint selects the building and the tile panel stays shut, which Phase 33
already fixed — confirmed cell by cell in the browser.

---

## Phase 36 — The labour panel — Implemented

"A menu where you can see at a glance the buildings, their worker occupancy and
the labourers available, with +/- buttons on screen, giving priority to the
labourers who are specialists in that job."

The priority half shipped in Phase 34; this is the menu. Every workplace on one
page, the labourers counted at the top, who is at each post and what they are worth
at it, and a stepper per row. Its own door in the top bar rather than a tab of the
ledger: the ledger reports and never acts, and controls scattered through a page of
figures stop it being a page of figures.

See [GAME_DESIGN.md](./GAME_DESIGN.md#the-labour-panel--implemented) for why the
quota and the staff are two numbers rather than one.

The same report's **character card** landed with it: tapping a building now lists
the people under it — portrait, name, age, which of the two, and their level at
that trade — and under a house the family that sleeps there. Four faces, picked by
age first and sex second, and a colour each that lasts a lifetime. See
[GAME_DESIGN.md](./GAME_DESIGN.md#the-card-under-a-building--implemented).

**And the world art**, which finishes that report. Four figures on the map rather
than one — child, woman, man, elder — each in the villager's own colour, told
apart by outline rather than by detail because a villager is 48 pixels beside a
96-pixel tree. Toddlers now stay within sight of the house, and school-age
children head for the school when one stands. See
[ART_BIBLE.md](./ART_BIBLE.md#four-villagers-and-a-colour-each--implemented) and
[GAME_DESIGN.md](./GAME_DESIGN.md#children-and-elders-seen--implemented).

---

## Phase 37 — The wood tends itself — Implemented

Four reports in one pass, three of them about taps.

**"I want the Woodcutter to fell the trees itself, and for them to grow back on
their own after five years. Only if the player orders a tree felled does it go
from the ground for ever — unless you put a forester nearby."** Implemented as
written; see
[GAME_DESIGN.md](./GAME_DESIGN.md#cropping-clearing-and-the-five-year-wood--implemented),
including the measurement that says it is a convenience rather than a fix for the
opening.

**"Tapping a cell or a building that is already selected should show nothing."**
It closes now, whichever cell of a building's footprint the second tap lands on.

**"If you are placing a building and tap a cell without dragging, it should
cancel the placement."** It does. A drag is still a drag.

**"I would take the frame off the buttons along the bottom."** Gone: it was a
panel wrapped around five buttons that already had their own.

---

## Phase 38 — Room left in the sheds — Implemented

"Can you put in information about the % full of the storage yards and food
stores? And warnings if any category goes over 90%." Both, in the drawer, the
ledger and the building panel, with the warning line shared between the banner and
the sheet. See
[GAME_DESIGN.md](./GAME_DESIGN.md#how-full-the-stores-are--implemented) — including
the bug it turned up, where a _full_ yard dropped out of the count of how full the
yards were.

The same pass re-measured the opening on the player's own line — eight stone on
day one, top up when short — and found a second, different way settlements die:
food rotting in the field for want of hands to carry it, in summer, long before
the winter the game is about. Recorded, not fixed.

---

## Phase 39 — The river — Implemented

"Instead of a sea let us have a river on the map. River cells can be turned into a
bridge for 5 logs, and a cell next to the river can be turned into a ditch. And I
want roads and ditches to take corners and make crossings."

Set out in [GAME_DESIGN.md](./GAME_DESIGN.md#the-river--implemented).

- **A river across every map**, in one of two directions, meandering out of its
  own noise stream. Inland ponds are rarer to make room for it.
- **The map is in two pieces until it is bridged**, and the game says so:
  placement on the far bank is refused with _nobody can walk there_. The
  navigation grid labels connected patches of ground for this, which also stops a
  job on the far bank costing a full pathfinding search to reject.
- **Bridges**: five logs, one cell of river, offered on the panel for the cell
  rather than in the build menu. A bridge is a road over water — that is the whole
  implementation.
- **Ditches**: a cell of open ground beside water can be dug into a channel, and
  each channel is itself water, so the player leads the river inland one cell at a
  time.
- **The orchard needs water** and is worth **twice as much beside a Food Storage**,
  which is the first rule in the game about _where_ a building goes.
- **Roads, bridges and ditches are drawn from what joins them**: sixteen shapes per
  kind. See [ART_BIBLE.md](./ART_BIBLE.md#roads-bridges-and-ditches--implemented).

Two real bugs came out of it, both found by the balance measurements rather than by
reading:

- **A building's doorway could be built over.** The cell a workshop drops its
  harvest on is a walkable neighbour chosen when it is finished, and the next
  building raised next door can be standing on it. Nothing noticed: the hut went
  on piling food onto a cell inside a wall, where no hauler could ever reach it,
  and a settlement starved with its gatherers working. Doorways are now re-found
  whenever the walls change, and a doorway the settlement cannot reach does not
  count as one.
- **A load set down on a building site was buried by it.** A site stays walkable
  while it is built, so a hauler can leave a pile on it; the day the walls went up
  that pile was inside them. The builders now shift anything stranded on or beside
  the plot out to the doorway.

What the river cost, honestly:

- **The reference seed stopped surviving its first winter.** Not because the river
  is harder, but because that seed's rock happened to sit one cell from the camp,
  which was the only reason its settlement ever got the 4 stone a Woodcutter needs.
  The river re-cut every map and took the luck away. The balance suite now
  measures the hut ladder across twenty-four seeds instead of one — the numbers
  are in `tests/balance.test.ts` — and the reference seed moved with it.
- **The stone bottleneck is now visible on every seed**, and `stone-supply.test.ts`
  records that its one exception has gone. What the measurements also showed, and
  what nobody had noticed before: in a settlement with three huts, a Woodcutter and
  a Forester, **every adult is employed**, and an employee's own workshop always
  has an `urgent` job — so the standing mining orders are never claimed by anybody
  at all. Two hundred and twenty-three of them were measured sitting on the board
  for forty days. Raising mining's priority does not touch it, and neither does
  ageing the board: both were measured and backed out. The lever that does work is
  the labour panel, which the player has to reach for by hand.
- **One seed in the sweep is a pathologically expensive map to find routes
  across**: 3.5 seconds of pathfinding for its simulated year, against 80ms for its
  neighbours, with no failures — simply long searches through heavy woodland.
  Reusing A\*'s working buffers was tried and measured as no help at all (the cost
  is the search, not the allocation) and backed out. Unaddressed, and the first
  thing to profile in Phase 11.

---

## Phase 40 — The harvest that arrives — Implemented

"Now that the orchard has other conditions — leading the water to it, or standing
beside it — its food should be simple to carry to the larders and not be lost.
Let the villager carry more per trip, or whatever, but let it not be lost if there
is a larder nearby. I prefer that to the orchard giving double food for being
close: what I mean is that the amount can be carried 100% to a larder more easily."

Exactly right, and the previous phase had it the wrong way round.

- **The orchard's double yield is gone.** In its place, a **Food Storage looks
  after what is lying within six cells of its door** as well as what is inside it.
  Losing nothing is a better reward than being given more, and it is a rule about
  the store rather than about the orchard: anything perishable within reach of a
  building made to keep it, keeps. Measured over ten days of a basket waiting for
  a hauler: 90% of it left, against under 70% out in the open.
- **A villager carries twenty units instead of ten.** Measured over twelve seeds of
  the reference opening: food banked by winter went from 461 to 857, with no change
  to who lived or died. It is the one lever on hauling that costs the
  settlement nothing, and hauling is what every economic problem in this game turns
  out to be.
- **Produce spills onto the next cell instead of evaporating.** A pile holds one
  stack, every caller dropped goods and ignored what the pile said it had taken,
  and an Orchard — 22 food a batch, two pickers, one doorstep — quietly lost
  everything past the first fifty. That was the largest single source of "where did
  my harvest go", and it was not the orchard's fault.
- **Earthworks are real work now**: a ditch is about two days of one person's time
  per cell (35 → 120 ticks of labour) and a bridge is a house's worth per cell of
  river (50 → 120). Crossing a river and leading water inland are the two things a
  settlement does to the shape of its own map; neither should cost an afternoon.

Four claims in the balance suite had to be re-measured, all of them because the
food side genuinely improved:

- **one hut now feeds exactly ten** — 10.00 food a day eaten against 10 needed —
  where it used to fall short. It still banks almost nothing, which is what the
  second hut is for: 643 food across the sweep against 1799.
- **a one-hut settlement no longer reaches winter on literally nothing**, so that
  assertion became a ceiling rather than a zero.
- **a third hut is not worth a second larder-day.** `prepared` banks 1685 with
  three huts and a day-20 larder; `twoHuts` banks 1799 with two and a day-14 one.
- **the disciplined line is now measurably worse**, 230 deaths against 200, and the
  reason is the employment trap recorded in Phase 39: every extra workshop post
  takes a pair of hands out of the labour pool, and an employed villager's own
  workshop always has an urgent job — so the mining orders that would buy a
  Woodcutter are never claimed. Playing "better" employs the people who were going
  to fetch the stone.

---

## Phase 41 — Each thing in its own building — Implemented

"Any road or free gap touching a building should serve as an entrance or somewhere
to pile things; if it cannot go where it should, let it go somewhere else. And take
out the nearness-to-larders thing. Things have to go to the larder, or stay where
they were made — but things being looked after because a store is within some
radius, I do not like. Each thing in its own building."

Both halves right, and the second one is a correction of Phase 40.

- **The larder's reach is gone.** A store looks after what is inside it and
  nothing else. Two attempts at making an orchard's crop survive by being _near_
  something — doubling the yield, then preserving what lay outside the door — were
  both favours granted by proximity: invisible on the map, impossible to point at,
  and needing to be explained before a player could use them. What is left is the
  plain thing, and it is still a real reason to site a larder next to an orchard:
  a shorter walk means more of the crop arrives. Measured over ten autumn days,
  a larder four cells from the trees gets far more of the harvest into store than
  one eighteen cells away.
- **Any free ground touching a building is a doorway**, and a road touching it is
  better — a road is where the traffic already goes, so goods arrive at road speed.
  If the whole edge has been built over, the search widens by a ring at a time
  rather than giving up and pointing at a wall, and the only hard requirement is
  that the settlement can walk there: a doorway onto a sealed pocket is worse than
  none, because everything set down on it is lost in plain sight.
- **A spilled load lands where a hauler can reach it**, for the same reason.

What survives from Phase 40, because it earned its place by measurement rather than
by being a favour: **a villager carries twenty units** (food banked over 12 seeds:
461 → 857), **produce spills onto the next cell instead of evaporating** when the
doorstep pile is full, and the two earthworks — ditch and bridge — take real work.

---

## Phase 42 — Castilian names — Implemented

"Can you make the inhabitants' names Castilian, both given names and Spanish
surnames? Of another Castile if possible, but above all Spanish. I think it places
it better, since the game is called Montija, which is an area in Las Merindades,
north of Burgos, Castilian territory."

Named out of its own valley, then. See
[GAME_DESIGN.md](./GAME_DESIGN.md#where-they-came-from--implemented).

- **Given names Castile actually used** in these centuries — Sancho, Jimena, Nuño,
  Urraca, Fernán, Mencía — rather than modern Spanish ones, which would read as a
  village of tourists.
- **Family names half patronymic** (Fernández, Gutiérrez, Sáinz, Díez, Ruiz) and
  **half toponymic from the Merindades** (de Espinosa, de Sotoscueva, de
  Valdivielso, de Losa, de Mena, de Frías, de Bercedo) — which is how people were
  told apart before surnames settled: by their father, or by where they came down
  from.
- The lists are the same lengths as the ones they replaced, so the founding party
  is no more lopsided than it was and the seeded stream draws exactly what it drew.
- **A surname may now contain a space**, which the inheritance convention already
  handled ("given name, then everything else") and which is now pinned by a test:
  every villager after four years of a growing settlement has a given name from the
  right pool and a family name that appears in the table verbatim. Without it a
  house of Valdivielso could quietly become a house of "de".

---

## Phase 43 — Built off the ground — Implemented

"For the beginning we could make the materials appear on the ground so they can pick
them up and use them to build — that nothing has to come out of a store, so whoever
wants to do a piece of work is able to take it off the ground. And also let us start
with ten stone. The opening is sometimes a bit easier that way."

- **A site is supplied from whatever is nearest, shelf or ground.** It used to be
  yards only, which meant a felled tree twenty paces away had to be carried _past_
  the site into a store and then carried back out — two journeys where one would do.
  Piles and yards are now judged on distance alone, because to the villager carrying
  it they are the same errand, and a pile across the river is not a source at all.
- **The settlers set their bundles down where they stop.** Food into the camp store,
  because people eat out of one; timber, stone and iron on the ground beside it, in
  bundles, ready to build from. It is also what ten tired people would actually do.
- **Ten stone in the bundle** — one each. And it did what nothing else had managed:
  measured over twelve seeds of the reference opening, **firewood exists at the first
  freezing day for the first time**, 91 units against zero on every seed before. The
  deaths barely move, because seven days of firewood is not a winter, but the chain
  that was broken at its first link now starts.
- A latent id collision went with it: a site's "next load of stone" reservation was
  `siteId * 100 + resource`, which collides with a pile's own id once a settlement
  has felled a hundred trees — at which point one of the two silently stops being
  posted. Material reservations now live at 250,000 and up.

Nine tests changed their premises, all of them about the starting state rather than
about the rules — a settlement's first morning now has half a dozen hauls on the
board and its logs on the ground rather than on a shelf. Two of the rewrites are
findings rather than bookkeeping:

- **the Food Storage is no longer worth its cost.** With the bundle, the doubled
  load and a 2000-capacity founding yard that takes food, a larder saves about one
  per cent of a year's spoilage: the loss is in the field, not in the stores. The
  test now records that and is written to fail when it is fixed; see
  [GAME_DESIGN.md](./GAME_DESIGN.md#fields-and-orchards--implemented).
- **a job's `targetEntityId` is a shared namespace**, and the demolition test that
  swept it by id alone was matching a pile of the settlers' own timber that happened
  to be pile number 1 while the site was building number 1.

---

## Phase 44 — The store nobody could reach — Implemented

"Have the game begin paused and the villagers near the starting resources, with none
of them across the river. What did the forester's lodge do? The woodcutter does not
seem to make me any firewood, or they do not move it to the store. In the 'How to
play' texts please put how much each building produces in a year, in normal
conditions. Put a reset button in the options. As it is now, the movement for placing
buildings will not let you place in the corners. Let us put the initial store back."

And, from the next game: "In year 5 I end up dying of cold for lack of food and
because people stop hauling the food and the firewood and they do not cut logs. Who
is supposed to do those jobs?"

The answers to those two reports turned out to be the same answer, and it was not a
balance problem at all. **A store is fetched from at exactly one cell, and nothing
stopped the player building a house on top of the camp's.** Goods still went in — a
hauler delivers from the next cell over — so the HUD showed a yard filling steadily
to a hundred and seventy logs while every site and every workshop starved beside it.

Three defects, all in `docs/GAME_DESIGN.md` under "The founding yard's doorway":

- **a walled-in store now moves its doorway** to reachable ground, once a tick, the
  same reconciliation a building's doorway already gets — and never onto another
  building's doorstep, because a building answers for its own doorway before any yard
  does, and the first version of the rescue had baskets of food vanishing into a
  house's store-cupboard;
- **a delivery prefers a source that can fill the trip.** Nearest-first meant a pile
  holding one log beat a shelf holding a hundred and seventy, and a site costing
  eight logs took a trip per log;
- **a haul is worth what the settlement lacks**, not what it happens to be carrying.
  Above `wantedPerVillager` in `data/resources.ts`, carrying more of a good drops to
  the bottom of the board. A third of the settlement's waking hours had been going on
  timber it already had while people starved a hundred paces away.

Measured over twelve settlements playing the strong opening for a year: **120 deaths
became 63**, firewood on the shelves went from 0 to 57, food banked at the first frost
from 701 to 1219, five of the twelve now come through winter without a grave, and idle
time fell from 22% to 14%. Two balance tests that recorded defects had to be rewritten
because the defects were gone — the woodshed is no longer empty, and playing well now
buys about two settlements' worth of lives where it used to buy none.

**Reachability is measured from the settlement, not from one cell.** Both the
placement check and the doorway search used a single anchor at the camp, and five
buildings ringing it sealed that cell — after which the entire map answered
"unreachable". Measured on a probe settlement: 991 refusals and one legal plot.
`World.anchors` is now the villagers and the stores, cached against a connectivity
version on the navigation grid.

The rest of the list, all smaller:

- **the game opens paused**, and a fresh settlement does too;
- **the settlers arrive within four cells of their stores, and on their own bank** —
  the spawn search never checked, so two or three of them could start across the water
  and stand there until somebody built a bridge nobody knew was needed;
- **the camera clamp holds the centre rather than the viewport**, so a corner tile can
  sit under the placement ghost. There is empty ground past the edge of the world now,
  which is honest — there is nothing there;
- **a Begin again button** in the settings sheet, which asks once in place;
- **everything the settlers carried starts on the shelves again.** Bundles on the
  ground read as a mess rather than as a camp, and made the opening move "tidy up";
- **the guide states what each building makes in a year** — full staff, no tools, no
  experience, nobody ill — and a Forester's Lodge says what it tends instead, because
  it has no recipe and no yearly figure can honestly be quoted for it.

### What is still broken

**Felling and mining cannot both progress**, and no ordering of the two fixes it.
Three attempts are recorded in GAME_DESIGN.md and each one simply reversed which of
them starved. The answer is a scheduler that shares hands between kinds of work; the
standing-order experiment is the strongest hint about its shape. Until then a
well-played settlement survives its first winter on about half of all worlds.

---

## Phase 45 — Buildings that sit on their plots — Implemented

"First the load variants of the yard, and I think it would be important that no building went outside
its cells. One, make sure again that no trees or stone or anything can grow under a building, and two,
that it does not exceed. In the yard, that worn earth exceeds the cell. Let us also improve the house
model — a smaller building inside the cell, with room around it for a fence, ground, and any element
that gives it a bit more detail. Maybe a small porch, rustic and simple, since these are not
well-worked houses."

Four things, in the order they were asked for.

**Nothing a building draws leaves its footprint.** The yard's path of worn earth reached past its
plot — right, and worth fixing for the reason the report gave: the footprint blocks navigation,
validates placement and gets saved, so art that oversails it promises ground the player cannot use.
The answer is not a smaller path but a smaller _building_: `BuildingMass.inset` shrinks the built part
and the rest of the plot becomes the building's own ground. Both the yard and the house read as larger
for it, because they have somewhere to sit.

`tests/building-art.test.ts` now holds the line for every building at once, by **recording the drawing
rather than rendering it** — a stand-in `Graphics` that writes down every coordinate it is handed
measures the art exactly, headless, with no canvas. It caught a second offender on its first run:
**every contact shadow in the game**, which spread to about 1.5x the plot it was given, and which on a
one-cell building was being sliced square by the edge of its own texture.

**Nothing grows under a building**, and there was a hole. The wild spread keeps two cells from every
finished building, but the founding camp is a _store_ with no building behind it, so the rule never
applied to it: measured over four simulated years, one plot in four grew a tree on the camp itself.
The camp's ground is now remembered as cleared on purpose, which is what it is.
`tests/ground-under-buildings.test.ts` pins all of it.

**A yard is drawn as full as it is.** Five textures from bare boards to piled high, chosen from what
the store holds. Entirely a renderer change: it reads `inventory.total` and picks a texture, and the
simulation neither knows nor cares. The level comes from an absolute figure rather than the store's
capacity — the founding yard holds two thousand, and tying the picture to that would draw the whole
first year as an empty platform.

**A cottage, not a box.** The House is drawn at 0.56 of its plot, with beaten earth around it, grass
surviving in the corners, a path from the gate to the door, a fence with a gap where the gate is, and
a lean-to over the door on two posts. The detail is the detail people put on a house raised in a hurry
out of eight logs and four stone — see the art bible on what a poor building should look like.

---

## Phase 46 — The house, from a vector recipe — Implemented

"Te paso fórmulas generadas por Claude para que las puedas usar. Usa la segunda con el techo
amarillo por favor como imagen de las viviendas. Mira el humo si puedes ponerlo en la chimenea."

Three house constructions were drawn and compared on the preview board first, and the reports on the
first one were all correct and all worth chasing:

- **the chimney was flying.** Two causes. Its offset still measured from the plot rather than from
  the inset building, and it was placed by interpolating from the apex straight down the left hip —
  the silhouette edge, where half a stack overlaps the near pitch and half sticks out into the sky
  over the far one. It stands _in_ the pitch now, which fixes every chimney in the game.
- **the walls looked see-through and the door looked stuck on.** One sign error: **near the camera is
  low on screen**, and the wall parametrisation had it the other way round, so every post, plank and
  door was hanging off the face it belonged to. Invisible as a symptom, obvious as a diagram.
- **too many accessories.** The fence went — it also has to be split by _depth_ rather than by edge,
  or its near rails cross the front of the building — and so did the lean-to. The effort went into
  how the walls are built instead.

The chosen house is the **boarded cottage with an offset porch gable**, from the recipe, in
`houseArt.ts`. Its proportions were adjusted once after looking at it: the recipe's wall of 0.48
against a roof of 0.68 let the roof swallow the house, and the boarding, the door and the window all
happen on the wall.

Two things in it are worth keeping in mind for every other building:

- **a hipped roof with a real ridge, not a pyramid.** Four planes meeting at a point has no
  direction, so a house, a workshop and a store all read as the same lozenge.
- **one architectural feature, off centre**, and a projecting gable rather than a flat hood, because
  its whole job is the silhouette.

**And the smoke.** It was already there and already leaving the chimney's own mouth — the report was
about how it looked. At two and a half puffs a second, each growing fast, a plume came out as three
or four grey balls stacked over the roof. It is twice as many at half the size now, and the ceiling
went with it: the cap has to stay above _houses × the size a winter plume settles at_, or it starts
cutting plumes short in ordinary play, which looks like fires going out.

The test for that was measuring the wrong thing — a bare threshold that needed re-tuning the moment
the rate changed. It now measures the plume twice, a thousand frames apart, and asks it to have
stopped growing, which is the claim that was always meant.

## PHASE 47 — Every building built, not tinted — Implemented

The house was the only building in the settlement that had been drawn properly. Everything else was
a box under a pyramid in a different brown, which at gameplay zoom is one silhouette repeated fifteen
times: a player could not tell a Woodcutter from a Tailor without tapping it.

The house's construction is now `structureArt.ts`, and every roofed building goes through it. Four
things are varied and each is legible from across the map: which way the ridge runs (`cross`,
`gable`, `gable-left`), what the walls are built of (boarded, half-timbered, log, stone), what the
roof is covered with (shingle, thatch, slate), and what the trade leaves lying on its own ground.

Every building is now **inset inside its own cells**, the way the house and the yard already were,
with its own ground drawn on the ring that leaves — bare earth with a trodden path to the door, or
kept green. That ring is where the work bay reaches out to and where the tools stand, and the whole
of it is inside the footprint: `tests/building-art.test.ts` fails the build if any building, in any
variant, draws so much as a shadow outside its own plot.

Thirteen features, one a trade, in `buildingFeatures.ts`: split logs and a chopping block with the
axe still in it, a forge mouth with fire in it — the one warm colour in the settlement — a hide
stretched in its frame, cloth on a line over a dye vat, a nursery row of saplings, a timbered mine
mouth with ore out of it, dressed blocks and a pick, sacks on staddle stones, drying racks, baskets
heaped over their rims, a physic garden, a cart with its shafts down, a bell in its frame.

Three things were got wrong first and are worth remembering:

- **A single gable carries its whole rise on one plane.** Pitches that suit a cross gable swallow the
  building. Gables want roughly the wall's own height.
- **A work bay covers one bay.** Run it the length of the wall and it buries the door, the steps and
  both windows, and the building behind it stops existing. And it hangs off an eaves wall, never off
  a gable end, where it buries the barge boards instead.
- **The temple and the school were the same building in two greys** — same footprint, same cross
  gable, same pale walls. The temple is a long steep hall now, stone the whole way up under the
  heaviest roof in the settlement.

## PHASE 48 — The settlement stops walling itself in, and somebody fells the trees — Implemented

A player sent a screenshot: materials all over the ground, villagers shuffling between two cells, and
a banner saying the works had stopped for want of timber. Reproduced headlessly on an ordinary opening
and it was worse than it looked — by day twenty-four every villager in the settlement _and_ its only
store were sealed into a four-cell pocket by the settlement's own buildings. The haul board grew from
twelve jobs to a hundred and ninety-one, six hundred and seventy-six logs lay in the wood, and they
starved with three hundred food in sight of the larder.

Four defects, each independently fatal, all measured and all fixed. Placement now refuses a plot that
would cut the ground into pieces; a villager stranded any other way steps out of the pocket; no job is
offered to somebody who cannot walk to it, checked on **both** legs of a haul; and a construction site
takes only what it still owes, so one material can no longer fill the room another needs — a Feller's
Hut was measured holding eight logs and full, with its two stone on the doorstep being re-fetched for
ever.

The wood is three buildings now rather than one: a **Feller's Hut** cuts, a **Woodcutter** splits, a
**Forester's Lodge** plants. Felling used to be the Woodcutter's second trade, which is one building
doing two unrelated jobs where the player can see neither — and a splitter with a full woodpile has no
reason to cut, which is exactly the wrong rule for the settlement's only source of timber. The
Feller's orders are its own workers' work at its own workshop's priority; posted as open work they lost
to the day's hauling for ever and no timber ever came in.

Measured on the reference opening, before and after: firewood at the first frost 0 → 30, food banked
133, population 10 → 11, every building finished instead of two standing half-built all year. Nobody
stranded on any seed.

Two findings recorded rather than fixed, because they are design decisions rather than bugs:

- **The third gatherer hut now costs more than it earns** — 276 food banked on one hut, 623 on two,
  361 on three, over twelve seeds. Three huts, a Feller and a Woodcutter is nine of ten villagers
  holding a post, and the tenth cannot carry a settlement's harvest in alone. That the employment
  system fills every slot it can find is the thing to change.
- **Whether a settlement reaches winter with any firewood depends on what it built in autumn.** Over
  twelve seeds the disciplined line came out at [0, 0, 10, 0, 0, 100, 0, 40, 0, 40, 0, 0] — the timber
  went into the Quarry instead of the woodpile. A real decision, and the test now judges it across the
  sweep rather than on one seed.
