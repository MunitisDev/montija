/**
 * The one improvement a building can be given.
 *
 * **A settlement's spare stone and iron had nowhere to go but more buildings**,
 * and the most useful thing to spend them on is a house that is warmer for ever
 * afterwards. What makes it worth having in a game about hauling is that it is
 * *built*: the stone and the iron are carried there by hand and somebody spends
 * a day on the roof, exactly like everything else.
 *
 * The implementation is deliberately not a second kind of work. The house drops
 * back into `underConstruction` for the duration and borrows the whole of the
 * construction machinery, which is why most of what is tested here is the
 * *seams*: that it owes the upgrade's cost rather than its own, that the family
 * is not turned out into the snow while the masons work, and that finishing it
 * is not mistaken for a building being raised.
 */

import { describe, expect, it } from 'vitest';

import { buildingDefinition } from '@/data/buildings';
import { Simulation } from '@/simulation/Simulation';
import type { Building } from '@/simulation/buildings/Building';
import { restore, serialise } from '@/simulation/save/serialise';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { FIREWOOD_PER_VILLAGER_PER_COLD_DAY, runDay } from '@/simulation/seasons/SurvivalSystem';
import { StorageRegistry } from '@/simulation/logistics/Storage';
import type { BuildingId } from '@/data/buildings';
import type { GridPoint } from '@/shared/types/geometry';
import type { Villager } from '@/simulation/villagers/Villager';

const OPTIONS = { seed: 20260816, worldWidth: 96, worldHeight: 96, startingVillagers: 10 };

describe('ordering an improvement', () => {
  it('is offered on a finished house and nowhere else', () => {
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house');

    expect(simulation.orderUpgrade(house.id)).toBe(true);
    expect(house.upgrading).toBe(true);
    // A house being improved is a site again, which is how it borrows every
    // rule about hauling materials and spending labour.
    expect(house.isComplete).toBe(false);
  });

  it('is refused on a building that has none in its data', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    expect(buildingDefinition('gatherer-hut').upgrade).toBeUndefined();
    expect(simulation.orderUpgrade(hut.id)).toBe(false);
  });

  it('is refused on a house that is still going up', () => {
    const simulation = new Simulation(OPTIONS);
    const site = raise(simulation, 'house', { finish: false });
    expect(simulation.orderUpgrade(site.id)).toBe(false);
  });

  it('is refused twice over', () => {
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house');
    house.improved = true;
    expect(simulation.orderUpgrade(house.id)).toBe(false);
  });
});

describe('what an improvement owes', () => {
  it('is its own cost, not the cost of the house again', () => {
    // The whole of the delivery machinery asks `requiredMaterials`, so getting
    // this wrong would have a stone hearth demanding eight logs.
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house');
    simulation.orderUpgrade(house.id);

    const upgrade = buildingDefinition('house').upgrade!;
    expect(house.requiredMaterials()).toEqual(upgrade.cost);
    expect(house.stillNeeds('stone')).toBe(6);
    expect(house.stillNeeds('iron')).toBe(2);
    expect(house.stillNeeds('logs')).toBe(0);
    expect(house.hasAllMaterials).toBe(false);
  });

  it('leaves the family living there while the masons work', () => {
    // Putting a household into the snow to give them a warmer hearth would be a
    // bitter joke, and the state says `underConstruction` — so the housing rule
    // has to know better.
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house');
    runDays(simulation, 2);
    const residents = simulation.villagers.all.filter(
      (villager) => villager.homeId === house.id,
    ).length;
    expect(residents).toBeGreaterThan(0);

    simulation.orderUpgrade(house.id);
    runDays(simulation, 2);

    expect(simulation.villagers.all.filter((villager) => villager.homeId === house.id).length).toBe(
      residents,
    );
  });
});

