/**
 * Roads.
 *
 * The thing worth guarding here is not that a bit gets set — it is that the
 * three systems a road touches all agree: pathfinding must *prefer* one,
 * movement must actually *be* faster on one, and a save must bring both back.
 * A road that only pathfinding believes in is a road that makes the settlement
 * slower, by routing everyone down a track that walks like a field.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/simulation/Simulation';
import { NavigationGrid } from '@/simulation/world/NavigationGrid';
import { TerrainGrid } from '@/simulation/world/TerrainGrid';
import { RoadGrid, ROAD_COST_MULTIPLIER, ROAD_SPEED_MULTIPLIER } from '@/simulation/world/RoadGrid';
import { findPath } from '@/simulation/pathfinding/AStar';
import { restore, serialise } from '@/simulation/save/serialise';
import { validateSave } from '@/simulation/save/SaveGame';
import type { GridPoint } from '@/shared/types/geometry';

const OPTIONS = { seed: 20260815, worldWidth: 48, worldHeight: 48, startingVillagers: 10 };
const TICK = 0.1;

/** An open grass world with nothing in it, so a road is the only variable. */
function openWorld(width: number, height: number): { terrain: TerrainGrid; roads: RoadGrid } {
  const terrain = new TerrainGrid(width, height);
  terrain.forEach((gx, gy) => terrain.set(gx, gy, 'grass'));
  return { terrain, roads: new RoadGrid(width, height) };
}

describe('RoadGrid', () => {
  it('starts with no roads', () => {
    const roads = new RoadGrid(8, 8);
    expect(roads.count).toBe(0);
    expect(roads.has(3, 3)).toBe(false);
  });

  it('lays and lifts a road', () => {
    const roads = new RoadGrid(8, 8);

    expect(roads.lay(3, 3)).toBe(true);
    expect(roads.has(3, 3)).toBe(true);
    expect(roads.count).toBe(1);

    expect(roads.lift(3, 3)).toBe(true);
    expect(roads.has(3, 3)).toBe(false);
    expect(roads.count).toBe(0);
  });

  it('refuses to lay the same road twice, or to lift nothing', () => {
    const roads = new RoadGrid(8, 8);
    roads.lay(1, 1);

    expect(roads.lay(1, 1)).toBe(false);
    expect(roads.count).toBe(1);
    expect(roads.lift(5, 5)).toBe(false);
  });

  it('ignores cells outside the map rather than throwing', () => {
    const roads = new RoadGrid(4, 4);

    expect(roads.lay(-1, 0)).toBe(false);
    expect(roads.lay(4, 0)).toBe(false);
    expect(roads.has(-1, -1)).toBe(false);
    expect(roads.count).toBe(0);
  });

  it('bumps its version only when something actually changed', () => {
    const roads = new RoadGrid(8, 8);
    const start = roads.version;

    roads.lay(2, 2);
    const afterLay = roads.version;
    expect(afterLay).toBeGreaterThan(start);

    roads.lay(2, 2);
    expect(roads.version).toBe(afterLay);
  });

  it('round-trips through all() and restore()', () => {
    const roads = new RoadGrid(8, 8);
    roads.lay(1, 2);
    roads.lay(6, 4);

    const copy = new RoadGrid(8, 8);
    copy.restore(roads.all());

    expect(copy.count).toBe(2);
    expect(copy.has(1, 2)).toBe(true);
    expect(copy.has(6, 4)).toBe(true);
  });

  it('replaces rather than merges on restore', () => {
    const roads = new RoadGrid(8, 8);
    roads.lay(0, 0);
    roads.restore([{ gx: 7, gy: 7 }]);

    expect(roads.has(0, 0)).toBe(false);
    expect(roads.count).toBe(1);
  });
});

