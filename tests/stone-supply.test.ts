/**
 * The one link the whole opening hangs on: does stone reach the settlement?
 *
 * Every attempt to make the first year kinder has pushed on the food side and
 * none of them moved survival — more rations, better-kept rations, more
 * gatherers. This file is why. Traced back, the chain is:
 *
 * ```text
 * no stone reaches the yard
 *   └─▶ the Woodcutter is never finished (8 logs and 4 stone)
 *         └─▶ the settlement makes no firewood at all
 *               └─▶ nobody is warmed, and winter kills everyone
 * ```
 *
 * Measured over 24 seeds, a well-played settlement enters winter with **zero
 * firewood on every seed but one** — and the one exception is the seed whose
 * nearest stone deposit is a single cell from the camp.
 *
 * **Mining is not broken.** Left alone it works well: about 46 stone home in ten
 * days, from deposits eight to fourteen cells out. What breaks it is competition,
 * and the tests below pin exactly how much.
 *
 * These are *characterisation* tests. They describe a defect rather than a
 * feature, and they are written to fail loudly if it is ever fixed — see the
 * final block. Nothing here is a claim about how the game should behave.
 */

import { describe, expect, it } from 'vitest';

import { WORLD_HEIGHT, WORLD_WIDTH } from '@/app/config';
import { Simulation } from '@/simulation/Simulation';
import { JobPriority } from '@/simulation/jobs/Job';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { designateNearbyStone, designateNearbyTrees } from './support/playtest';

const SEEDS = Array.from({ length: 8 }, (_, index) => 20260815 + index * 7919);
const DEPOSITS = 12;
const DAYS = 10;

describe('mining, left to itself', () => {
  it('brings a useful amount of stone home', () => {
    // Twelve deposits and nothing else asked of anybody. This is the control:
    // whatever goes wrong later is not the mining, the hauling, or the distance.
    const home = SEEDS.map((seed) => stoneDelivered(seed, { trees: 0 }));
    const worked = home.filter((amount) => amount > 0);

    expect(worked.length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...home)).toBeGreaterThan(40);
  });

  it('is enough for the buildings the first winter needs', () => {
    // A Woodcutter is 4 stone, a Food Storage 2, a House 4. Uncontested mining
    // pays for all of them inside a fortnight, several times over.
    const best = Math.max(...SEEDS.map((seed) => stoneDelivered(seed, { trees: 0 })));
    expect(best).toBeGreaterThan(4 + 2 + 4 * 3);
  });
});

describe('mining, once the player marks trees', () => {
  it('collapses, on the same seeds and the same deposits', () => {
    // The only difference between the two runs is forty felling orders. Same
    // world, same twelve deposits, same ten days.
    const alone = SEEDS.map((seed) => stoneDelivered(seed, { trees: 0 }));
    const contested = SEEDS.map((seed) => stoneDelivered(seed, { trees: 40 }));

    const totalAlone = alone.reduce((sum, amount) => sum + amount, 0);
    const totalContested = contested.reduce((sum, amount) => sum + amount, 0);

    // Measured at roughly a quarter. Asserted as "less than half" so retuning
    // travel or work speeds does not fail the test for the wrong reason.
    expect(totalContested).toBeLessThan(totalAlone * 0.5);
  });

  it('stops entirely on most seeds', () => {
    const contested = SEEDS.map((seed) => stoneDelivered(seed, { trees: 40 }));
    const starved = contested.filter((amount) => amount === 0);

    // Five of eight brought home nothing at all.
    expect(starved.length).toBeGreaterThanOrEqual(4);
  });

  it('escapes only where the rock is closer than the trees', () => {
    // The exception used to prove the mechanism: one seed kept mining, and it was
    // the one whose nearest deposit sat a single cell from the camp, where no
    // tree could be nearer.
    //
    // **On the current maps there is no exception left.** The sea became a river,
    // which re-cut every map from every seed, and none of these eight now happens
    // to be founded on top of its rock. That does not change the mechanism — it
    // removes the luck that was hiding it, which is why the reference seed's
    // settlement stopped surviving its first winter the day the river arrived.
    //
    // Written so it holds either way: if a map does keep its mining, the rock is
    // on the doorstep.
    const unaffected = SEEDS.filter((seed) => {
      const contested = stoneDelivered(seed, { trees: 40 });
      return contested > 0 && contested >= stoneDelivered(seed, { trees: 0 });
    });

    for (const seed of unaffected) {
      expect(nearestStoneDistance(seed)).toBeLessThan(4);
    }
  });
});

