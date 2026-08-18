/**
 * The river, the bank, and what the settlers brought with them.
 *
 * A settlement has to be built around something. The map used to put a sea down
 * one edge, which gave every settlement a horizon and nothing else: water you
 * cannot cross, cannot dig from and cannot farm beside is scenery. A river
 * running through the middle is a *decision* — it splits the land the
 * settlement lives on, it is what the orchards need, and it is where the
 * ditches come from.
 *
 * So these tests are mostly guarantees rather than numbers: there is always a
 * river, it always crosses the whole map, it never floods it, and the camp is
 * always on its bank.
 */

import { describe, expect, it } from 'vitest';

import { STARTING_RESOURCES } from '@/app/config';
import { buildingDefinition } from '@/data/buildings';
import { Simulation } from '@/simulation/Simulation';
import { generateWorld, type RiverAxis } from '@/simulation/world/WorldGenerator';

const OPTIONS = { seed: 20260815, worldWidth: 96, worldHeight: 96, startingVillagers: 10 };
const SEEDS = [1, 7, 42, 991, 2024, 20261, 44444, 123456, 20260815];

function world(seed: number) {
  return generateWorld({ width: OPTIONS.worldWidth, height: OPTIONS.worldHeight, seed });
}

describe('the river', () => {
  it('crosses the whole map, whatever the seed rolled', () => {
    // A river that stopped halfway would be a lake with ambitions. Crossing is
    // the point: the settlement has land on both sides and a bridge to build.
    for (const seed of SEEDS) {
      const { terrain, river } = world(seed);
      const horizontal = river.axis === 'horizontal';
      const length = horizontal ? terrain.width : terrain.height;

      expect(river.middle.length, `seed ${seed}`).toBe(length);
      for (const cell of river.middle) {
        expect(terrain.get(cell.gx, cell.gy), `seed ${seed} at ${cell.gx},${cell.gy}`).toBe(
          'water',
        );
      }
    }
  });

  it('runs from edge to edge without leaving the map', () => {
    for (const seed of SEEDS) {
      const { terrain, river } = world(seed);
      const horizontal = river.axis === 'horizontal';
      const first = river.middle[0];
      const last = river.middle[river.middle.length - 1];

      expect(horizontal ? first?.gx : first?.gy, `seed ${seed} source`).toBe(0);
      expect(horizontal ? last?.gx : last?.gy, `seed ${seed} mouth`).toBe(
        (horizontal ? terrain.width : terrain.height) - 1,
      );
      for (const cell of river.middle) {
        expect(terrain.contains(cell.gx, cell.gy), `seed ${seed}`).toBe(true);
      }
    }
  });

  it('bends rather than being ruled straight across', () => {
    // The meander comes from the same kind of noise as everything else,
    // precisely so the two banks are different shapes and the settlement has a
    // side to prefer.
    for (const seed of SEEDS) {
      const { river } = world(seed);
      const horizontal = river.axis === 'horizontal';
      const across = river.middle.map((cell) => (horizontal ? cell.gy : cell.gx));
      const spread = Math.max(...across) - Math.min(...across);
      expect(spread, `seed ${seed}`).toBeGreaterThan(4);
    }
  });

  it('leaves most of the map to live on', () => {
    for (const seed of SEEDS) {
      const { terrain } = world(seed);
      let land = 0;
      for (let gy = 0; gy < terrain.height; gy += 1) {
        for (let gx = 0; gx < terrain.width; gx += 1) {
          if (terrain.get(gx, gy) !== 'water') {
            land += 1;
          }
        }
      }
      expect(land / (terrain.width * terrain.height), `seed ${seed}`).toBeGreaterThan(0.85);
    }
  });

  it('picks its course from the seed, and not always the same way', () => {
    const seen = new Set<RiverAxis>();
    for (let seed = 1; seed <= 40; seed += 1) {
      seen.add(world(seed).river.axis);
    }
    expect(seen.size).toBe(2);
  });

  it('gives the same map the same river every time', () => {
    const once = world(20260815).river;
    const again = world(20260815).river;
    expect(again.axis).toBe(once.axis);
    expect(again.middle).toEqual(once.middle);
  });
});

describe('making camp', () => {
  it('puts the camp on land, on the bank of the river', () => {
    for (const seed of SEEDS) {
      const simulation = new Simulation({ ...OPTIONS, seed });
      const landfall = simulation.world.landfallCell;

      expect(simulation.world.isWalkable(landfall), `seed ${seed} walkable`).toBe(true);

      // Close enough that the water is the view and an orchard can be dug
      // through to; far enough that the settlement has ground on every side.
      let nearestWater = Infinity;
      for (let gy = 0; gy < simulation.world.height; gy += 1) {
        for (let gx = 0; gx < simulation.world.width; gx += 1) {
          if (simulation.world.terrain.get(gx, gy) !== 'water') {
            continue;
          }
          nearestWater = Math.min(nearestWater, Math.hypot(gx - landfall.gx, gy - landfall.gy));
        }
      }
      expect(nearestWater, `seed ${seed} distance to water`).toBeLessThan(12);
      expect(nearestWater, `seed ${seed} distance to water`).toBeGreaterThan(0);
    }
  });

  it('stacks the stores where they stopped walking', () => {
    for (const seed of SEEDS) {
      const simulation = new Simulation({ ...OPTIONS, seed });
      expect(simulation.storages.all[0]?.cell, `seed ${seed}`).toEqual(
        simulation.world.landfallCell,
      );
    }
  });

  it('puts the settlers beside their stores rather than inland', () => {
    for (const seed of SEEDS) {
      const simulation = new Simulation({ ...OPTIONS, seed });
      const landfall = simulation.world.landfallCell;
      for (const villager of simulation.villagers.all) {
        const distance = Math.hypot(villager.cell.gx - landfall.gx, villager.cell.gy - landfall.gy);
        expect(distance, `seed ${seed} ${villager.name}`).toBeLessThan(12);
      }
    }
  });
});

describe('what they brought', () => {
  it('is mostly timber, and enough food to start on', () => {
    expect(STARTING_RESOURCES.logs).toBeGreaterThan(0);
    expect(STARTING_RESOURCES.food).toBeGreaterThan(0);
  });

  it('contains no stone at all', () => {
    // Nobody carries rock across country, and the first morning of the game is
    // about going to find some.
    expect(Object.keys(STARTING_RESOURCES)).not.toContain('stone');

    const simulation = new Simulation(OPTIONS);
    expect(simulation.storages.totalOf('stone')).toBe(0);
  });

  it('contains iron nobody can use yet', () => {
    // It sits in the yard doing nothing until there is a Blacksmith, which is
    // the promise that there is somewhere to grow into.
    const simulation = new Simulation(OPTIONS);
    expect(simulation.storages.totalOf('iron')).toBeGreaterThan(0);
  });

  it('still leaves them able to feed themselves before they find a quarry', () => {
    // The measurement that decided the Gatherer Hut costs timber only. With
    // stone in its price, a settlement playing well starved on day 22 of three
    // seeds out of four, hunting for a deposit it could not eat.
    const { constructionCost } = buildingDefinition('gatherer-hut');
    expect(constructionCost.some((entry) => entry.resource === 'stone')).toBe(false);
    expect(constructionCost.some((entry) => entry.resource === 'logs')).toBe(true);
  });
});
