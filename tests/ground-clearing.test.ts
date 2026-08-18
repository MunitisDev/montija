/**
 * What happens to the ground a building stands on.
 *
 * Two rules, both reported from play:
 *
 * **Nothing stands on forest.** The placement check has always refused trees,
 * but the founding yard was not placed — it is simply declared at the landfall —
 * so a camp that came ashore in a wood sat with trees growing through it, drawn
 * over them and still counting as slow woodland underfoot.
 *
 * **A building takes up the road beneath it.** A road under a wall is a road
 * nobody can walk on, and leaving it there left a track drawn under the
 * building and still costed as a road by the navigation grid.
 */

import { describe, expect, it } from 'vitest';

import { STARTING_RESOURCES } from '@/app/config';
import type { BuildingId } from '@/data/buildings';
import type { GridPoint } from '@/shared/types/geometry';
import { FOUNDING_YARD_RADIUS, Simulation } from '@/simulation/Simulation';
import { World } from '@/simulation/world/World';

const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('the founding camp', () => {
  it('stands on cleared ground, whatever it landed in', () => {
    // Across twenty-four seeds the camp lands somewhere wooded on about a third
    // of them, so this walks the seeds rather than trusting one: the reference
    // seed happens to come ashore on open sand, where the assertion would hold
    // without the clearing doing anything at all.
    let seedsThatLandedInWoods = 0;

    for (let index = 0; index < 24; index += 1) {
      const seed = 20260815 + index * 7919;
      // A pristine world of the same seed, to see what was standing there
      // before the settlement cleared it.
      const before = new World({ width: 64, height: 64, seed });
      const camp = campCells(before.landfallCell);
      if (camp.some((cell) => before.trees.has(cell))) {
        seedsThatLandedInWoods += 1;
      }

      const simulation = new Simulation({ ...OPTIONS, seed });
      for (const cell of campCells(simulation.world.landfallCell)) {
        expect(simulation.world.trees.has(cell)).toBe(false);
        expect(simulation.world.terrainAt(cell)).not.toBe('forest');
      }
    }

    // Guards the test itself: if world generation ever stops putting the camp
    // in the trees, this test proves nothing and should say so out loud.
    expect(seedsThatLandedInWoods).toBeGreaterThan(0);
  });

  it('salvages nothing from what it cleared', () => {
    // Deliberately not `fellTree`: the settlers pushed the scrub aside dragging
    // their bundles in, they did not spend the first hour stacking timber. Free
    // logs at the camp would also quietly change the opening.
    //
    // Nothing is on the ground at all at the start — what they carried went onto
    // the camp's shelves — so the claim is simply that the clearing produced no
    // salvage. The store holds exactly what they brought, and not a stick more.
    const simulation = new Simulation(OPTIONS);

    expect(simulation.world.piles.totalOf('logs')).toBe(0);
    expect(simulation.storages.totalOf('logs')).toBe(STARTING_RESOURCES.logs);
  });

  it('leaves the wood outside the camp alone', () => {
    // A camp that cleared the whole map would be a different bug.
    const simulation = new Simulation(OPTIONS);
    expect(simulation.world.trees.count).toBeGreaterThan(100);
  });
});

describe('clearing a cell', () => {
  it('takes the tree, the woodland and the road, and drops nothing', () => {
    const simulation = new Simulation(OPTIONS);
    const treeCell = firstTree(simulation);
    const before = simulation.world.piles.count;

    expect(simulation.world.clearGround(treeCell)).toBe(true);
    expect(simulation.world.trees.has(treeCell)).toBe(false);
    expect(simulation.world.terrainAt(treeCell)).toBe('grass');
    expect(simulation.world.piles.count).toBe(before);
  });

  it('says nothing was there when nothing was', () => {
    const simulation = new Simulation(OPTIONS);
    expect(simulation.world.clearGround(simulation.world.landfallCell)).toBe(false);
  });
});

describe('a building over a road', () => {
  it('takes the road up beneath it', () => {
    // Roads laid first, then built over — which is the order the player does it
    // in: they pave a route and later decide a warehouse belongs across it.
    const simulation = new Simulation(OPTIONS);
    const spot = placeableSpot(simulation, 'house');
    expect(spot).not.toBeNull();

    const footprint = cellsOf(spot!, 2, 2);
    for (const cell of footprint) {
      expect(simulation.world.paveRoad(cell)).toBe(true);
    }

    const site = simulation.placeBuilding('house', spot!);
    expect(site).not.toBeNull();
    for (const cell of footprint) {
      expect(simulation.world.roads.hasAt(cell)).toBe(false);
    }
  });

  it('leaves the road beside it standing', () => {
    // Only the footprint. A building that lifted the road it fronts onto would
    // cut the settlement's own route every time somebody built beside it.
    const simulation = new Simulation(OPTIONS);
    const spot = placeableSpot(simulation, 'house');
    const beside = { gx: spot!.gx - 1, gy: spot!.gy };
    const laid = simulation.world.paveRoad(beside);

    simulation.placeBuilding('house', spot!);

    // Only meaningful where that cell would take a road at all.
    expect(simulation.world.roads.hasAt(beside)).toBe(laid);
  });
});

/** The nine cells the wreck's cargo stands on. */
function campCells(centre: GridPoint): GridPoint[] {
  return cellsOf(
    { gx: centre.gx - FOUNDING_YARD_RADIUS, gy: centre.gy - FOUNDING_YARD_RADIUS },
    FOUNDING_YARD_RADIUS * 2 + 1,
    FOUNDING_YARD_RADIUS * 2 + 1,
  );
}

function firstTree(simulation: Simulation): GridPoint {
  const tree = [...simulation.world.trees.all][0]!;
  return { gx: tree.gx, gy: tree.gy };
}

/** The first origin the map will take, without placing anything there yet. */
function placeableSpot(simulation: Simulation, id: BuildingId): GridPoint | null {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      const cell = { gx, gy };
      if (simulation.canPlaceBuilding(id, cell).ok) {
        return cell;
      }
    }
  }
  return null;
}

function cellsOf(origin: GridPoint, width: number, height: number): GridPoint[] {
  const cells: GridPoint[] = [];
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      cells.push({ gx: origin.gx + dx, gy: origin.gy + dy });
    }
  }
  return cells;
}
