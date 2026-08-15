import { describe, expect, it } from 'vitest';
import {
  DAYS_PER_SEASON,
  FREEZING_POINT,
  SEASONS,
  TICKS_PER_DAY,
  TICKS_PER_SEASON,
  TICKS_PER_YEAR,
  isDayBoundary,
  yearStateAt,
} from '@/simulation/seasons/SeasonClock';
import { runDay } from '@/simulation/seasons/SurvivalSystem';
import { StorageRegistry } from '@/simulation/logistics/Storage';
import { Villager } from '@/simulation/villagers/Villager';
import { Simulation } from '@/simulation/Simulation';

const TICK = 0.1;
const OPTIONS = { seed: 20260815, worldWidth: 32, worldHeight: 32, startingVillagers: 10 };

describe('the year', () => {
  it('starts in spring', () => {
    expect(yearStateAt(0).season).toBe('spring');
    expect(yearStateAt(0).year).toBe(1);
  });

  it('runs through all four seasons in order', () => {
    const seen = SEASONS.map((_, index) => yearStateAt(index * TICKS_PER_SEASON).season);
    expect(seen).toEqual([...SEASONS]);
  });

  it('wraps to a new year', () => {
    expect(yearStateAt(TICKS_PER_YEAR).season).toBe('spring');
    expect(yearStateAt(TICKS_PER_YEAR).year).toBe(2);
  });

  it('counts days within a season', () => {
    expect(yearStateAt(0).dayOfSeason).toBe(1);
    expect(yearStateAt(TICKS_PER_DAY).dayOfSeason).toBe(2);
    expect(yearStateAt(TICKS_PER_SEASON - 1).dayOfSeason).toBe(DAYS_PER_SEASON);
  });

  it('makes winter freezing and summer not', () => {
    const winter = yearStateAt(TICKS_PER_SEASON * 3 + 10);
    const summer = yearStateAt(TICKS_PER_SEASON * 1 + 10);

    expect(winter.temperature).toBeLessThan(FREEZING_POINT);
    expect(winter.isFreezing).toBe(true);
    expect(summer.isFreezing).toBe(false);
  });

  it('cools gradually through autumn rather than in a step', () => {
    const early = yearStateAt(TICKS_PER_SEASON * 2 + 10).temperature;
    const late = yearStateAt(TICKS_PER_SEASON * 3 - 10).temperature;

    expect(late).toBeLessThan(early);
  });

  it('marks day boundaries', () => {
    expect(isDayBoundary(TICKS_PER_DAY)).toBe(true);
    expect(isDayBoundary(TICKS_PER_DAY + 1)).toBe(false);
  });
});

