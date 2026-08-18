/**
 * Nobody gets walled in.
 *
 * The worst bug this project has had, and it hid for twenty-two phases behind a
 * single seed. A building blocks its footprint the moment it is finished, and
 * nothing checked who was standing inside it. Every path search starts from the
 * villager's own cell, and from inside a wall every single one fails — so an
 * entombed villager never worked again. They could not fell, haul, build or
 * take a post, and they still ate.
 *
 * It was invisible on seed 20260815, which is the only seed the balance tests
 * use, and fatal on most others: measured across eight seeds, six lost the
 * whole settlement, with up to seven of ten villagers walled in at the
 * settlement centre by day six. From outside it read as a game that was simply
 * too hard.
 *
 * These tests are therefore less about the building code than about the
 * property that matters: **a villager is always somewhere a villager can
 * stand.** Anything that closes a cell — a finished building today, a terrain
 * change or an old save tomorrow — must not be able to take somebody out of
 * the game permanently.
 */

import { describe, expect, it } from 'vitest';

import { Simulation } from '@/simulation/Simulation';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { gridToWorld } from '@/shared/math/isometric';
import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';

const TICK = 0.1;
const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('a villager standing where a wall appears', () => {
  it('is moved out rather than sealed in', () => {
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'house');
    expect(site).not.toBeNull();
    if (!site) {
      return;
    }

    // Stand somebody squarely on the plot, which is exactly what happens on
    // its own when a villager wanders across a site about to be finished.
    const villager = simulation.villagers.all[0]!;
    const plot = site.cells()[0]!;
    villager.position = gridToWorld(plot);
    simulation.world.buildings.complete(simulation.world, site);
    expect(simulation.world.isWalkable(plot)).toBe(false);

    simulation.update(simulation.tick + 1, TICK);

    expect(simulation.world.isWalkable(villager.cell)).toBe(true);
  });

  it('can still find work afterwards', () => {
    // The property that actually matters. Being on a walkable cell is only
    // worth anything because it is what lets them path anywhere at all.
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'house');
    if (!site) {
      return;
    }
    const villager = simulation.villagers.all[0]!;
    villager.position = gridToWorld(site.cells()[0]!);
    simulation.world.buildings.complete(simulation.world, site);

    designateNear(simulation, 20);

    let worked = false;
    for (let tick = 1; tick <= TICKS_PER_DAY * 2 && !worked; tick += 1) {
      simulation.update(simulation.tick + 1, TICK);
      worked = villager.currentJobId !== null;
    }

    expect(worked).toBe(true);
  });

  it('hands back the job it was holding', () => {
    // A job planned from a cell they were never really standing on: the route
    // is wrong, so it goes back on the board for somebody who can reach it.
    const simulation = new Simulation(OPTIONS);
    designateNear(simulation, 20);
    // Somebody standing at their work rather than walking to it: a villager
    // mid-path keeps their job, because they have a route out and will use it.
    let worker = undefined;
    for (let tick = 1; tick <= TICKS_PER_DAY * 2 && !worker; tick += 1) {
      simulation.update(tick, TICK);
      worker = simulation.villagers.all.find(
        (candidate) => candidate.currentJobId !== null && !candidate.isMoving,
      );
    }
    expect(worker).toBeDefined();
    if (!worker) {
      return;
    }
    const jobId = worker.currentJobId!;

    const site = place(simulation, 'house');
    if (!site) {
      return;
    }
    worker.position = gridToWorld(site.cells()[0]!);
    simulation.world.buildings.complete(simulation.world, site);
    simulation.update(simulation.tick + 1, TICK);

    // **The invariant is that nobody holds a job from inside a wall**, not that
    // the job stays on the board: the rescue hands it back, and a villager who is
    // now standing on open ground may perfectly well take the same job again a
    // tick later — which is what happens since a fresh settlement has its own
    // bundles to carry and more work within reach.
    expect(simulation.world.isWalkable(worker.cell)).toBe(true);
    const holder = simulation.villagers.all.find((candidate) => candidate.currentJobId === jobId);
    if (holder) {
      expect(simulation.world.isWalkable(holder.cell)).toBe(true);
    }
  });

  it('does not appear to slide out of the wall', () => {
    // The renderer interpolates between last tick's position and this one, so
    // a rescue that only set `position` would draw a villager gliding out
    // through the masonry.
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'house');
    if (!site) {
      return;
    }
    const villager = simulation.villagers.all[0]!;
    villager.position = gridToWorld(site.cells()[0]!);
    simulation.world.buildings.complete(simulation.world, site);

    simulation.update(simulation.tick + 1, TICK);

    expect(villager.previousPosition).toEqual(villager.position);
  });
});

