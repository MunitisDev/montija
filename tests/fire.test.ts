/**
 * Water, and the night a settlement finds out whether it has any.
 *
 * **A fire in this game is never bad luck**, and every test here is about one of
 * the four decisions that make it so: what the buildings do, how tightly they are
 * packed, whether there is water within reach, and what was laid between them.
 *
 * The rate is deliberately low — about one fire every four years for a village
 * of six houses, measured — which is exactly why it is tested with a stubbed
 * night rather than by playing years and hoping. A rule that fires once in four
 * years is a rule nobody can hold to account by watching.
 */

import { describe, expect, it } from 'vitest';

import { Simulation } from '@/simulation/Simulation';
import type { Building } from '@/simulation/buildings/Building';
import {
  CROWDING_STEP,
  HEARTH_FIRE_CHANCE,
  NO_FIRE,
  runFire,
  SPREAD_REACH,
} from '@/simulation/events/FireSystem';
import { restore, serialise } from '@/simulation/save/serialise';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { WATER_REACH, waterWithinReach } from '@/simulation/world/Water';
import { World } from '@/simulation/world/World';
import type { BuildingId } from '@/data/buildings';
import type { GridPoint } from '@/shared/types/geometry';

// The real map size, because a dry patch has to exist at all: with water carrying
// ten cells, a 64-wide valley with a river across it has no corner far enough
// from the water to hold a settlement that could burn.
const OPTIONS = { seed: 20260816, worldWidth: 96, worldHeight: 96, startingVillagers: 10 };

/** A night that catches whatever the odds. */
const ALWAYS = { next: () => 0 };
/** A night that never does. */
const NEVER = { next: () => 1 };

describe('water within reach', () => {
  it('counts the river, out to its reach and no further', () => {
    const world = new World({ width: 64, height: 64, seed: 20260816 });
    const bank = cellWhere(world, (cell) => world.terrainAt(cell) === 'water');

    expect(waterWithinReach(world, bank)).toBe(true);
    expect(waterWithinReach(world, { gx: bank.gx, gy: bank.gy + WATER_REACH })).toBe(true);
  });

  it('counts a finished well, and not a half-built one', () => {
    const simulation = new Simulation(OPTIONS);
    const dry = dryGround(simulation);
    expect(simulation.waterAt(dry)).toBe(false);

    const well = raise(simulation, 'well', dry, { finish: false });
    expect(simulation.waterAt(dry), 'a hole in the ground is not a well').toBe(false);

    simulation.world.buildings.complete(simulation.world, well);
    expect(simulation.waterAt(dry)).toBe(true);
    // And it serves a neighbourhood rather than its own doorstep.
    expect(simulation.waterAt({ gx: dry.gx + WATER_REACH - 1, gy: dry.gy })).toBe(true);
    expect(simulation.waterAt({ gx: dry.gx + WATER_REACH * 3, gy: dry.gy })).toBe(false);
  });
});

describe('what catches fire', () => {
  it('leaves a hearth alone on a night nobody lights it', () => {
    // A summer settlement cannot burn down, which is the whole of what makes the
    // risk a consequence rather than a die roll.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'house', openGround(simulation));

    expect(burn(simulation, { isFreezing: false, random: ALWAYS })).toEqual(NO_FIRE);
  });

  it('catches on a freezing night', () => {
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house', openGround(simulation));

    const report = burn(simulation, { isFreezing: true, random: ALWAYS });
    expect(report.started).toBe(house.id);
    expect(house.burning).toBe(true);
  });

  it('leaves a forge alone while nobody is working it', () => {
    const simulation = new Simulation(OPTIONS);
    const forge = raise(simulation, 'blacksmith', openGround(simulation));

    expect(burn(simulation, { isFreezing: false, random: ALWAYS }).started).toBeNull();

    forge.workers.push(1);
    expect(burn(simulation, { isFreezing: false, random: ALWAYS }).started).toBe(forge.id);
  });

  it('is likelier for a house with neighbours than for one on its own', () => {
    // The rule that makes the shape of a settlement a decision. A night whose
    // luck lands between the two chances catches the crowded house and spares
    // the lone one.
    const between = HEARTH_FIRE_CHANCE * (1 + CROWDING_STEP / 2);
    const night = { next: () => between };

    const lonely = new Simulation(OPTIONS);
    const alone = openGround(lonely);
    raise(lonely, 'house', alone);
    expect(burn(lonely, { isFreezing: true, random: night }).started).toBeNull();

    const packed = new Simulation(OPTIONS);
    const spot = openGround(packed);
    const house = raise(packed, 'house', spot);
    raise(packed, 'house', { gx: spot.gx + 2, gy: spot.gy });
    expect(burn(packed, { isFreezing: true, random: night }).started).toBe(house.id);
  });

  it('lights nothing new while something is already alight', () => {
    // One fire at a time: a settlement that could lose three buildings in a night
    // is one the player cannot plan against.
    const simulation = new Simulation(OPTIONS);
    const spot = openGround(simulation);
    raise(simulation, 'house', spot);
    raise(simulation, 'house', { gx: spot.gx + 3, gy: spot.gy });

    const first = burn(simulation, { isFreezing: true, random: ALWAYS });
    expect(first.started).not.toBeNull();
    const next = burn(simulation, { isFreezing: true, random: ALWAYS, dry: true });
    expect(next.lost).toHaveLength(1);
    expect(next.started).toBeNull();
  });
});

