/**
 * Nothing grows where the settlement has built.
 *
 * A sapling coming up between somebody's houses is the game undoing their work,
 * and it is worse than that once buildings are drawn with ground of their own: a
 * tree on a yard's plot comes up through the deck.
 *
 * Two separate guards do this and both are tested here, because they cover
 * different ground and one of them had a hole in it:
 *
 * - the wild spread refuses any cell with a building on it, and any cell within
 *   two of one — `ForestSystem.nearBuilding`;
 * - ground cleared on purpose is remembered as barren and never offered again —
 *   `Woodland.clear`.
 *
 * **The hole was the founding camp.** It is a store with no building behind it,
 * so the first guard never saw it. Measured over four simulated years, one plot
 * in four grew a tree on the camp itself.
 */

import { describe, expect, it } from 'vitest';

import { FOUNDING_YARD_RADIUS, Simulation } from '@/simulation/Simulation';
import { runForestRegrowth, BUILDING_CLEARANCE } from '@/simulation/world/ForestSystem';
import { SeededRandom } from '@/shared/math/random';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { BuildingId } from '@/data/buildings';
import type { GridPoint } from '@/shared/types/geometry';

const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('the woods and the settlement', () => {
  it('never takes a cell a building stands on', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    expect(hut).not.toBeNull();
    if (!hut) {
      return;
    }

    // A hundred days of nothing but the woods spreading, with the dice run hard:
    // this is the guard, not the odds of hitting it.
    const random = new SeededRandom(1234);
    for (let day = 0; day < 100; day += 1) {
      runForestRegrowth(simulation.world, random);
    }

    for (const cell of hut.cells()) {
      expect(simulation.world.trees.has(cell), `${cell.gx},${cell.gy}`).toBe(false);
    }
  });

  it('keeps its distance from one, too', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    const random = new SeededRandom(99);
    for (let day = 0; day < 100; day += 1) {
      runForestRegrowth(simulation.world, random);
    }

    // Cleared land stays cleared: a settlement re-felling its own square every
    // spring is being given a chore rather than a decision.
    for (const cell of hut.cells()) {
      for (let dy = -BUILDING_CLEARANCE; dy <= BUILDING_CLEARANCE; dy += 1) {
        for (let dx = -BUILDING_CLEARANCE; dx <= BUILDING_CLEARANCE; dx += 1) {
          const near = { gx: cell.gx + dx, gy: cell.gy + dy };
          expect(simulation.world.trees.has(near), `${near.gx},${near.gy}`).toBe(false);
        }
      }
    }
  });

  it('never takes the founding camp, which no building defends', () => {
    // The hole. The camp is a store, so the building rule never applied to it —
    // it is now remembered as ground cleared on purpose, which is what it is.
    const simulation = new Simulation(OPTIONS);
    const camp = simulation.world.landfallCell;
    const random = new SeededRandom(4242);
    for (let day = 0; day < 200; day += 1) {
      runForestRegrowth(simulation.world, random, (cell) => simulation.woodland.isBarren(cell));
    }

    for (const cell of plot(camp, FOUNDING_YARD_RADIUS)) {
      expect(simulation.world.trees.has(cell), `${cell.gx},${cell.gy}`).toBe(false);
    }
  });

  it('leaves the camp clear across four years of ordinary play', () => {
    // The same claim through the whole simulation rather than the one system, so
    // a future change that plants trees by some other route fails here too.
    const simulation = new Simulation(OPTIONS);
    const camp = simulation.world.landfallCell;
    for (let tick = 1; tick <= TICKS_PER_DAY * 48 * 4; tick += 1) {
      simulation.update(tick, 0.1);
    }

    for (const cell of plot(camp, FOUNDING_YARD_RADIUS)) {
      expect(simulation.world.trees.has(cell), `${cell.gx},${cell.gy}`).toBe(false);
    }
  }, 60_000);
});

function plot(centre: GridPoint, radius: number): GridPoint[] {
  const cells: GridPoint[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      cells.push({ gx: centre.gx + dx, gy: centre.gy + dy });
    }
  }
  return cells;
}

function raise(simulation: Simulation, id: BuildingId) {
  const heart = simulation.world.heartCell;
  for (let radius = 2; radius < 24; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        const cell = { gx: heart.gx + dx, gy: heart.gy + dy };
        if (simulation.canPlaceBuilding(id, cell).ok) {
          const building = simulation.placeBuilding(id, cell);
          if (building) {
            simulation.world.buildings.complete(simulation.world, building);
          }
          return building;
        }
      }
    }
  }
  return null;
}
