# Performance

Status labels: **Implemented**, **Prototype**, **Planned**.

**Phase 11 — Implemented.** Repeatable benchmark scenarios exist at 25 / 50 / 100 villagers, the
simulation is measured precisely, and the frame rate has now been measured on real hardware. What
that does and does not license is set out below.

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

## Measuring on a real device

Add `?stats` to the URL:

```text
https://munitisdev.github.io/montija/?stats
```

A small readout appears under the resource strip with the current frame rate, the **average** and the
**worst** frame since loading, the simulation's cost per frame, the population, and the viewport size
and zoom. The worst frame is there because an average hides exactly the stutter a player notices.

It is off unless asked for, so an ordinary player never sees it, and it is deliberately **not** in
`src/debug` — that whole folder is stripped from a release, which is right for a tool that can
conjure grain and skip winters, and wrong for the one number that can only be measured on the machine
somebody actually plays on.

The first two seconds are ignored while textures are built and the JIT warms up. That warm-up is
counted in time rather than frames, because a frame count finishes instantly at 60 FPS and never
finishes at all on a device slow enough to be worth measuring.

Useful things to record: the figures sitting still, the figures while panning, and the figures zoomed
right out — the last is where the object count bites hardest.

`?villagers=100` founds a larger settlement, so the frame rate can be measured under load. The
benchmarks below can say exactly what a hundred villagers cost the _simulation_ and nothing at all
about what they cost a phone to _draw_, and the debug controls that could spawn them are stripped
from a release. The value is clamped to 300: a URL is user input, and `?villagers=1e9` should be a
big settlement rather than a hung tab.

---

## On real hardware — measured

An Android phone with an adaptive-refresh display, at the default ten villagers:

| Condition                | Frame rate |
| ------------------------ | ---------- |
| Sitting still            | 60         |
| Panning the camera       | up to 120  |
| Zoomed fully out, moving | up to 120  |

**The game is bound by the display, not by the GPU.** The rise from 60 to 120 while moving is the
phone, not the game: adaptive displays idle at 60Hz on static content and step up to 120Hz under
continuous input, and the game keeps pace with both. The figure that matters is the last row — fully
zoomed out is where the most tiles are on screen at once, and it holds the panel's full refresh rate.

So the frame budget at its tightest is 8.3ms, against a per-frame game step measured at under 1ms
with a hundred villagers. There is a great deal of headroom, and **terrain culling is not needed** —
it was the first thing this document nominated to try, and the measurement says do not bother.

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
container and nothing else. For the real figures, see
[On real hardware](#on-real-hardware--measured) above.

---

## What this does not claim

**Still no maximum villager count.** What has been measured is a phone holding its display's refresh
rate with a ten-villager settlement on a fully zoomed-out map. That says the current scene is
comfortably within budget; it does not locate the ceiling, because nothing yet has pushed the
renderer hard enough to find one.

Nor does it speak for weaker hardware. One phone is one phone.

What can be said, and is now measured at both ends: the simulation uses under 1% of its tick budget
at 100 villagers, the per-frame game step is under a millisecond, and a real device draws the scene
fast enough to be limited by its own screen. If some future device does struggle, the cause will be
drawing the scene rather than simulating it.

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

- Frame rate on a **tablet**, and on something slower than a current phone. One device is one device.
- Frame rate at 100+ villagers on real hardware, via `?villagers=100`, to start locating a ceiling.
- Viewport culling for terrain — **not** planned any more. It was the obvious first optimisation and
  the measurement says it is unnecessary; it is written down here so nobody re-nominates it without
  new evidence.
- A benchmark for load and save at scale, which is currently unmeasured.
