/**
 * Repeatable simulation benchmarks, at 25 / 50 / 100 villagers.
 *
 * Run with `npm run bench`. Deliberately separate from the test suite: these
 * print measurements and assert almost nothing, because a number that varies
 * with the machine it ran on has no business failing a build.
 *
 * **What this measures, and what it does not.** This is the simulation only —
 * no Phaser, no canvas, no GPU. That is the honest half of the picture and the
 * half that transfers between machines: it is the same arithmetic wherever it
 * runs. Frame rate is *not* measured here and cannot be inferred from it. See
 * `docs/PERFORMANCE.md` for the rendering side and why its numbers need a real
 * device to mean anything.
 *
 * The figure to watch is the share of the tick budget. The clock runs 10 ticks
 * a second at 1x, so a tick has 100ms before the simulation is what limits the
 * game — and 25ms at 4x, which is the case that actually matters.
 */

import { describe, it } from 'vitest';

import { STARTING_VILLAGERS, WORLD_HEIGHT, WORLD_WIDTH } from '@/app/config';
import { Simulation } from '@/simulation/Simulation';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import {
  buildNearby,
  countOf,
  designateNearbyStone,
  designateNearbyTrees,
  ordered,
} from '../tests/support/playtest';

/** Tick budget in milliseconds at each simulation speed. */
const TICK_BUDGET_MS = { '1x': 100, '4x': 25 } as const;

const POPULATIONS = [STARTING_VILLAGERS, 25, 50, 100];

/** Simulated days per scenario. Long enough to cover a season's work. */
const DAYS = 12;

interface Measurement {
  readonly villagers: number;
  readonly ticks: number;
  readonly totalMs: number;
  readonly msPerTick: number;
  readonly worstTickMs: number;
  readonly pathRequests: number;
  readonly pathFailures: number;
  readonly jobsCompleted: number;
  readonly piles: number;
  readonly trees: number;
}

/**
 * A settlement doing real work, not an idle one.
 *
 * An idle village benchmarks nothing: nobody paths, no jobs are claimed and no
 * goods move. This keeps every villager busy, which is the load worth knowing
 * about.
 */
function busySettlement(villagers: number): Simulation {
  const simulation = new Simulation({
    seed: 20260815,
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    startingVillagers: villagers,
  });
  designateNearbyTrees(simulation, villagers * 8);
  designateNearbyStone(simulation, 20);
  return simulation;
}

function measure(villagers: number): Measurement {
  const simulation = busySettlement(villagers);
  const ticks = DAYS * TICKS_PER_DAY;

  let worstTickMs = 0;
  const startedAt = performance.now();

  for (let tick = 1; tick <= ticks; tick++) {
    const tickStartedAt = performance.now();
    simulation.update(tick, 0.1);
    worstTickMs = Math.max(worstTickMs, performance.now() - tickStartedAt);

    // Keep the settlement working rather than running out of designated jobs
    // partway through and benchmarking an idle village by accident.
    if (tick % (TICKS_PER_DAY * 2) === 0) {
      designateNearbyTrees(simulation, villagers * 4);
      if (!ordered(simulation, 'gatherer-hut') || countOf(simulation, 'gatherer-hut') < 2) {
        buildNearby(simulation, 'gatherer-hut');
      }
    }
  }

  const totalMs = performance.now() - startedAt;
  const snapshot = simulation.snapshot();

  return {
    villagers,
    ticks,
    totalMs,
    msPerTick: totalMs / ticks,
    worstTickMs,
    pathRequests: snapshot.pathRequests,
    pathFailures: snapshot.pathFailures,
    jobsCompleted: snapshot.jobsCompleted,
    piles: snapshot.pileCount,
    trees: snapshot.treeCount,
  };
}

describe('simulation performance', () => {
  it('reports the cost of a tick at each population', () => {
    // One warm-up, discarded: the first run pays for JIT compilation that every
    // later run gets free, and reporting that as the cost of 10 villagers would
    // be a lie about the smallest settlement.
    measure(STARTING_VILLAGERS);

    const results = POPULATIONS.map(measure);

    const rows = results.map((r) => {
      const share = (budget: number) => `${((r.msPerTick / budget) * 100).toFixed(1)}%`;
      return [
        String(r.villagers).padStart(3),
        `${r.msPerTick.toFixed(3)}ms/tick`.padStart(14),
        `worst ${r.worstTickMs.toFixed(1)}ms`.padStart(14),
        `1x ${share(TICK_BUDGET_MS['1x'])}`.padStart(10),
        `4x ${share(TICK_BUDGET_MS['4x'])}`.padStart(10),
        `paths ${r.pathRequests}`.padStart(12),
        `failed ${r.pathFailures}`.padStart(12),
        `jobs ${r.jobsCompleted}`.padStart(12),
      ].join(' │ ');
    });

    console.log(
      [
        '',
        `  ${DAYS} simulated days each, ${results[0]!.ticks} ticks, ${WORLD_WIDTH}×${WORLD_HEIGHT} world`,
        '  simulation only — no renderer, no GPU',
        '',
        ...rows.map((row) => `  ${row}`),
        '',
      ].join('\n'),
    );

    // How the cost grows, which matters more than any single figure: the
    // architecture is aimed at 100–300 villagers, and that is only reachable if
    // this stays roughly linear.
    const smallest = results[0]!;
    const largest = results.at(-1)!;
    const populationRatio = largest.villagers / smallest.villagers;
    const costRatio = largest.msPerTick / smallest.msPerTick;
    console.log(
      `  ${populationRatio}× the villagers costs ${costRatio.toFixed(1)}× the tick ` +
        `(linear would be ${populationRatio}×)\n`,
    );
  }, 300_000);
});
