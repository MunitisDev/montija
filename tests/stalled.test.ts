/**
 * The two ways a settlement stops working and says nothing about it.
 *
 * Both were found by playing, and both look identical from the outside: the
 * villagers walk about, work appears to be happening, and nothing gets built.
 *
 * **A site waiting for a material nobody has any of.** Twelve houses ordered,
 * every one of them short of stone, a settlement with none, and a banner
 * cheerfully advising the player to build Houses. That last part is the worst
 * of it — the game was answering a question nobody asked while the actual
 * problem sat unmentioned for forty days.
 *
 * **A pile with nowhere to go.** `createHaulJobs` leaves such a pile alone,
 * correctly, because there is nothing to be done with it. Until now it did so
 * in silence, and the settlement stopped carrying anything in.
 *
 * The guidance is the fix. Neither condition is a bug in the simulation: a
 * house genuinely cannot be built without stone, and a load genuinely cannot be
 * carried into a yard that will not take it. What was broken was that the game
 * knew and did not say.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';
import { Simulation } from '@/simulation/Simulation';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';

const TICK = 0.1;
const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('a site waiting for a material nobody has', () => {
  it('says so, and names the material', () => {
    // A house needs stone, and this settlement has none: the ten they walked in
    // with are taken away here, along with the bundles on the ground, because a
    // site is now supplied from either and "nobody has any" has to mean both.
    const simulation = new Simulation(OPTIONS);
    emptyHanded(simulation);
    // Timber back, stone not: the point is a site short of one particular thing,
    // and a settlement short of everything reports whichever it misses first.
    stock(simulation, 'logs', 20);
    expect(simulation.snapshot().stored.stone).toBe(0);
    place(simulation, 'house');
    run(simulation, TICKS_PER_DAY);

    expect(simulation.stalledMaterial()).toBe('stone');
    expect(simulation.snapshot().advice).toBe('siteStalled');
    expect(simulation.snapshot().stalledMaterial).toBe('stone');
  });

  it('says nothing while the material is merely short', () => {
    // A site waiting on stone that a quarry is cutting is not stalled, it is
    // waiting, and telling the player would be crying wolf.
    const simulation = new Simulation(OPTIONS);
    stock(simulation, 'stone', 50);
    place(simulation, 'house');
    run(simulation, TICKS_PER_DAY);

    expect(simulation.stalledMaterial()).toBeNull();
  });

  it('says nothing when there is nothing being built', () => {
    const simulation = new Simulation(OPTIONS);
    run(simulation, TICKS_PER_DAY);
    expect(simulation.stalledMaterial()).toBeNull();
  });

  it('clears the moment the material arrives', () => {
    const simulation = new Simulation(OPTIONS);
    emptyHanded(simulation);
    stock(simulation, 'logs', 20);
    place(simulation, 'house');
    run(simulation, TICKS_PER_DAY);
    expect(simulation.stalledMaterial()).toBe('stone');

    stock(simulation, 'stone', 20);
    expect(simulation.stalledMaterial()).toBeNull();
  });

  it('outranks nothing that is actually killing anybody', () => {
    // Starving beats stalled. A settlement being told about masonry while
    // people die is a settlement being told the wrong thing.
    const simulation = new Simulation(OPTIONS);
    place(simulation, 'house');
    emptyHanded(simulation);
    for (const villager of simulation.villagers.all) {
      villager.needs.hunger = 0;
    }
    run(simulation, TICKS_PER_DAY + 1);

    // Either material will do — the point is that the settlement is told
    // about the people dying rather than about the masonry.
    expect(simulation.stalledMaterial()).not.toBeNull();
    expect(simulation.snapshot().advice).toBe('starving');
  });
});

describe('telling the player to build what they already ordered', () => {
  it('stops asking for houses once houses are going up', () => {
    // The report that started this: a dozen houses half-built, every one of
    // them stalled, and the banner still saying "build Houses".
    const simulation = new Simulation(OPTIONS);
    toAutumn(simulation);
    expect(simulation.snapshot().population.homeless).toBeGreaterThan(0);

    const withoutSites = simulation.snapshot().advice;
    expect(withoutSites).toBe('noShelter');

    place(simulation, 'house');
    run(simulation, TICKS_PER_DAY);

    expect(simulation.snapshot().advice).not.toBe('noShelter');
  });

  it('still asks when nothing at all has been ordered', () => {
    const simulation = new Simulation(OPTIONS);
    toAutumn(simulation);
    expect(simulation.snapshot().advice).toBe('noShelter');
  });

  it('is not fooled by a site that houses nobody', () => {
    // A gatherer hut going up is not shelter, and a player who ordered one
    // still needs telling that winter is coming and nobody has a roof.
    const simulation = new Simulation(OPTIONS);
    toAutumn(simulation);
    place(simulation, 'gatherer-hut');
    run(simulation, TICKS_PER_DAY);

    expect(simulation.snapshot().advice).toBe('noShelter');
  });
});

describe('full yards do not stop the timber', () => {
  it('sends the pile to the site rather than to a yard with no room', () => {
    // The case reported: a yard full of stone, so logs could not be carried in
    // at all, so the houses waiting for those logs never got them. The pile
    // sat, the sites waited, and nothing moved again.
    //
    // The *decision* is asserted rather than the delivery, because a running
    // settlement eats out of its yard and frees the space back up within the
    // day — which is the system healing itself, not the fallback working.
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'house');
    expect(site).not.toBeNull();
    fillYards(simulation);
    simulation.world.piles.drop(simulation.world.landfallCell, 'logs', 6);

    run(simulation, 2);

    const haul = simulation.jobs.all.find((job) => job.type === 'haul');
    expect(haul?.deliverTo).toEqual(site!.accessCell);
  });

  it('actually lands the load in the site', () => {
    // Placed beside the camp rather than wherever the map first allows: the
    // plain `place` helper starts scanning at the map corner, and a villager
    // walking there from the beach is measuring the map, not the fallback.
    const simulation = new Simulation(OPTIONS);
    const site = placeNear(simulation, 'house');
    simulation.world.piles.drop(simulation.world.landfallCell, 'logs', 6);

    // Kept full every tick, so the yard never frees up and the fallback is the
    // only route the timber has.
    let delivered = 0;
    for (let tick = 0; tick < TICKS_PER_DAY * 3; tick += 1) {
      fillYards(simulation);
      simulation.update(simulation.tick + 1, TICK);
      delivered = Math.max(delivered, site!.materials.count('logs'));
    }

    // The high-water mark rather than the final figure. The house now *finishes*
    // inside those three days — the settlers walk in with ten stone and their
    // bundles are on the ground where a site can take them — so its materials
    // inventory is empty again by the end, which is the load having landed rather
    // than not.
    expect(delivered).toBeGreaterThan(0);
  });

  it('posts the job at all, which a full settlement never used to', () => {
    const simulation = new Simulation(OPTIONS);
    place(simulation, 'house');
    fillYards(simulation);
    simulation.world.piles.drop(simulation.world.landfallCell, 'logs', 6);
    run(simulation, 2);

    expect(simulation.jobs.all.some((job) => job.type === 'haul')).toBe(true);
  });

  it('still prefers a yard while one has room', () => {
    // A fallback, not a preference. Routing every pile through construction
    // would starve the yards the settlement actually lives out of.
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'house');
    simulation.world.piles.drop(simulation.world.landfallCell, 'logs', 6);

    run(simulation, TICKS_PER_DAY * 2);

    expect(simulation.snapshot().stored.logs).toBeGreaterThan(0);
    expect(site!.materials.count('logs')).toBe(0);
  });

  it('leaves the pile alone when no site wants it either', () => {
    // A house has no use for herbs, so this really is a dead end rather than
    // something the fallback can rescue.
    const simulation = new Simulation(OPTIONS);
    place(simulation, 'house');
    // Stocked so the house is merely waiting rather than stalled, which would
    // otherwise be the more urgent thing to report.
    stock(simulation, 'stone', 20);
    fillYards(simulation);
    simulation.world.piles.drop(simulation.world.landfallCell, 'herbs', 4);

    expect(simulation.snapshot().advice).toBe('storageFull');
    expect(simulation.jobs.all.some((job) => job.type === 'haul')).toBe(false);
  });
});

describe('a pile with nowhere to go', () => {
  it('says so once the yards will not take any more', () => {
    // Nothing under construction wants logs either, so this really is a dead
    // end rather than something the site fallback can rescue.
    const simulation = new Simulation(OPTIONS);
    fillYards(simulation);
    simulation.world.piles.drop(simulation.world.landfallCell, 'logs', 4);

    expect(simulation.snapshot().advice).toBe('storageFull');
  });

  it('says nothing while there is still room', () => {
    const simulation = new Simulation(OPTIONS);
    simulation.world.piles.drop(simulation.world.landfallCell, 'logs', 4);

    expect(simulation.snapshot().advice).not.toBe('storageFull');
  });

  it('says nothing about an empty pile', () => {
    // The settlers' own bundles are on the ground at the start, so "there is no
    // pile" has to be arranged rather than assumed.
    const simulation = new Simulation(OPTIONS);
    emptyHanded(simulation);
    fillYards(simulation);

    expect(simulation.snapshot().advice).not.toBe('storageFull');
  });
});

function run(simulation: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.update(simulation.tick + 1, TICK);
  }
}

/** Runs to the first day of autumn, which is when shelter starts mattering. */
function toAutumn(simulation: Simulation): void {
  const limit = TICKS_PER_DAY * 48;
  for (let tick = 0; tick < limit && simulation.year.season !== 'autumn'; tick += 1) {
    if (simulation.tick % TICKS_PER_DAY === 0) {
      const yard = simulation.storages.all[0];
      if (yard) {
        yard.inventory.add('food', Math.max(0, 200 - yard.inventory.count('food')));
        simulation.storages.markChanged();
      }
    }
    simulation.update(simulation.tick + 1, TICK);
  }
}

