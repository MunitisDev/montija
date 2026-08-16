/**
 * Woodland that grows back, and the lodge that manages it.
 *
 * The property worth protecting is not "trees appear" — it is the shape of the
 * ceiling. A wood that never stops spreading swallows the map over a long game,
 * and a wood that stops too eagerly leaves a clear-felled settlement with no way
 * back. Both failures take years of simulated time to show up in play and about
 * a second to catch here.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/simulation/Simulation';
import { World } from '@/simulation/world/World';
import {
  BUILDING_CLEARANCE,
  MIN_TREE_NEIGHBOURS,
  WOODLAND_CAP_FRACTION,
  runForestRegrowth,
} from '@/simulation/world/ForestSystem';
import { SeededRandom } from '@/shared/math/random';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { GridPoint } from '@/shared/types/geometry';

const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 0 };
const TICK = 0.1;

function newWorld(): World {
  return new World({ width: 64, height: 64, seed: 20260815 });
}

describe('planting', () => {
  it('turns the ground back into woodland', () => {
    const world = newWorld();
    const cell = openCell(world);
    expect(cell).not.toBeNull();
    if (!cell) {
      return;
    }

    expect(world.plantTree(cell, 0, 1)).toBe(true);
    expect(world.trees.getAt(cell)).not.toBeNull();
    // Felling turns forest into grass; the mirror has to hold, or a wood could
    // regrow without the ground ever becoming woodland again.
    expect(world.terrainAt(cell)).toBe('forest');
  });

  it('refuses to stack two trees on one cell', () => {
    const world = newWorld();
    const cell = openCell(world);
    if (!cell) {
      return;
    }

    expect(world.plantTree(cell, 0, 1)).toBe(true);
    expect(world.plantTree(cell, 1, 1)).toBe(false);
  });

  it('refuses a road, water and rock', () => {
    const world = newWorld();
    const cell = openCell(world);
    if (!cell) {
      return;
    }

    world.paveRoad(cell);
    expect(world.canGrowTree(cell)).toBe(false);

    const water = findCell(world, (c) => world.terrainAt(c) === 'water');
    const rock = findCell(world, (c) => world.terrainAt(c) === 'stone');
    if (water) {
      expect(world.canGrowTree(water)).toBe(false);
    }
    if (rock) {
      expect(world.canGrowTree(rock)).toBe(false);
    }
  });

  it('gives new trees ids nothing else is using', () => {
    const world = newWorld();
    const existing = new Set([...world.trees.all].map((tree) => tree.id));

    for (let i = 0; i < 5; i += 1) {
      const cell = openCell(world);
      if (!cell) {
        break;
      }
      world.plantTree(cell, 0, 1);
    }

    const ids = [...world.trees.all].map((tree) => tree.id);
    expect(new Set(ids).size).toBe(ids.length);
    // A sapling taking the id of a tree somebody's job still points at would
    // fell the wrong tree, silently.
    const fresh = ids.filter((id) => !existing.has(id));
    expect(fresh.length).toBeGreaterThan(0);
  });
});

describe('natural regrowth', () => {
  it('is deterministic from the same stream', () => {
    const run = (): number => {
      const world = newWorld();
      const random = new SeededRandom(99);
      let grown = 0;
      for (let day = 0; day < 40; day += 1) {
        grown += runForestRegrowth(world, random).grown;
      }
      return grown;
    };

    expect(run()).toBe(run());
  });

  it('grows the wood back over a few years', () => {
    const world = newWorld();
    const random = new SeededRandom(7);
    const before = world.trees.count;

    for (let day = 0; day < 240; day += 1) {
      runForestRegrowth(world, random);
    }

    expect(world.trees.count).toBeGreaterThan(before);
  });

  it('stops at the ceiling rather than swallowing the map', () => {
    // The failure this exists for takes twelve simulated years to appear in
    // play: without a ceiling the wood's edge advances one cell at a time
    // forever, and eventually there is no meadow left to build on.
    const world = newWorld();
    const random = new SeededRandom(7);
    const ceiling = Math.floor(world.width * world.height * WOODLAND_CAP_FRACTION);

    for (let day = 0; day < 1000; day += 1) {
      runForestRegrowth(world, random);
    }

    expect(world.trees.count).toBeLessThanOrEqual(ceiling);
    // And it really did get there, or the test would pass on a world that
    // never grew at all.
    expect(world.trees.count).toBeGreaterThan(ceiling * 0.9);
  });

  it('reports nothing once the ceiling is reached', () => {
    const world = newWorld();
    const random = new SeededRandom(7);
    for (let day = 0; day < 1000; day += 1) {
      runForestRegrowth(world, random);
    }

    expect(runForestRegrowth(world, random).grown).toBe(0);
  });

  it('needs a neighbouring wood, so open meadow stays meadow', () => {
    const world = newWorld();
    // A lone tree in the open has no second neighbour, so nothing can take
    // beside it however long it stands there.
    const lonely = findCell(
      world,
      (cell) => world.canGrowTree(cell) && treeNeighbours(world, cell) === 0,
    );
    expect(lonely).not.toBeNull();
    if (!lonely) {
      return;
    }
    world.plantTree(lonely, 0, 1);

    const random = new SeededRandom(3);
    for (let day = 0; day < 300; day += 1) {
      runForestRegrowth(world, random);
    }

    // Its own neighbourhood is still empty apart from itself.
    expect(treeNeighbours(world, lonely)).toBeLessThan(MIN_TREE_NEIGHBOURS);
  });

  it('leaves the settlement ground clear', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = findBuildable(simulation);
    expect(origin).not.toBeNull();
    if (!origin) {
      return;
    }

    const building = simulation.placeBuilding('house', origin);
    expect(building).not.toBeNull();
    if (!building) {
      return;
    }
    simulation.world.buildings.complete(simulation.world, building);

    // Trees that were already standing when the house went up are not the
    // system's doing and it must not be blamed for them. What is checked is
    // that regrowth adds nothing new inside the clearance.
    const before = treeIdsAround(simulation, origin, BUILDING_CLEARANCE);

    const random = new SeededRandom(11);
    for (let day = 0; day < 400; day += 1) {
      runForestRegrowth(simulation.world, random);
    }

    const after = treeIdsAround(simulation, origin, BUILDING_CLEARANCE);
    expect([...after].filter((id) => !before.has(id))).toEqual([]);
  });
});

describe("a forester's lodge", () => {
  it('plants when its range is thin', () => {
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 6 });
    const origin = clearArea(simulation);
    expect(origin).not.toBeNull();
    if (!origin) {
      return;
    }

    const lodge = simulation.placeBuilding('forester', origin);
    expect(lodge).not.toBeNull();
    if (!lodge) {
      return;
    }
    simulation.world.buildings.complete(simulation.world, lodge);

    const before = simulation.world.trees.count;
    for (let tick = 1; tick <= TICKS_PER_DAY * 20; tick += 1) {
      simulation.update(tick, TICK);
    }

    // Some of that is natural spread; what matters is that the lodge posted
    // planting work at all and that villagers carried it out.
    const planted = simulation.jobs.all.filter((job) => job.type === 'plant-tree');
    expect(planted.length).toBeGreaterThan(0);
    expect(simulation.world.trees.count).toBeGreaterThan(before);
  });

  it('never puts two saplings on the same cell', () => {
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 6 });
    const origin = clearArea(simulation);
    if (!origin) {
      return;
    }
    const lodge = simulation.placeBuilding('forester', origin);
    if (!lodge) {
      return;
    }
    simulation.world.buildings.complete(simulation.world, lodge);

    for (let tick = 1; tick <= TICKS_PER_DAY * 10; tick += 1) {
      simulation.update(tick, TICK);

      const live = simulation.jobs.all.filter(
        (job) => job.type === 'plant-tree' && job.state !== 'complete' && job.state !== 'cancelled',
      );
      const cells = live.map((job) => `${job.target.gx},${job.target.gy}`);
      expect(new Set(cells).size, `tick ${tick}`).toBe(cells.length);
    }
  });

  it('fells rather than plants once its range is full', () => {
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 6 });
    // Deep in the woods, where the lodge's range is already over its target.
    const origin = findBuildable(simulation, (cell) => treesAround(simulation, cell, 10) > 130);
    expect(origin).not.toBeNull();
    if (!origin) {
      return;
    }

    const lodge = simulation.placeBuilding('forester', origin);
    if (!lodge) {
      return;
    }
    simulation.world.buildings.complete(simulation.world, lodge);

    for (let tick = 1; tick <= TICKS_PER_DAY * 6; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.jobs.all.some((job) => job.type === 'chop-tree')).toBe(true);
    expect(simulation.jobs.all.some((job) => job.type === 'plant-tree')).toBe(false);
  });
});

// --- helpers ---------------------------------------------------------------

function findCell(world: World, matches: (cell: GridPoint) => boolean): GridPoint | null {
  for (let gy = 0; gy < world.height; gy += 1) {
    for (let gx = 0; gx < world.width; gx += 1) {
      const cell = { gx, gy };
      if (matches(cell)) {
        return cell;
      }
    }
  }
  return null;
}

function openCell(world: World): GridPoint | null {
  return findCell(world, (cell) => world.canGrowTree(cell));
}

function treeNeighbours(world: World, cell: GridPoint): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      if (world.trees.has({ gx: cell.gx + dx, gy: cell.gy + dy })) {
        count += 1;
      }
    }
  }
  return count;
}

function treesAround(simulation: Simulation, centre: GridPoint, radius: number): number {
  let count = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (simulation.world.trees.has({ gx: centre.gx + dx, gy: centre.gy + dy })) {
        count += 1;
      }
    }
  }
  return count;
}

/** Every tree id standing in a box around a point. */
function treeIdsAround(simulation: Simulation, centre: GridPoint, radius: number): Set<number> {
  const ids = new Set<number>();
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const tree = simulation.world.trees.getAt({ gx: centre.gx + dx, gy: centre.gy + dy });
      if (tree) {
        ids.add(tree.id);
      }
    }
  }
  return ids;
}

/** Somewhere a 2x2 building will actually go. */
function findBuildable(
  simulation: Simulation,
  extra: (cell: GridPoint) => boolean = () => true,
): GridPoint | null {
  return findCell(
    simulation.world,
    (cell) => simulation.canPlaceBuilding('house', cell).ok && extra(cell),
  );
}

/** Buildable ground with few trees around it, so a lodge there will plant. */
function clearArea(simulation: Simulation): GridPoint | null {
  return findBuildable(simulation, (cell) => treesAround(simulation, cell, 10) < 40);
}