describe('daily survival', () => {
  /**
   * Villagers with a roof over their heads.
   *
   * Housed on purpose: firewood warms a *house*, so a test about burning wood
   * needs somewhere to burn it. Sleeping rough is covered separately below.
   */
  function makeVillagers(count: number, homeId: number | null = 1): Villager[] {
    return Array.from({ length: count }, (_, i) => {
      const villager = new Villager({
        id: i + 1,
        name: `V${i}`,
        age: 30,
        position: { wx: 0.5, wy: 0.5 },
        lifespan: 70,
      });
      villager.homeId = homeId;
      return villager;
    });
  }

  /**
   * A yard sized to hold everything asked for.
   *
   * Capacity is shared across resources, so a yard stocked to the brim with
   * food has no room left for firewood — which is a real constraint, not a
   * test detail, and is what a settlement has to plan around.
   */
  function stockedStorage(food: number, firewood: number): StorageRegistry {
    const storages = new StorageRegistry();
    const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: food + firewood + 100 });
    expect(yard.inventory.add('food', food)).toBe(food);
    expect(yard.inventory.add('firewood', firewood)).toBe(firewood);
    return storages;
  }

  const summer = yearStateAt(TICKS_PER_SEASON + 10);
  const winter = yearStateAt(TICKS_PER_SEASON * 3 + 10);

  it('eats one meal per villager per day', () => {
    const villagers = makeVillagers(5);
    const storages = stockedStorage(50, 50);

    const { report } = runDay(villagers, storages, summer);

    expect(report.foodEaten).toBe(5);
    expect(storages.totalOf('food')).toBe(45);
  });

  it('burns no firewood when it is not freezing', () => {
    const storages = stockedStorage(50, 50);
    const { report } = runDay(makeVillagers(5), storages, summer);

    expect(report.firewoodBurned).toBe(0);
  });

  it('burns firewood in winter', () => {
    const storages = stockedStorage(50, 50);
    const { report } = runDay(makeVillagers(5), storages, winter);

    expect(report.firewoodBurned).toBe(5);
  });

  it('reports a shortfall when the stores run dry', () => {
    const storages = stockedStorage(2, 0);
    const { report } = runDay(makeVillagers(5), storages, winter);

    expect(report.foodShortfall).toBe(3);
    expect(report.firewoodShortfall).toBe(5);
  });

  it('starves people who cannot be fed', () => {
    const villagers = makeVillagers(3);
    const storages = stockedStorage(0, 0);

    runDay(villagers, storages, summer);

    expect(villagers[0]!.needs.hunger).toBeLessThan(100);
  });

  it('kills an unfed settlement eventually', () => {
    const villagers = makeVillagers(3);
    const storages = stockedStorage(0, 0);
    let dead = 0;

    for (let day = 0; day < 60 && dead === 0; day += 1) {
      dead = runDay(villagers, storages, winter).dead.length;
    }

    expect(dead).toBeGreaterThan(0);
  });

  it('keeps a well-supplied settlement healthy indefinitely', () => {
    const villagers = makeVillagers(4);
    const storages = stockedStorage(10_000, 10_000);

    for (let day = 0; day < 200; day += 1) {
      const { dead } = runDay(villagers, storages, winter);
      expect(dead).toHaveLength(0);
    }

    expect(villagers[0]!.needs.health).toBe(100);
  });

  it('shares short rations rather than starving some and feeding others', () => {
    const villagers = makeVillagers(4);
    // Half the food the settlement needs.
    const storages = stockedStorage(2, 100);

    runDay(villagers, storages, summer);

    const hungers = villagers.map((villager) => villager.needs.hunger);
    expect(new Set(hungers).size).toBe(1);
  });

  it('does nothing when nobody is left', () => {
    const { report } = runDay([], stockedStorage(10, 10), winter);
    expect(report.deaths).toBe(0);
  });
});

describe('shelter', () => {
  const summer = yearStateAt(TICKS_PER_SEASON + 10);
  const winter = yearStateAt(TICKS_PER_SEASON * 3 + 10);

  function housed(count: number, homeId: number | null) {
    return Array.from({ length: count }, (_, i) => {
      const villager = new Villager({
        id: i + 1,
        name: `V${i}`,
        age: 30,
        position: { wx: 0.5, wy: 0.5 },
        lifespan: 70,
      });
      villager.homeId = homeId;
      return villager;
    });
  }

  function stocked() {
    const storages = new StorageRegistry();
    const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 });
    yard.inventory.add('food', 200);
    yard.inventory.add('firewood', 200);
    return storages;
  }

  it('burns no firewood for villagers with nowhere to burn it', () => {
    const { report } = runDay(housed(5, null), stocked(), winter);
    expect(report.firewoodBurned).toBe(0);
    expect(report.sleepingRough).toBe(5);
  });

  it('leaves the unhoused colder than the housed, on the same woodpile', () => {
    const outside = housed(5, null);
    const inside = housed(5, 1);

    runDay(outside, stocked(), winter);
    runDay(inside, stocked(), winter);

    expect(outside[0]!.needs.warmth).toBeLessThan(inside[0]!.needs.warmth);
  });

  it('does not punish homelessness in mild weather', () => {
    // A missing roof is a winter problem. Being outdoors in summer is fine.
    const outside = housed(5, null);
    const { report } = runDay(outside, stocked(), summer);
    expect(report.sleepingRough).toBe(0);
    expect(outside[0]!.needs.warmth).toBe(100);
  });
});