describe('why it happens', () => {
  it('is a tie on priority, broken by distance', () => {
    // Not a bug in either job. Felling and mining are the same priority, so the
    // choice between them is decided by which is nearer — and there is always
    // another tree nearer than the quarry.
    const simulation = new Simulation(options(SEEDS[0]!));
    designateNearbyStone(simulation, 4);
    designateNearbyTrees(simulation, 4);

    const felling = simulation.jobs.all.filter((job) => job.type === 'chop-tree');
    const mining = simulation.jobs.all.filter((job) => job.type === 'gather-stone');

    expect(felling.length).toBeGreaterThan(0);
    expect(mining.length).toBeGreaterThan(0);
    for (const job of [...felling, ...mining]) {
      expect(job.priority).toBe(JobPriority.normal);
    }
  });

  it('leaves the mining orders standing, unclaimed', () => {
    // The orders are not lost or cancelled — they sit on the board being passed
    // over, which is why the settlement looks busy while nothing arrives.
    const simulation = new Simulation(options(SEEDS[1]!));
    designateNearbyStone(simulation, DEPOSITS);
    designateNearbyTrees(simulation, 40);
    advance(simulation, TICKS_PER_DAY * DAYS);

    const unclaimed = simulation.jobs.all.filter(
      (job) => job.type === 'gather-stone' && job.state === 'available',
    );
    expect(unclaimed.length).toBeGreaterThan(0);
  });
});

describe('the fix, when somebody writes it', () => {
  it('will make this test fail, which is the point', () => {
    // Deliberately phrased so a fix breaks it. Two attempts have been made and
    // both were backed out — raising stalled gathering above felling, then
    // capping it to a party of three — because each traded winter deaths for
    // summer starvation: hands taken off hauling come straight off the food.
    // See GAME_DESIGN.md.
    //
    // When a third attempt works, this expectation flips and the file should be
    // rewritten to describe the behaviour rather than the defect.
    const contested = SEEDS.map((seed) => stoneDelivered(seed, { trees: 40 }));
    const total = contested.reduce((sum, amount) => sum + amount, 0);
    const alone = SEEDS.map((seed) => stoneDelivered(seed, { trees: 0 })).reduce(
      (sum, amount) => sum + amount,
      0,
    );

    expect(total).toBeLessThan(alone);
  });
});

function options(seed: number) {
  return { seed, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT, startingVillagers: 10 };
}

/** Stone in the yards after ten days, with a given number of trees also marked. */
function stoneDelivered(seed: number, work: { trees: number }): number {
  const simulation = new Simulation(options(seed));
  designateNearbyStone(simulation, DEPOSITS);
  if (work.trees > 0) {
    designateNearbyTrees(simulation, work.trees);
  }
  advance(simulation, TICKS_PER_DAY * DAYS);
  return simulation.snapshot().stored.stone;
}

/** How far the closest stone deposit is from the camp, in cells. */
function nearestStoneDistance(seed: number): number {
  const simulation = new Simulation(options(seed));
  const camp = simulation.world.landfallCell;

  for (let radius = 1; radius < 45; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        if (simulation.world.terrainAt({ gx: camp.gx + dx, gy: camp.gy + dy }) === 'stone') {
          return radius;
        }
      }
    }
  }
  return Number.POSITIVE_INFINITY;
}

function advance(simulation: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
  }
}
