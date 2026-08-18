/**
 * What the people who do not work do all day.
 *
 * Children below fourteen and elders past sixty are outside the labour force by
 * design, and the settlement has always let them wander rather than stand where
 * they were born. Two things were wrong with that picture.
 *
 * **A two-year-old crossed twelve cells of wilderness alone.** Toddlers now keep
 * within sight of the house.
 *
 * **The school did nothing whatsoever**, including nothing to look at. Children
 * of school age now head for it about half the time, when one has been built.
 * It still teaches them nothing — the description says so — but a building that
 * children visibly walk to is a different thing from a building that is only a
 * sentence in a menu.
 *
 * **The random stream is the third thing tested here**, and the least visible.
 * Both changes were made without altering how many numbers are drawn from the
 * villagers' RNG in a settlement that has no school, because changing that
 * re-rolls every seed ever played and every balance figure measured on one.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingId } from '@/data/buildings';
import { RETIREMENT_AGE, WORKING_AGE } from '@/data/population';
import type { Building } from '@/simulation/buildings/Building';
import { Simulation } from '@/simulation/Simulation';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { Villager } from '@/simulation/villagers/Villager';

const OPTIONS = { seed: 20260816, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('the people with no work to do', () => {
  it('sends children and elders walking rather than leaving them standing', () => {
    const simulation = new Simulation(OPTIONS);
    const child = simulation.villagers.all[0]!;
    const elder = simulation.villagers.all[1]!;
    child.age = 9;
    elder.age = RETIREMENT_AGE + 5;
    expect(child.canWork).toBe(false);
    expect(elder.canWork).toBe(false);

    const started = { child: { ...child.position }, elder: { ...elder.position } };
    run(simulation, TICKS_PER_DAY * 2);

    expect(moved(child, started.child)).toBe(true);
    expect(moved(elder, started.elder)).toBe(true);
  });

  it('never puts a child under fourteen or an elder to work', () => {
    const simulation = new Simulation(OPTIONS);
    for (const villager of simulation.villagers.all) {
      villager.age = villager.id % 2 === 0 ? 8 : RETIREMENT_AGE + 2;
    }
    raise(simulation, 'gatherer-hut');
    run(simulation, TICKS_PER_DAY * 2);

    for (const villager of simulation.villagers.all) {
      expect(villager.employerId, `${villager.name} is ${villager.age}`).toBeNull();
    }
  });
});

describe('a toddler', () => {
  it('stays within sight of the house', () => {
    // Twelve cells is the run of the village. A four-year-old gets three.
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house')!;
    run(simulation, TICKS_PER_DAY);

    const toddler = simulation.villagers.all.find((villager) => villager.homeId === house.id);
    expect(toddler).toBeDefined();
    toddler!.age = 3;
    // Two days to finish whatever walk the grown-up they used to be had already
    // set out on. The test is about where they choose to go next, not about
    // teleporting them home the moment their age changes.
    run(simulation, TICKS_PER_DAY * 2);

    let furthest = 0;
    for (let tick = 0; tick < TICKS_PER_DAY * 8; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
      furthest = Math.max(furthest, distance(toddler!.cell, house.accessCell));
    }

    // The radius plus the width of the house they set out from, with room for
    // the path going round a tree — not "never leaves the doorstep", which
    // would be a different and wronger picture.
    expect(furthest).toBeLessThan(9);
  });

  it('goes as far as anybody once they are grown enough', () => {
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house')!;
    run(simulation, TICKS_PER_DAY);
    const child = simulation.villagers.all.find((villager) => villager.homeId === house.id)!;
    child.age = 10;
    run(simulation, TICKS_PER_DAY * 2);

    let furthest = 0;
    for (let tick = 0; tick < TICKS_PER_DAY * 8; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
      furthest = Math.max(furthest, distance(child.cell, house.accessCell));
    }
    expect(furthest).toBeGreaterThan(6);
  });
});

describe('the school', () => {
  it('draws the children to it', () => {
    const simulation = new Simulation(OPTIONS);
    const school = raise(simulation, 'school')!;
    const children = simulation.villagers.all.slice(0, 4);
    for (const child of children) {
      child.age = 8;
    }

    let visits = 0;
    for (let tick = 0; tick < TICKS_PER_DAY * 12; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
      for (const child of children) {
        if (distance(child.cell, school.accessCell) <= 1) {
          visits += 1;
        }
      }
    }
    expect(visits).toBeGreaterThan(0);
  });

  it('does not call the grown-ups in', () => {
    // It teaches nothing and employs nobody. A settlement whose labourers stood
    // about in the schoolyard would be a bug that looked like a feature.
    const simulation = new Simulation(OPTIONS);
    const school = raise(simulation, 'school')!;
    const grown = simulation.villagers.all.filter((villager) => villager.age >= WORKING_AGE);
    expect(grown.length).toBeGreaterThan(0);

    let loitering = 0;
    for (let tick = 0; tick < TICKS_PER_DAY * 6; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
      loitering += grown.filter(
        (villager) =>
          villager.destination !== null && same(villager.destination, school.accessCell),
      ).length;
    }
    expect(loitering).toBe(0);
  });
});

describe('the random stream', () => {
  it('draws exactly what it always drew when there is no school', () => {
    // **The reason both changes are shaped the way they are.** A settlement with
    // no school must consume the same random numbers it did before children had
    // anywhere to go, or every seed ever played becomes a different settlement
    // and every balance figure measured on one becomes a lie.
    const simulation = new Simulation(OPTIONS);
    run(simulation, TICKS_PER_DAY * 6);
    expect(simulation.villagers.randomState.cursor).toBe(NO_SCHOOL_CURSOR);
  });
});

/**
 * Where the villagers' RNG stands after six days of the reference settlement.
 *
 * Measured, not derived, and pinned on purpose: it is the one number that says
 * "nothing upstream of this quietly started drawing dice". If a change moves it,
 * the balance figures in `docs/GAME_DESIGN.md` were measured on a different game
 * and have to be measured again.
 *
 * **It has moved twice, both times deliberately.** First the sea became a river,
 * which re-cut every map from every seed: different trees, different rock, a
 * different camp. Then the settlers began setting their bundles down on the ground
 * rather than into a store, which gives a fresh settlement half a dozen hauls to do
 * on its first morning — so the villagers make different decisions from the first
 * tick, and draw different dice making them. The balance figures were re-measured
 * against each change; that is what this number is for.
 */