describe('roads and navigation', () => {
  it('makes a cell cheaper to enter', () => {
    const { terrain, roads } = openWorld(6, 6);
    const grid = new NavigationGrid(terrain);
    grid.useRoads(roads, terrain);
    const plain = grid.costAt(3, 3);

    roads.lay(3, 3);
    grid.refreshCell(terrain, 3, 3);

    expect(grid.costAt(3, 3)).toBeLessThan(plain);
    expect(grid.costAt(3, 3)).toBe(Math.round(plain * ROAD_COST_MULTIPLIER));
  });

  it('gives the ground back when the road is lifted', () => {
    const { terrain, roads } = openWorld(6, 6);
    const grid = new NavigationGrid(terrain);
    grid.useRoads(roads, terrain);
    const plain = grid.costAt(3, 3);

    roads.lay(3, 3);
    grid.refreshCell(terrain, 3, 3);
    roads.lift(3, 3);
    grid.refreshCell(terrain, 3, 3);

    expect(grid.costAt(3, 3)).toBe(plain);
  });

  it('never carries a road across rock', () => {
    // A rock face is not a gap. Whatever is laid on it, it is still the thing
    // in the way.
    const { terrain, roads } = openWorld(6, 6);
    terrain.set(3, 3, 'stone');
    const grid = new NavigationGrid(terrain);
    grid.useRoads(roads, terrain);

    roads.lay(3, 3);
    grid.refreshCell(terrain, 3, 3);

    expect(grid.isWalkable(3, 3)).toBe(false);
  });

  it('does carry one across water, which is what a bridge is', () => {
    // The one exception, and the whole of how a bridge works: nothing in the
    // navigation grid knows what a bridge is, only that boards can be laid over
    // water and not over stone.
    const { terrain, roads } = openWorld(6, 6);
    terrain.set(3, 3, 'water');
    const grid = new NavigationGrid(terrain);
    grid.useRoads(roads, terrain);

    expect(grid.isWalkable(3, 3)).toBe(false);

    roads.lay(3, 3);
    grid.refreshCell(terrain, 3, 3);

    expect(grid.isWalkable(3, 3)).toBe(true);
  });

  it('costs a settlement with no roads nothing at all', () => {
    // The weaker heuristic that roads require expands more nodes. A village
    // that never laid one must not pay for that, and must get the identical
    // path it always did.
    const plain = openWorld(12, 12);
    const plainGrid = new NavigationGrid(plain.terrain);

    const watched = openWorld(12, 12);
    const watchedGrid = new NavigationGrid(watched.terrain);
    watchedGrid.useRoads(watched.roads, watched.terrain);

    expect(watchedGrid.minEntryCost).toBe(plainGrid.minEntryCost);

    const a = findPath(plainGrid, { gx: 0, gy: 0 }, { gx: 11, gy: 9 });
    const b = findPath(watchedGrid, { gx: 0, gy: 0 }, { gx: 11, gy: 9 });
    expect(b.path).toEqual(a.path);
    expect(b.expandedNodes).toBe(a.expandedNodes);

    watched.roads.lay(5, 5);
    expect(watchedGrid.minEntryCost).toBeLessThan(plainGrid.minEntryCost);
  });

  it('routes a path along a road rather than straight across open ground', () => {
    // Two equal-length routes: straight along row 1, or a dog-leg through the
    // paved row 0. Without the discount A* has no reason to prefer the detour.
    const { terrain, roads } = openWorld(9, 3);
    const grid = new NavigationGrid(terrain);
    grid.useRoads(roads, terrain);

    for (let gx = 0; gx < 9; gx += 1) {
      roads.lay(gx, 0);
      grid.refreshCell(terrain, gx, 0);
    }

    const result = findPath(grid, { gx: 0, gy: 1 }, { gx: 8, gy: 1 });
    expect(result.path).not.toBeNull();

    const onRoad = (result.path ?? []).filter((step: GridPoint) => step.gy === 0).length;
    expect(onRoad).toBeGreaterThan(0);
  });
});

