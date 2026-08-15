# Performance

Status labels: **Implemented**, **Prototype**, **Planned**.

**Phase 11 — Implemented, with one honest gap.** Repeatable benchmark scenarios exist at 25 / 50 /
100 villagers, the simulation side is measured, and the rendering side is measured only on a software
renderer, which is not a machine anyone plays on. What that does and does not license is set out
below.

Run the simulation benchmarks with:

```bash
npm run bench
```

---

## The rule this phase follows

> Profile before optimizing.

Taken literally. One optimisation was written during this phase and then **reverted**, because the
measurement did not support it. See [What was tried and rejected](#what-was-tried-and-rejected).

---

## Simulation — measured

`bench/simulation.bench.ts`, 12 simulated days (720 ticks) per population, on a 96×96 world with
every villager kept busy — trees designated, jobs flowing, goods being hauled. An idle village
benchmarks nothing.

| Villagers | Cost per tick | Share of 1x budget | Share of 4x budget |
| --------- | ------------- | ------------------ | ------------------ |
| 10        | 0.03ms        | 0.0%               | 0.1%               |
| 25        | 0.09ms        | 0.1%               | 0.4%               |
| 50        | 0.16ms        | 0.2%               | 0.7%               |
| 100       | 0.22ms        | 0.2%               | 0.9%               |

The clock runs 10 ticks a second at 1x, so a tick has 100ms before the simulation is what limits the
game — and 25ms at 4x, which is the case that matters. At 100 villagers the simulation uses under
**1%** of it.

Growth is comfortably sub-linear: ten times the villagers costs about seven times the tick, because a
fair share of each tick is fixed work that does not care how many people there are.

### Where the time is not going

Worth stating, because all three were plausible suspects before measurement:

- **Day boundaries are not a spike.** Survival, spoilage and the daily accounting average 0.63ms
  against 0.30ms for an ordinary tick — twice the cost of a normal tick, once every sixty.
- **Pathfinding for actual work never fails.** Sampling 400 searches from villagers to live jobs at
  100 villagers gave 400 successes, no failures and no exhausted node budgets.
- **The worst ticks are early ticks.** The largest samples cluster in the first hundred ticks of a
  run and do not recur later with more jobs on the board, which is the shape of JIT warm-up rather
  than of an algorithm getting slower.

---

## Rendering — measured only on a software renderer

Measured in a headless browser whose WebGL is SwiftShader: a CPU rasteriser with no GPU behind it.

| Villagers | Display objects | Game step per frame | Frame rate here |
| --------- | --------------- | ------------------- | --------------- |
| 10        | 11,202          | 0.11ms              | 4.5             |
| 25        | 11,217          | 0.12ms              | 4.2             |
| 50        | 11,242          | 0.28ms              | 4.1             |
| 100       | 11,292          | 0.72ms              | 4.0             |

Two things are real here and transfer to any machine:

- **Population barely touches the display list.** Terrain is about 11,200 objects; ten villagers or a
  hundred move that by well under 1%.
- **The JavaScript per frame is nearly free.** The entire game step — simulation, camera, placement
  ghost — costs 0.72ms at 100 villagers. A 60 FPS frame has 16.7ms.

**The frame-rate column is not a claim about real hardware.** It barely moves between 10 and 100
villagers precisely because it is bound by rasterising the scene in software, so it measures this
container and nothing else. The one real-hardware data point so far is qualitative: the project owner
reported the game running smoothly on their own machine, which is a report and not a number.

---

## What this does not claim

No maximum villager count. The brief asks not to promise one until benchmarks exist, and while the
simulation benchmarks now exist, the number that would decide a ceiling — frame rate on a real GPU,
and particularly on a tablet — does not.

What can be said: at 100 villagers the simulation uses under 1% of its tick budget and the per-frame
JavaScript is under a millisecond, so if a real device struggles, the cause will be drawing the scene,
not simulating it.

---

## What was tried and rejected

**Bounding the node budget for wandering.** Idle villagers pick a random spot within twelve cells and
path to it, and some of those spots are walkable but unreachable — inside a stand of trees — so the
search exhausts its full 4000-node budget for a stroll. At 100 villagers, 56 of 924 searches failed
this way, and capping wander searches at 300 nodes looked like an easy win.

It was not. Re-benchmarked, the worst tick was unchanged within noise and the mean did not improve.
The failures are real but too thin to matter, and the change would have altered how villagers behave
around forests in exchange for nothing measurable. It was reverted.

This is the phase's rule working as intended, and the reason it is written down: the next person to
notice those failed searches should know they have already been measured.

---

## Where to look first, if a real device struggles

In order, based on what the measurements above rule out:

1. **Terrain draw calls.** ~11,200 display objects, and by far the largest thing on screen. Culling
   to the viewport is the obvious first move and has not been done.
2. **Texture atlasing.** Already done for the tiles that interleave under depth sorting, which was a
   real fix earlier in the project; worth re-checking whenever a new sprite type is added.
3. **The simulation.** Last, and only if the first two come back clean.

---

## Planned

- Frame-rate measurement on real hardware, and on a tablet in particular.
- Viewport culling for terrain, if and when a real device asks for it.
- A benchmark for load and save at scale, which is currently unmeasured.