describe('winter in the running simulation', () => {
  it('kills an unprepared settlement', () => {
    const simulation = new Simulation(OPTIONS);
    // No food, no firewood, no workshops: the settlement has not prepared.

    for (let tick = 1; tick <= TICKS_PER_YEAR && !simulation.hasFailed; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.snapshot().deaths).toBeGreaterThan(0);
  });

  /**
   * Gives everyone a roof, without making the test build them one plank at a
   * time. Houses are the point of a separate test; here they are a precondition.
   */
  function shelterEveryone(simulation: Simulation): void {
    let housed = 0;
    for (let radius = 3; radius < 14 && housed < simulation.villagers.count; radius += 1) {
      for (let dy = -radius; dy <= radius && housed < simulation.villagers.count; dy += 1) {
        for (let dx = -radius; dx <= radius && housed < simulation.villagers.count; dx += 1) {
          const cell = {
            gx: simulation.world.centreCell.gx + dx,
            gy: simulation.world.centreCell.gy + dy,
          };
          if (!simulation.canPlaceBuilding('house', cell).ok) {
            continue;
          }
          const house = simulation.placeBuilding('house', cell);
          if (house) {
            simulation.world.buildings.complete(simulation.world, house);
            housed += house.definition.housing ?? 0;
          }
        }
      }
    }
    expect(housed).toBeGreaterThanOrEqual(simulation.villagers.count);
  }

  it('a settlement stocked and housed survives the same winter', () => {
    const simulation = new Simulation(OPTIONS);
    shelterEveryone(simulation);
    const yard = simulation.storages.all[0]!;
    // Firewood keeps anywhere; food does not, so it goes somewhere built for
    // it. The founding yard holds 2000 units shared across resources, so stock
    // deliberately rather than filling it with one and starving the settlement
    // of the other.
    expect(yard.inventory.add('firewood', 600)).toBe(600);
    const larder = simulation.storages.add({
      cell: { gx: yard.cell.gx + 2, gy: yard.cell.gy },
      capacity: 800,
      accepts: ['food'],
      preservation: 0.1,
    });
    expect(larder.inventory.add('food', 600)).toBe(600);
    simulation.storages.markChanged();

    for (let tick = 1; tick <= TICKS_PER_YEAR; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.snapshot().deaths).toBe(0);
    // Fed, housed and warm, a settlement does not merely endure the year — it
    // grows. Nobody was lost, and the population is no smaller than it started.
    expect(simulation.snapshot().villagerCount).toBeGreaterThanOrEqual(10);
  });

  it('freezes a settlement that stocked everything but built no houses', () => {
    // Supplies are not enough. Firewood warms a house, and a settlement with
    // nowhere to burn it spends winter outdoors however full its yards are.
    const simulation = new Simulation(OPTIONS);
    const yard = simulation.storages.all[0]!;
    yard.inventory.add('firewood', 600);
    const larder = simulation.storages.add({
      cell: { gx: yard.cell.gx + 2, gy: yard.cell.gy },
      capacity: 800,
      accepts: ['food'],
      preservation: 0.1,
    });
    larder.inventory.add('food', 600);
    simulation.storages.markChanged();

    for (let tick = 1; tick <= TICKS_PER_YEAR && !simulation.hasFailed; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.snapshot().deaths).toBeGreaterThan(0);
  });

  it('the same stock left in an open yard rots away instead', () => {
    // The larder is not decoration: food heaped in a general yard will not last
    // a year, however much of it there is.
    const simulation = new Simulation(OPTIONS);
    const yard = simulation.storages.all[0]!;
    yard.inventory.add('food', 600);
    yard.inventory.add('firewood', 600);
    simulation.storages.markChanged();

    for (let tick = 1; tick <= TICKS_PER_YEAR && !simulation.hasFailed; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.snapshot().deaths).toBeGreaterThan(0);
  });

  it('reports the calendar in its snapshot', () => {
    const simulation = new Simulation(OPTIONS);
    const snapshot = simulation.snapshot();

    expect(snapshot.season).toBe('spring');
    expect(snapshot.year).toBe(1);
    expect(typeof snapshot.temperature).toBe('number');
  });
});