describe('laying roads', () => {
  it('will not pave water, rock or a standing tree', () => {
    const simulation = new Simulation(OPTIONS);
    const world = simulation.world;

    const water = findCell(world.width, world.height, (cell) => world.terrainAt(cell) === 'water');
    const rock = findCell(world.width, world.height, (cell) => world.terrainAt(cell) === 'stone');
    const tree = findCell(world.width, world.height, (cell) => world.trees.getAt(cell) !== null);

    if (water) {
      expect(simulation.designateRoad(water)).toBe(false);
    }
    if (rock) {
      expect(simulation.designateRoad(rock)).toBe(false);
    }
    if (tree) {
      expect(simulation.designateRoad(tree)).toBe(false);
    }
  });

  it('orders a road, and a villager eventually lays it', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openCellNear(simulation, simulation.world.heartCell);
    expect(cell).not.toBeNull();
    if (!cell) {
      return;
    }

    const plain = simulation.world.navigation.costAt(cell.gx, cell.gy);
    expect(simulation.designateRoad(cell)).toBe(true);
    expect(simulation.isRoadDesignated(cell)).toBe(true);
    expect(simulation.hasRoad(cell)).toBe(false);

    for (let tick = 0; tick < 3000 && !simulation.hasRoad(cell); tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.hasRoad(cell)).toBe(true);
    // And the settlement now routes over it more cheaply than over the ground
    // it was laid on.
    expect(simulation.world.navigation.costAt(cell.gx, cell.gy)).toBeLessThan(plain);
  });

  it('lays it even while there is other work standing', () => {
    // **The bug a player found in year six: "nobody makes roads".** Paving was
    // the only job in the game at `low` priority, on the theory that roads get
    // built with the hours nobody else needed — and in a settlement that is
    // actually running there are no such hours. There is always another tree
    // marked or another load to carry, so the order sat on the board for ever.
    //
    // Measured on a two-year-old settlement of nineteen people: nine roads
    // ordered, **nought laid** in fifteen days. At `normal` all nine went down.
    const simulation = new Simulation(OPTIONS);
    const cell = openCellNear(simulation, simulation.world.heartCell);
    expect(cell).not.toBeNull();
    if (!cell) {
      return;
    }

    // A board that never empties: forty trees marked is more felling than ten
    // villagers get through in the time this test runs.
    let marked = 0;
    for (let gy = 0; gy < simulation.world.height && marked < 40; gy += 1) {
      for (let gx = 0; gx < simulation.world.width && marked < 40; gx += 1) {
        if (simulation.designateTreeForFelling({ gx, gy })) {
          marked += 1;
        }
      }
    }
    expect(marked).toBeGreaterThan(20);
    expect(simulation.designateRoad(cell)).toBe(true);

    for (let tick = 0; tick < 3000 && !simulation.hasRoad(cell); tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.hasRoad(cell)).toBe(true);
    // And the felling is still going: the road did not get laid because the
    // settlement ran out of work, which is the condition that never arrives.
    expect(
      simulation.jobs.all.filter((job) => job.type === 'chop-tree' && job.state !== 'complete')
        .length,
    ).toBeGreaterThan(0);
  });

  it('still carries the food in before it paves the path', () => {
    // The rule that `low` was protecting, and the one worth keeping: hauling is
    // `high`, so a settlement never paves while its dinner sits in the field.
    const simulation = new Simulation(OPTIONS);
    const cell = openCellNear(simulation, simulation.world.heartCell);
    if (!cell) {
      return;
    }

    simulation.world.piles.drop(simulation.world.landfallCell, 'food', 20);
    expect(simulation.designateRoad(cell)).toBe(true);
    // Hauling jobs are posted during the tick, not the moment the pile lands.
    simulation.update(1, TICK);

    const road = simulation.jobs.all.find((job) => job.type === 'pave-road');
    const haul = simulation.jobs.all.find((job) => job.type === 'haul');
    expect(road).toBeDefined();
    expect(haul).toBeDefined();
    expect(haul!.priority).toBeGreaterThan(road!.priority);
  });

  it('refuses a second order on a cell already ordered', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openCellNear(simulation, simulation.world.heartCell);
    if (!cell) {
      return;
    }

    expect(simulation.designateRoad(cell)).toBe(true);
    expect(simulation.designateRoad(cell)).toBe(false);
  });

  it('cancels a pending order', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openCellNear(simulation, simulation.world.heartCell);
    if (!cell) {
      return;
    }

    simulation.designateRoad(cell);
    expect(simulation.cancelRoadDesignation(cell)).toBe(true);
    expect(simulation.isRoadDesignated(cell)).toBe(false);
    expect(simulation.hasRoad(cell)).toBe(false);
  });

  it('lifts a laid road immediately, and restores the cost', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openCellNear(simulation, simulation.world.heartCell);
    if (!cell) {
      return;
    }
    const plain = simulation.world.navigation.costAt(cell.gx, cell.gy);

    simulation.world.paveRoad(cell);
    expect(simulation.hasRoad(cell)).toBe(true);

    expect(simulation.liftRoad(cell)).toBe(true);
    expect(simulation.hasRoad(cell)).toBe(false);
    expect(simulation.world.navigation.costAt(cell.gx, cell.gy)).toBe(plain);
  });

  it('will not pave a cell that already has a road', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openCellNear(simulation, simulation.world.heartCell);
    if (!cell) {
      return;
    }

    simulation.world.paveRoad(cell);
    expect(simulation.world.canPave(cell)).toBe(false);
    expect(simulation.designateRoad(cell)).toBe(false);
  });
});

