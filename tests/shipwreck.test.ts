/**
 * The wreck, the shore, and what washed up with them.
 *
 * The settlement needed a reason to exist. Ten people standing in the middle of
 * a map with a pile of supplies is a setup, not a story, and it left the oddest
 * question in the game unanswered: where did the crate of food come from?
 *
 * They were shipwrecked. That single premise has to be true of *every* map, or
 * the opening is a lie on half of them — so these tests are mostly about
 * guarantees rather than about numbers: there is always a sea, it is always on
 * one edge, the settlers always come ashore beside it, and what they salvaged
 * is always a ship's cargo rather than a quarry's.
 */

import { describe, expect, it } from 'vitest';

import { STARTING_RESOURCES } from '@/app/config';
import { buildingDefinition } from '@/data/buildings';
import { Simulation } from '@/simulation/Simulation';
import { SHORES, generateWorld, type Shore } from '@/simulation/world/WorldGenerator';

const OPTIONS = { seed: 20260815, worldWidth: 96, worldHeight: 96, startingVillagers: 10 };
const SEEDS = [1, 7, 42, 991, 2024, 20261, 44444, 123456, 20260815];

function world(seed: number) {
  return generateWorld({ width: OPTIONS.worldWidth, height: OPTIONS.worldHeight, seed });
}

/** Counts water along the outermost row or column of an edge. */
function waterAlong(
  terrain: ReturnType<typeof world>['terrain'],
  shore: Shore,
): { water: number; total: number } {
  let water = 0;
  let total = 0;
  const horizontal = shore === 'east' || shore === 'west';
  const fixed = shore === 'east' ? terrain.width - 1 : shore === 'south' ? terrain.height - 1 : 0;

  const length = horizontal ? terrain.height : terrain.width;
  for (let along = 0; along < length; along += 1) {
    const cell = horizontal ? { gx: fixed, gy: along } : { gx: along, gy: fixed };
    total += 1;
    if (terrain.get(cell.gx, cell.gy) === 'water') {
      water += 1;
    }
  }
  return { water, total };
}

describe('the sea', () => {
  it('is on every map, whatever the seed rolled', () => {
    // The premise of the whole game. Left to the elevation noise, some seeds
    // would get a lake, some a puddle and some nothing at all.
    for (const seed of SEEDS) {
      const { terrain, shore } = world(seed);
      const edge = waterAlong(terrain, shore);
      expect(edge.water, `seed ${seed} (${shore} shore)`).toBe(edge.total);
    }
  });

  it('is on one edge, not all four', () => {
    // A settlement ringed by water is an island, which is a different story and
    // a much smaller map to live on.
    for (const seed of SEEDS) {
      const { terrain, shore } = world(seed);
      const others = SHORES.filter((candidate) => candidate !== shore);
      const drowned = others.filter((candidate) => {
        const edge = waterAlong(terrain, candidate);
        return edge.water === edge.total;
      });
      expect(drowned, `seed ${seed}`).toEqual([]);
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
      expect(land / (terrain.width * terrain.height), `seed ${seed}`).toBeGreaterThan(0.45);
    }
  });

  it('has a coastline that wanders rather than a ruled line', () => {
    // The sea is subtracted from the same noise as everything else precisely so
    // that it gives inlets and headlands. A constant waterline would mean the
    // pull had simply overwritten the terrain.
    const { terrain, shore } = world(20260815);
    const horizontal = shore === 'east' || shore === 'west';
    const depths = new Set<number>();

    const length = horizontal ? terrain.height : terrain.width;
    for (let along = 0; along < length; along += 1) {
      let depth = 0;
      for (let step = 0; step < 40; step += 1) {
        const at =
          shore === 'east'
            ? terrain.width - 1 - step
            : shore === 'south'
              ? terrain.height - 1 - step
              : step;
        const cell = horizontal ? { gx: at, gy: along } : { gx: along, gy: at };
        if (terrain.get(cell.gx, cell.gy) !== 'water') {
          break;
        }
        depth += 1;
      }
      depths.add(depth);
    }

    expect(depths.size).toBeGreaterThan(3);
  });

  it('picks its coast from the seed, and not always the same one', () => {
    const seen = new Set<Shore>();
    for (let seed = 1; seed <= 40; seed += 1) {
      seen.add(world(seed).shore);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('gives the same map the same coast every time', () => {
    expect(world(20260815).shore).toBe(world(20260815).shore);
  });
});

describe('coming ashore', () => {
  it('puts the camp on land, within sight of the water', () => {
    for (const seed of SEEDS) {
      const simulation = new Simulation({ ...OPTIONS, seed });
      const landfall = simulation.world.landfallCell;

      expect(simulation.world.isWalkable(landfall), `seed ${seed} walkable`).toBe(true);

      // Somewhere within a screen of the sea. Far enough that the settlement
      // has ground on every side, near enough that the wreck is the view.
      let nearestWater = Infinity;
      for (let gy = 0; gy < simulation.world.height; gy += 1) {
        for (let gx = 0; gx < simulation.world.width; gx += 1) {
          if (simulation.world.terrain.get(gx, gy) !== 'water') {
            continue;
          }
          nearestWater = Math.min(nearestWater, Math.hypot(gx - landfall.gx, gy - landfall.gy));
        }
      }
      expect(nearestWater, `seed ${seed} distance to water`).toBeLessThan(20);
    }
  });

  it('stacks the salvage where they landed', () => {
    // The starting yard *is* the cargo, so it belongs on the beach rather than
    // in the middle of the map with the story happening off-screen.
    for (const seed of SEEDS) {
      const simulation = new Simulation({ ...OPTIONS, seed });
      expect(simulation.storages.all[0]?.cell, `seed ${seed}`).toEqual(
        simulation.world.landfallCell,
      );
    }
  });

  it('lands the settlers beside it rather than inland', () => {
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

describe('what they salvaged', () => {
  it('is mostly timber, because a ship is made of it', () => {
    expect(STARTING_RESOURCES.logs).toBeGreaterThan(0);
    expect(STARTING_RESOURCES.food).toBeGreaterThan(0);
  });

  it('contains no stone at all', () => {
    // Nobody salvages rock from a boat, and the first morning of the game is
    // now about going to find some.
    expect(Object.keys(STARTING_RESOURCES)).not.toContain('stone');

    const simulation = new Simulation(OPTIONS);
    expect(simulation.storages.totalOf('stone')).toBe(0);
  });

  it('contains iron nobody can use yet', () => {
    // Fittings off the wreck. It sits in the yard doing nothing until there is
    // a Blacksmith, which is the promise that there is somewhere to grow into.
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