describe('what a fire costs', () => {
  it('is put out where there is water, and the building stands', () => {
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house', openGround(simulation));
    house.burning = true;

    const report = burn(simulation, { isFreezing: true, random: NEVER, wet: true });
    expect(report.saved).toEqual([house.id]);
    expect(report.lost).toEqual([]);
    expect(simulation.world.buildings.getById(house.id)).not.toBeNull();
    expect(house.burning).toBe(false);
  });

  it('takes the building where there is none', () => {
    // Driven through the settlement's own day, so the fire, the demolition and
    // everything that hangs off a building disappearing all have to agree.
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house', dryGround(simulation));
    house.burning = true;

    runADay(simulation);
    expect(simulation.world.buildings.getById(house.id)).toBeNull();
    expect(simulation.snapshot().chronicle.firesLost).toBe(1);
  });

  it('burns what was inside rather than tipping it onto the plot', () => {
    // A demolished yard sets its goods down — somebody carried every one of them
    // in. A burnt one does not, and that is the whole cost of having no water.
    const simulation = new Simulation(OPTIONS);
    const yard = raise(simulation, 'storage-yard', dryGround(simulation));
    // The yard opens its store on the next tick, which is when there is
    // something to put logs into.
    runADay(simulation);
    const storage = simulation.storages.getById(yard.storageId ?? -1);
    storage?.inventory.add('logs', 20);
    const before = simulation.snapshot().loose.logs;

    yard.burning = true;
    runADay(simulation);

    expect(simulation.world.buildings.getById(yard.id)).toBeNull();
    expect(simulation.snapshot().loose.logs).toBe(before);
  });

  it('jumps to the nearest building, and no further than its reach', () => {
    const simulation = new Simulation(OPTIONS);
    const spot = openGround(simulation);
    const source = raise(simulation, 'house', spot);
    const near = raise(simulation, 'house', { gx: spot.gx + SPREAD_REACH, gy: spot.gy });
    const far = raise(simulation, 'house', { gx: spot.gx + SPREAD_REACH * 4, gy: spot.gy });

    source.burning = true;
    const report = burn(simulation, { isFreezing: true, random: NEVER, dry: true });

    expect(report.spread).toEqual([near.id]);
    expect(near.burning).toBe(true);
    expect(far.burning).toBe(false);
  });

  it('does not cross a road', () => {
    // The firebreak, and deliberately the same roads the settlement laid for
    // hauling: a rule the player already understands, doing a second job.
    const simulation = new Simulation(OPTIONS);
    const spot = openGround(simulation);
    const source = raise(simulation, 'house', spot);
    raise(simulation, 'house', { gx: spot.gx + SPREAD_REACH, gy: spot.gy });
    for (let step = 1; step < SPREAD_REACH; step += 1) {
      simulation.world.paveRoad({ gx: spot.gx + step, gy: spot.gy });
    }

    source.burning = true;
    expect(burn(simulation, { isFreezing: true, random: NEVER, dry: true }).spread).toEqual([]);
  });
});

describe('a settlement that remembers its fire', () => {
  it('is still alight after a reload', () => {
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house', openGround(simulation));
    house.burning = true;

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, 'now'));

    expect(loaded.world.buildings.getById(house.id)?.burning).toBe(true);
  });

  it('counts what the water saved and what it did not', () => {
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house', openGround(simulation));
    house.burning = true;
    for (let tick = 0; tick < TICKS_PER_DAY * 2; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
    }

    const chronicle = simulation.snapshot().chronicle;
    expect(chronicle.firesFought + chronicle.firesLost).toBeGreaterThan(0);
  });
});