describe('walking on roads', () => {
  it('covers more ground in a tick on a road than off one', () => {
    const distance = (paved: boolean): number => {
      const simulation = new Simulation(OPTIONS);
      const world = simulation.world;
      // A straight, clear line to walk. Paving it is the only difference
      // between the two runs.
      const lane = openLane(simulation, LANE_LENGTH);
      const start = lane[0];
      if (!start) {
        return 0;
      }
      if (paved) {
        for (const cell of lane) {
          world.paveRoad(cell);
        }
      }

      const villager = simulation.villagers.all[0];
      if (!villager) {
        return 0;
      }
      // A villager with waypoints walks them before it considers anything
      // else, so the ordinary update loop is what is being measured here — not
      // a private method reached round the back.
      villager.position = { wx: start.gx + 0.5, wy: start.gy + 0.5 };
      villager.currentJobId = null;
      villager.path = lane.slice(1);
      const from = { ...villager.position };

      simulation.villagers.update(TICK);
      return Math.hypot(villager.position.wx - from.wx, villager.position.wy - from.wy);
    };

    const plain = distance(false);
    const paved = distance(true);

    expect(plain).toBeGreaterThan(0);
    expect(paved).toBeGreaterThan(plain);
    // Within rounding, exactly the discount the cost model promised.
    expect(paved / plain).toBeCloseTo(ROAD_SPEED_MULTIPLIER, 2);
  });
});

describe('saving roads', () => {
  it('brings roads back, and the routing that goes with them', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openCellNear(simulation, simulation.world.heartCell);
    if (!cell) {
      return;
    }
    simulation.world.paveRoad(cell);
    const paved = simulation.world.navigation.costAt(cell.gx, cell.gy);

    const save = validateSave(JSON.parse(JSON.stringify(serialise(simulation, 'now'))));
    expect(save.ok).toBe(true);
    if (!save.ok) {
      return;
    }

    const loaded = new Simulation(OPTIONS);
    restore(loaded, save.save);

    expect(loaded.hasRoad(cell)).toBe(true);
    expect(loaded.world.navigation.costAt(cell.gx, cell.gy)).toBe(paved);
  });

  it('reads a save written before roads existed as a settlement with none', () => {
    const simulation = new Simulation(OPTIONS);
    const written = JSON.parse(JSON.stringify(serialise(simulation, 'now'))) as {
      world: { roads?: unknown };
    };
    delete written.world.roads;

    const save = validateSave(written);
    expect(save.ok).toBe(true);
    if (!save.ok) {
      return;
    }

    const loaded = new Simulation(OPTIONS);
    restore(loaded, save.save);
    expect(loaded.world.roads.count).toBe(0);
  });

  it('does not carry roads over into a settlement that has none', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openCellNear(simulation, simulation.world.heartCell);
    if (!cell) {
      return;
    }
    simulation.world.paveRoad(cell);

    const blank = new Simulation(OPTIONS);
    const save = validateSave(JSON.parse(JSON.stringify(serialise(blank, 'now'))));
    if (!save.ok) {
      return;
    }
    restore(simulation, save.save);

    expect(simulation.world.roads.count).toBe(0);
    expect(simulation.hasRoad(cell)).toBe(false);
  });
});

/** The first cell matching a predicate, or `null`. */
function findCell(
  width: number,
  height: number,
  matches: (cell: GridPoint) => boolean,
): GridPoint | null {
  for (let gy = 0; gy < height; gy += 1) {
    for (let gx = 0; gx < width; gx += 1) {
      const cell = { gx, gy };
      if (matches(cell)) {
        return cell;
      }
    }
  }
  return null;
}

/** How many cells of clear, pavable ground the movement test walks along. */
const LANE_LENGTH = 8;

/**
 * A straight run of pavable cells anywhere on the map.
 *
 * Found rather than assumed: the world is generated from a seed, and a lane
 * hard-coded near the centre is one forest tile away from silently making the
 * test measure nothing.
 */
function openLane(simulation: Simulation, length: number): GridPoint[] {
  const world = simulation.world;
  for (let gy = 0; gy < world.height; gy += 1) {
    for (let gx = 0; gx + length <= world.width; gx += 1) {
      const lane: GridPoint[] = [];
      for (let step = 0; step < length; step += 1) {
        lane.push({ gx: gx + step, gy });
      }
      if (lane.every((cell) => world.canPave(cell))) {
        return lane;
      }
    }
  }
  return [];
}

/** A pavable cell close to a point, so tests do not depend on map layout. */
function openCellNear(simulation: Simulation, near: GridPoint): GridPoint | null {
  const world = simulation.world;
  for (let radius = 0; radius < 20; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const cell = { gx: near.gx + dx, gy: near.gy + dy };
        if (world.canPave(cell)) {
          return cell;
        }
      }
    }
  }
  return null;
}
