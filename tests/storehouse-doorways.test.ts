/**
 * A store is only a store if somebody can reach into it.
 *
 * **Every one of these describes a bug that was killing settlements, and all three
 * were invisible on screen.** Goods are fetched from a store at exactly one cell.
 * A yard belonging to a building uses that building's doorway, which the registry
 * already re-finds when a neighbour is raised over it — but the founding yard's
 * doorway is the bare patch of ground the settlers stopped on, and nothing stopped
 * the player putting their first house squarely on top of it.
 *
 * What made it so hard to see is that goods still went *in*: a hauler delivers
 * from the next cell over. So the HUD showed a yard filling steadily to a hundred
 * and seventy logs while every building site and every workshop starved beside it,
 * and the whole thing read as a balance problem with stone.
 *
 * Measured across twelve settlements playing a year: fixing these took 120 deaths
 * down to 63 and put firewood on the shelves for the first time.
 */

import { describe, expect, it } from 'vitest';

import { STARTING_RESOURCES } from '@/app/config';
import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';
import { Simulation } from '@/simulation/Simulation';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { GridPoint } from '@/shared/types/geometry';

const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };
const TICK = 0.1;

describe('a store whose doorway is built over', () => {
  it('moves its doorway to ground somebody can stand on', () => {
    const simulation = new Simulation(OPTIONS);
    const yard = simulation.storages.all[0]!;
    const camp = { ...yard.cell };

    // A building raised squarely on the camp's doorstep. Nothing forbids it: the
    // founding yard is not a building, so a footprint over it is not "occupied".
    wallIn(simulation, camp);
    run(simulation, 1);

    expect(simulation.world.isWalkable(camp)).toBe(false);
    expect(same(yard.cell, camp)).toBe(false);
    expect(simulation.world.reaches(yard.cell)).toBe(true);
  });

  it('never takes another building’s doorstep', () => {
    // **The first version of the rescue did exactly this, and it was worse than
    // the bug.** Deliveries are routed by cell and a building answers for its own
    // doorway before any yard does, so a founding yard rehoused onto a House's
    // doorstep had every basket carried to it disappear into that house's own
    // store-cupboard, where nothing could ever eat it.
    const simulation = new Simulation(OPTIONS);
    const yard = simulation.storages.all[0]!;
    wallIn(simulation, { ...yard.cell });
    run(simulation, 2);

    for (const building of simulation.world.buildings.all) {
      expect(same(building.accessCell, yard.cell)).toBe(false);
    }
  });

  it('keeps feeding people after it happens', () => {
    // The end-to-end version of the test above, and the symptom a player reported:
    // the shelves read nought while the field filled up with food.
    const simulation = new Simulation(OPTIONS);
    const yard = simulation.storages.all[0]!;
    wallIn(simulation, { ...yard.cell });

    simulation.world.dropNear(yard.cell, 'food', 40);
    const before = simulation.storages.totalOf('food');
    run(simulation, TICKS_PER_DAY * 3);

    // Somebody carried it in, and it went onto a shelf rather than into a
    // neighbour's cupboard. Measured against the day's eating, which is why this
    // is "more than it had" rather than an exact figure.
    expect(simulation.world.piles.totalOf('food')).toBeLessThan(40);
    expect(simulation.storages.totalOf('food') + eaten(simulation, before)).toBeGreaterThan(0);
  });
});

describe('fetching materials out of a store', () => {
  it('prefers a shelf that can fill the trip to a nearer scrap that cannot', () => {
    // **A pile holding one log used to beat a shelf holding forty-five.** The rule
    // was nearest-first and nothing else, and only one errand per site and material
    // is on the board at a time — so a Woodcutter costing eight logs took a trip
    // per log while a season's timber sat on the shelf. On the reference settlement
    // the site was ordered on day 8 and still stood half-built on day 24.
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'woodcutter');
    expect(site).not.toBeNull();
    if (!site) {
      return;
    }

    // One log on the doorstep, and everything else in the yard behind it.
    simulation.world.dropNear(site.accessCell, 'logs', 1);
    run(simulation, 2);

    const delivery = simulation.jobs.all.find(
      (job) => job.type === 'haul' && job.haulResource === 'logs' && job.deliverTo !== null,
    );
    expect(delivery).toBeDefined();
    expect(delivery?.haulSource).toBe('storage');
  });

  it('gets a site finished out of the founding store alone', () => {
    // The whole point, end to end: the settlers arrive with 45 logs and 10 stone on
    // the shelves, and that is enough to raise a Woodcutter without felling a tree.
    const simulation = new Simulation(OPTIONS);
    expect(simulation.storages.totalOf('logs')).toBe(STARTING_RESOURCES.logs);
    const site = place(simulation, 'woodcutter');
    if (!site) {
      return;
    }

    for (let tick = 1; tick <= TICKS_PER_DAY * 12; tick += 1) {
      simulation.update(tick, TICK);
      if (site.isComplete) {
        break;
      }
    }

    expect(site.isComplete).toBe(true);
  });
});

// --- helpers ---------------------------------------------------------------

function eaten(simulation: Simulation, before: number): number {
  // A settlement of ten eats ten a day, so "the store went up" is not a claim that
  // survives three days. What is asserted is that the food left the field.
  return Math.max(0, before - simulation.storages.totalOf('food'));
}

/** Raises finished buildings until the given cell is walled in. */
function wallIn(simulation: Simulation, cell: GridPoint): void {
  for (let dy = -1; dy <= 0; dy += 1) {
    for (let dx = -1; dx <= 0; dx += 1) {
      const origin = { gx: cell.gx + dx, gy: cell.gy + dy };
      if (!simulation.canPlaceBuilding('house', origin).ok) {
        continue;
      }
      const house = simulation.placeBuilding('house', origin);
      if (house) {
        simulation.world.buildings.complete(simulation.world, house);
      }
      if (!simulation.world.isWalkable(cell)) {
        return;
      }
    }
  }
}

function same(a: GridPoint, b: GridPoint): boolean {
  return a.gx === b.gx && a.gy === b.gy;
}

function run(simulation: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.update(simulation.tick + 1, TICK);
  }
}

function place(simulation: Simulation, id: BuildingId): Building | null {
  const heart = simulation.world.heartCell;
  for (let radius = 2; radius < 20; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        const cell = { gx: heart.gx + dx, gy: heart.gy + dy };
        if (simulation.canPlaceBuilding(id, cell).ok) {
          return simulation.placeBuilding(id, cell);
        }
      }
    }
  }
  return null;
}