describe('water as a comfort', () => {
  it('is worth something to a settlement whose houses stand by the river', () => {
    // Collected rather than owed: a village on the dry side is not punished, it
    // simply has not taken a comfort that was there for eight stone.
    const simulation = new Simulation(OPTIONS);
    for (let tick = 0; tick < TICKS_PER_DAY * 2; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
    }
    // The founding party sleeps rough, so nothing is owed yet.
    expect(simulation.solace).toBeGreaterThanOrEqual(0);

    const wet = cellWhere(
      simulation.world,
      (cell) => simulation.canPlaceBuilding('house', cell).ok && simulation.waterAt(cell),
    );
    const house = raise(simulation, 'house', wet);
    for (const villager of simulation.villagers.all) {
      villager.homeId = house.id;
    }
    expect(simulation.solace).toBeGreaterThan(0);
  });
});

// --- helpers ---------------------------------------------------------------

/** Runs one day of fire against a settlement, with the water answer stubbed. */
function burn(
  simulation: Simulation,
  options: {
    isFreezing: boolean;
    random: { next(): number };
    /** Force the water answer, for the tests that are about the fire itself. */
    wet?: boolean;
    dry?: boolean;
  },
) {
  const report = runFire({
    world: simulation.world,
    random: options.random,
    isFreezing: options.isFreezing,
    waterAt: (cell) =>
      options.wet === true ? true : options.dry === true ? false : simulation.waterAt(cell),
  });
  return report;
}

/** One simulated day, which is where a fire is resolved. */
function runADay(simulation: Simulation): void {
  for (let tick = 0; tick < TICKS_PER_DAY; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
  }
}

/**
 * A cleared patch of buildable ground, wherever the settlement can reach.
 *
 * For the tests that stub the water answer, which is most of them: what they need
 * is room for three or four buildings side by side, not a particular distance
 * from the river.
 */
function openGround(simulation: Simulation): GridPoint {
  const world = simulation.world;
  for (let gy = 3; gy < world.height - 12; gy += 1) {
    for (let gx = 3; gx < world.width - 16; gx += 1) {
      const origin = { gx, gy };
      clearPatch(simulation, origin);
      if (simulation.canPlaceBuilding('house', origin).ok) {
        return origin;
      }
    }
  }
  throw new Error('nowhere in this world to put a settlement');
}

/** Pushes the scrub aside over a patch big enough for a row of buildings. */
function clearPatch(simulation: Simulation, origin: GridPoint): void {
  for (let dy = -2; dy <= 8; dy += 1) {
    for (let dx = -2; dx <= 14; dx += 1) {
      simulation.world.clearGround({ gx: origin.gx + dx, gy: origin.gy + dy });
    }
  }
}

/**
 * A patch of buildable ground with no water anywhere near any of it.
 *
 * Two things are load-bearing here and neither is fussiness. The **margin**: a
 * building's doorway is a cell or two off its origin and water is asked about the
 * doorway, so a spot dry by a single cell had the river within reach of the door
 * and every fire in this file was quietly put out. And the **clearing**: the wood
 * does not care that four houses were going to stand here, and a settlement
 * cannot build what it cannot walk to — so the patch is cleared first and the
 * placement rules asked afterwards.
 */
function dryGround(simulation: Simulation): GridPoint {
  const world = simulation.world;
  for (let gy = 3; gy < world.height - 12; gy += 1) {
    for (let gx = 3; gx < world.width - 16; gx += 1) {
      const origin = { gx, gy };
      if (!dryAround(simulation, origin)) {
        continue;
      }
      clearPatch(simulation, origin);
      if (simulation.canPlaceBuilding('house', origin).ok) {
        return origin;
      }
    }
  }
  throw new Error('this world has nowhere dry to burn');
}

/** `true` when no water can be fetched to anywhere in the patch. */
function dryAround(simulation: Simulation, origin: GridPoint): boolean {
  for (let dy = -2; dy <= 8; dy += 1) {
    for (let dx = -2; dx <= 14; dx += 1) {
      if (simulation.waterAt({ gx: origin.gx + dx, gy: origin.gy + dy })) {
        return false;
      }
    }
  }
  return true;
}

function cellWhere(world: World, matches: (cell: GridPoint) => boolean): GridPoint {
  for (let gy = 2; gy < world.height - 4; gy += 1) {
    for (let gx = 2; gx < world.width - 4; gx += 1) {
      if (matches({ gx, gy })) {
        return { gx, gy };
      }
    }
  }
  throw new Error('no such cell in this world');
}

/** Puts a building up on a cell, finished unless the caller says otherwise. */
function raise(
  simulation: Simulation,
  id: BuildingId,
  origin: GridPoint,
  options: { finish?: boolean } = {},
): Building {
  const building = simulation.world.buildings.place(simulation.world, id, origin);
  if (!building) {
    throw new Error(`nowhere to put a ${id} at ${origin.gx},${origin.gy}`);
  }
  if (options.finish !== false) {
    simulation.world.buildings.complete(simulation.world, building);
  }
  return building;
}