/**
 * A settlement with nothing at all: empty shelves and bare ground.
 *
 * Both halves matter since the settlers began setting their bundles down where
 * they stop and a site began taking materials from whichever is nearer. "Nobody
 * has any stone" used to be true of a new settlement by default; now it has to be
 * arranged.
 */
function emptyHanded(simulation: Simulation): void {
  for (const storage of simulation.storages.all) {
    storage.inventory.clear();
  }
  simulation.storages.markChanged();
  for (const pile of [...simulation.world.piles.all]) {
    simulation.world.piles.remove(pile.id);
  }
}

/** Fills every yard to the brim, which is the state that used to be a dead end. */
function fillYards(simulation: Simulation): void {
  for (const storage of simulation.storages.all) {
    storage.inventory.add('logs', storage.inventory.freeSpace);
  }
  simulation.storages.markChanged();
}

function stock(simulation: Simulation, resource: 'logs' | 'stone', amount: number): void {
  simulation.storages.all[0]!.inventory.add(resource, amount);
  simulation.storages.markChanged();
}

/** Places a building as close to the landfall camp as the ground allows. */
function placeNear(simulation: Simulation, id: BuildingId): Building | null {
  const from = simulation.world.landfallCell;
  for (let radius = 2; radius < 20; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const cell = { gx: from.gx + dx, gy: from.gy + dy };
        if (cell.gx > 0 && cell.gy > 0 && simulation.canPlaceBuilding(id, cell).ok) {
          return simulation.placeBuilding(id, cell);
        }
      }
    }
  }
  return null;
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