describe('an improvement being built', () => {
  it('is carried there, built, and leaves a warmer house standing', () => {
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house');
    stock(simulation, 'stone', 40);
    stock(simulation, 'iron', 20);

    const ironBefore = simulation.snapshot().stored.iron;
    simulation.orderUpgrade(house.id);
    runDays(simulation, 12);

    expect(house.improved).toBe(true);
    expect(house.upgrading).toBe(false);
    expect(house.isComplete).toBe(true);
    // And it cost what it said it would: the iron left the shelves and did not
    // come back.
    expect(simulation.snapshot().stored.iron).toBeLessThan(ironBefore);
  });

  it('is not counted as another building raised', () => {
    // The walls stood the whole time. A chronicle that counted a stone hearth as
    // a building would quietly inflate the one number a player uses to judge how
    // much they have actually built.
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house');
    stock(simulation, 'stone', 40);
    stock(simulation, 'iron', 20);
    const raisedBefore = simulation.snapshot().chronicle.buildingsRaised;

    simulation.orderUpgrade(house.id);
    runDays(simulation, 12);

    expect(house.improved).toBe(true);
    expect(simulation.snapshot().chronicle.buildingsRaised).toBe(raisedBefore);
  });

  it('gives back what had already been carried when it is cancelled', () => {
    // Somebody walked that stone here. It goes on the ground rather than
    // evaporating, which is the same rule a demolished yard follows.
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house');
    simulation.orderUpgrade(house.id);
    house.materials.add('stone', 4);

    expect(simulation.cancelUpgrade(house.id)).toBe(true);
    expect(house.upgrading).toBe(false);
    expect(house.isComplete).toBe(true);
    expect(simulation.snapshot().loose.stone).toBeGreaterThanOrEqual(4);
  });

  it('is still under way after a reload, and still improved after that', () => {
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house');
    simulation.orderUpgrade(house.id);

    const midway = new Simulation(OPTIONS);
    restore(midway, serialise(simulation, 'now'));
    expect(midway.world.buildings.getById(house.id)?.upgrading).toBe(true);

    house.upgrading = false;
    house.improved = true;
    house.state = 'complete';
    const after = new Simulation(OPTIONS);
    restore(after, serialise(simulation, 'now'));
    expect(after.world.buildings.getById(house.id)?.improved).toBe(true);
  });
});

describe('what a stone hearth is worth', () => {
  it('burns markedly less firewood on a freezing night', () => {
    // The seam that carries the whole feature: the survival system is handed the
    // night's draw rather than working it out, because how a house is *built* is
    // not its business.
    const upgrade = buildingDefinition('house').upgrade!;
    expect(upgrade.firewoodFactor).toBeLessThan(1);

    const plain = burnANight(4 * FIREWOOD_PER_VILLAGER_PER_COLD_DAY);
    const warm = burnANight(4 * FIREWOOD_PER_VILLAGER_PER_COLD_DAY * upgrade.firewoodFactor);

    // A third off, near enough: the stores hold whole logs, so a fractional
    // night's draw is rounded down — which favours the settlement and is the
    // right way round for a rounding nobody can see.
    expect(warm).toBeLessThan(plain);
    expect(warm / plain).toBeLessThanOrEqual(upgrade.firewoodFactor);
  });
});

// --- helpers ---------------------------------------------------------------

/** A freezing night's firewood, for a given draw. */
function burnANight(draw: number): number {
  const storages = new StorageRegistry();
  storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 }).inventory.add('firewood', 200);
  const villagers = Array.from(
    { length: 4 },
    (_, index) =>
      ({
        id: index,
        homeId: 1,
        needs: { hunger: 100, warmth: 100, health: 100, spirit: 50 },
        age: 30,
        isIll: false,
      }) as unknown as Villager,
  );
  const { report } = runDay(
    villagers,
    storages,
    { season: 'winter', dayOfSeason: 1, year: 1, temperature: -5, isFreezing: true },
    0,
    undefined,
    draw,
  );
  return report.firewoodBurned;
}

function runDays(simulation: Simulation, days: number): void {
  for (let tick = 0; tick < TICKS_PER_DAY * days; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
  }
}

/** Puts goods on the settlement's shelves. */
function stock(simulation: Simulation, resource: 'stone' | 'iron', amount: number): void {
  const storage = simulation.storages.all[0];
  storage?.inventory.add(resource, amount);
  simulation.storages.markChanged();
}

/** Puts a building up near the camp, finished unless the caller says otherwise. */
function raise(
  simulation: Simulation,
  id: BuildingId,
  options: { finish?: boolean } = {},
): Building {
  const from = simulation.world.landfallCell;
  for (let radius = 2; radius < 24; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const origin: GridPoint = { gx: from.gx + dx, gy: from.gy + dy };
        const building = simulation.world.buildings.place(simulation.world, id, origin);
        if (!building) {
          continue;
        }
        if (options.finish !== false) {
          simulation.world.buildings.complete(simulation.world, building);
        }
        return building;
      }
    }
  }
  throw new Error(`nowhere to put a ${id}`);
}

/** Kept so the year's length is quoted from the clock rather than typed. */
export const YEAR = DAYS_PER_YEAR;