const NO_SCHOOL_CURSOR = 3905067433;

function run(simulation: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
  }
}

function moved(villager: Villager, from: { wx: number; wy: number }): boolean {
  return Math.hypot(villager.position.wx - from.wx, villager.position.wy - from.wy) > 0.5;
}

function distance(a: { gx: number; gy: number }, b: { gx: number; gy: number }): number {
  return Math.hypot(a.gx - b.gx, a.gy - b.gy);
}

function same(a: { gx: number; gy: number }, b: { gx: number; gy: number }): boolean {
  return a.gx === b.gx && a.gy === b.gy;
}

/**
 * Puts a building on the first spot that will take it, nearest the camp first.
 *
 * It used to scan from the map's top-left corner, which since the river is a
 * different patch of ground from the settlement — and, where it is the same
 * patch, can be forty cells away. That matters here more than anywhere: a
 * toddler's whole test is how far they stray from their own front door, and a
 * house across the map turns the measurement into the length of the walk home.
 */
function place(simulation: Simulation, id: BuildingId): Building | null {
  const heart = simulation.world.heartCell;
  for (
    let radius = 1;
    radius < Math.max(simulation.world.width, simulation.world.height);
    radius += 1
  ) {
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

function raise(simulation: Simulation, id: BuildingId): Building | null {
  const building = place(simulation, id);
  if (building) {
    simulation.world.buildings.complete(simulation.world, building);
  }
  return building;
}
