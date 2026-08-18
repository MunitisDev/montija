/**
 * Where a building's goods go in and out.
 *
 * A building is a blocked footprint with one cell beside it that everything
 * passes through: materials in while it is built, produce out while it works,
 * salvage out when it is pulled down. That cell is chosen, not declared — and
 * getting the choice wrong is invisible until a settlement starves beside a hut
 * whose gatherers are working perfectly.
 *
 * Three rules, all of them learned the hard way:
 *
 * - **any free ground touching the building will do**, and a road touching it is
 *   better, because a road is where the traffic already goes;
 * - **the settlement has to be able to walk there.** A doorway opening onto a
 *   sealed pocket is worse than none: everything set down on it is lost in plain
 *   sight;
 * - **it is re-found whenever the walls change**, because the next building
 *   raised next door can be standing on it.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingId } from '@/data/buildings';
import type { GridPoint } from '@/shared/types/geometry';
import { Simulation } from '@/simulation/Simulation';

const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('choosing a doorway', () => {
  it('takes free ground beside the building', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const hut = raise(simulation, 'gatherer-hut', { gx: origin.gx + 4, gy: origin.gy + 4 });

    expect(touching(hut.accessCell, hut.origin, 2, 2)).toBe(true);
    expect(simulation.world.isWalkable(hut.accessCell)).toBe(true);
  });

  it('prefers a road, because that is where the carrying happens', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const plot = { gx: origin.gx + 4, gy: origin.gy + 4 };
    // A track laid along one side before the hut goes up.
    const track = { gx: plot.gx + 2, gy: plot.gy + 1 };
    expect(simulation.world.paveRoad(track)).toBe(true);

    const hut = raise(simulation, 'gatherer-hut', plot);

    expect(simulation.world.roads.hasAt(hut.accessCell)).toBe(true);
  });

  it('looks further out when every neighbouring cell is built over', () => {
    // **The case this was written for.** A building packed in on all sides used
    // to end up with its delivery point inside a wall, and everything it made was
    // piled there for ever.
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const plot = { gx: origin.gx + 4, gy: origin.gy + 4 };
    const hut = raise(simulation, 'gatherer-hut', plot);

    // Wall it in: four yards around the hut, leaving no free cell touching it.
    surround(simulation, plot, 2);

    expect(simulation.world.isWalkable(hut.accessCell)).toBe(true);
    expect(simulation.world.navigation.connects(simulation.world.heartCell, hut.accessCell)).toBe(
      true,
    );
    // Not touching it any more — it cannot be — but within a few paces.
    expect(distance(hut.accessCell, plot)).toBeLessThan(6);
  });

  it('never opens onto ground the settlement cannot reach', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const hut = raise(simulation, 'gatherer-hut', { gx: origin.gx + 4, gy: origin.gy + 4 });

    // A pond on one side, so the obvious neighbour is a cell in a puddle's pocket.
    for (let dy = -1; dy <= 2; dy += 1) {
      simulation.world.terrain.set(hut.origin.gx - 2, hut.origin.gy + dy, 'water');
    }
    simulation.world.navigation.rebuild(simulation.world.terrain);
    simulation.world.buildings.complete(simulation.world, hut);

    expect(simulation.world.navigation.connects(simulation.world.heartCell, hut.accessCell)).toBe(
      true,
    );
  });
});

describe('what is set down there', () => {
  it('spills onto ground a hauler can reach, never into a pocket', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const cell = { gx: origin.gx + 4, gy: origin.gy + 4 };

    simulation.world.dropNear(cell, 'food', 200);

    const heart = simulation.world.heartCell;
    for (const pile of simulation.world.piles.all) {
      expect(
        simulation.world.navigation.connects(heart, pile.cell),
        `${pile.cell.gx},${pile.cell.gy}`,
      ).toBe(true);
    }
  });

  it('is found again when somebody builds over the doorway', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = clearing(simulation);
    const hut = raise(simulation, 'gatherer-hut', { gx: origin.gx + 4, gy: origin.gy + 4 });
    const first = { ...hut.accessCell };

    // A house raised across the doorway, without touching the hut's own plot:
    // its two-by-two footprint ends exactly where the doorway is.
    raise(simulation, 'house', { gx: first.gx - 1, gy: first.gy - 1 });

    expect(simulation.world.isWalkable(hut.accessCell)).toBe(true);
    expect(hut.accessCell).not.toEqual(first);
  });
});

/** A cleared patch beside the settlement, so the map is not the variable. */
function clearing(simulation: Simulation, span = 16): GridPoint {
  const world = simulation.world;
  const heart = world.heartCell;
  const origin = { gx: heart.gx + 2, gy: heart.gy + 2 };

  for (let dy = 0; dy < span; dy += 1) {
    for (let dx = 0; dx < span; dx += 1) {
      const cell = { gx: origin.gx + dx, gy: origin.gy + dy };
      const tree = world.trees.getAt(cell);
      if (tree) {
        world.trees.remove(tree.id);
      }
      const pile = world.piles.anyAt(cell);
      if (pile) {
        world.piles.remove(pile.id);
      }
      world.terrain.set(cell.gx, cell.gy, 'grass');
    }
  }
  world.navigation.rebuild(world.terrain);
  return origin;
}

function raise(simulation: Simulation, id: BuildingId, cell: GridPoint) {
  const check = simulation.canPlaceBuilding(id, cell);
  if (!check.ok) {
    throw new Error(`A ${id} was refused at ${cell.gx},${cell.gy}: ${check.reason}`);
  }
  const building = simulation.placeBuilding(id, cell)!;
  simulation.world.buildings.complete(simulation.world, building);
  return building;
}

/** Builds walls around a plot until no free cell touches it. */
function surround(simulation: Simulation, plot: GridPoint, size: number): void {
  for (const corner of [
    { gx: plot.gx - 2, gy: plot.gy - 2 },
    { gx: plot.gx + size, gy: plot.gy - 2 },
    { gx: plot.gx - 2, gy: plot.gy + size },
    { gx: plot.gx + size, gy: plot.gy + size },
  ]) {
    const building = simulation.placeBuilding('gatherer-hut', corner);
    if (building) {
      simulation.world.buildings.complete(simulation.world, building);
    }
  }
}

function touching(cell: GridPoint, origin: GridPoint, width: number, height: number): boolean {
  return (
    cell.gx >= origin.gx - 1 &&
    cell.gx <= origin.gx + width &&
    cell.gy >= origin.gy - 1 &&
    cell.gy <= origin.gy + height
  );
}

function distance(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy));
}