describe('a settlement that keeps building', () => {
  it('never leaves anybody stuck inside a wall', () => {
    // The regression proper, on the seeds that used to fail. Eight buildings go
    // up around a working settlement over three weeks.
    //
    // The assertion is about *persistence*, not about a single tick. A cell is
    // a floored position, so somebody walking along a wall reads as inside it
    // briefly and legitimately; what must never happen is staying there. A few
    // ticks is a villager passing. Hundreds is a villager entombed, which is
    // what this whole file exists for.
    const PASSING_TICKS = 20;

    for (const seed of [20260815, 991, 123456, 2024, 7]) {
      const simulation = new Simulation({ ...OPTIONS, seed });
      designateNear(simulation, 40);

      const stuckFor = new Map<number, number>();
      let worst = 0;
      let raised = 0;

      for (let day = 1; day <= 21; day += 1) {
        if (day % 3 === 0 && raised < 8) {
          const building = place(simulation, raised % 2 === 0 ? 'house' : 'gatherer-hut');
          if (building) {
            // Finished on the spot, which is the worst case: no warning, and
            // whoever is on the plot is on it when the walls close.
            simulation.world.buildings.complete(simulation.world, building);
            raised += 1;
          }
        }

        for (let tick = 1; tick <= TICKS_PER_DAY; tick += 1) {
          simulation.update(simulation.tick + 1, TICK);
          for (const villager of simulation.villagers.all) {
            const run = simulation.world.isWalkable(villager.cell)
              ? 0
              : (stuckFor.get(villager.id) ?? 0) + 1;
            stuckFor.set(villager.id, run);
            worst = Math.max(worst, run);
          }
        }
      }

      expect(raised, `seed ${seed}`).toBeGreaterThan(0);
      expect(worst, `seed ${seed} longest run stuck in a wall`).toBeLessThan(PASSING_TICKS);
    }
  });

  it('keeps everybody working on maps other than the tuned one', () => {
    // The symptom the bug produced: villagers who had stopped being able to do
    // anything at all. Idleness is normal in moderation; two thirds of the
    // settlement permanently idle is what walling people in looked like.
    for (const seed of [991, 123456, 7]) {
      const simulation = new Simulation({ ...OPTIONS, seed });
      designateNear(simulation, 60);
      for (let day = 1; day <= 6; day += 1) {
        const building = place(simulation, 'house');
        if (building) {
          simulation.world.buildings.complete(simulation.world, building);
        }
        for (let tick = 1; tick <= TICKS_PER_DAY; tick += 1) {
          simulation.update(simulation.tick + 1, TICK);
        }
      }

      const busy = simulation.villagers.all.filter(
        (villager) => villager.currentJobId !== null,
      ).length;
      expect(busy, `seed ${seed}`).toBeGreaterThan(0);
    }
  });
});

// --- helpers ---------------------------------------------------------------

/**
 * Marks the trees nearest the settlement.
 *
 * Nearest matters: taking the first N from the world's own list picks trees in
 * generation order, which can be the far corner of the map, and then a test
 * measuring what a working villager does spends its whole budget watching one
 * walk there.
 */
function designateNear(simulation: Simulation, count: number): void {
  const centre = simulation.storages.all[0]?.cell ?? { gx: 32, gy: 32 };
  const trees = [...simulation.world.trees.all].sort(
    (a, b) =>
      Math.hypot(a.gx - centre.gx, a.gy - centre.gy) -
      Math.hypot(b.gx - centre.gx, b.gy - centre.gy),
  );
  for (const tree of trees.slice(0, count)) {
    simulation.designateTreeForFelling({ gx: tree.gx, gy: tree.gy });
  }
}

function place(simulation: Simulation, id: BuildingId): Building | null {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      const cell = { gx, gy };
      if (simulation.canPlaceBuilding(id, cell).ok) {
        return simulation.placeBuilding(id, cell);
      }
    }
  }
  return null;
}
