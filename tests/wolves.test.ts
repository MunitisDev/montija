/**
 * The wood in winter, the fight with it, and the wall that answers both.
 *
 * **A pack is never bad luck**, and every test here is about one of the decisions
 * that make it so: what season it is, whether the settlement is past its founding
 * year, whether the harvest is lying in the open, whether the wall holds, and how
 * many people came out with tools in their hands.
 *
 * The arrival is rolled with a stubbed night throughout, and deliberately: at a
 * little over one pack a year, a rule tested by playing years and hoping is a rule
 * not tested at all. Everything after the arrival has no dice in it at all — see
 * `wildlife/Combat.ts` — so the fights below are exact rather than likely.
 */

import { describe, expect, it } from 'vitest';

import { Simulation } from '@/simulation/Simulation';
import {
  FIRST_WOLF_YEAR,
  PACK_APPETITE,
  PACK_MIN,
  WOLF_REACH,
} from '@/simulation/wildlife/WolfSystem';
import {
  ARMED_BLOW,
  BARE_BLOW,
  VILLAGER_VIGOUR,
  WOLF_BITE,
  WOLF_VIGOUR,
  WOUND_HEALING_PER_DAY,
  armedCount,
  exchangeBlows,
} from '@/simulation/wildlife/Combat';
import { Wolf } from '@/simulation/wildlife/Wolf';
import {
  type FenceKind,
  LOGS_PER_FENCE,
  LOGS_PER_GATE,
  STONE_PER_GATE,
  STONE_PER_WALL,
  TIMBER_STRENGTH,
} from '@/simulation/world/FenceGrid';
import { restore, serialise } from '@/simulation/save/serialise';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { WORKING_AGE, RETIREMENT_AGE } from '@/data/population';
import type { GridPoint } from '@/shared/types/geometry';
import { Villager } from '@/simulation/villagers/Villager';
import type { World } from '@/simulation/world/World';

const OPTIONS = { seed: 20260824, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

/** A night the pack comes down. */
const ALWAYS = { next: () => 0 };

/** Rolls for a raid, with the season and year the caller wants. */
function raid(
  simulation: Simulation,
  options: {
    season?: 'spring' | 'summer' | 'autumn' | 'winter';
    year?: number;
    random?: { next(): number };
  } = {},
): boolean {
  return simulation.wolves.considerRaid({
    world: simulation.world,
    random: options.random ?? ALWAYS,
    season: options.season ?? 'winter',
    year: options.year ?? FIRST_WOLF_YEAR,
  });
}

/** One tick of the pack, without the rest of the simulation. */
function packTick(simulation: Simulation) {
  return simulation.wolves.update({
    world: simulation.world,
    villagers: simulation.villagers.all,
    tickSeconds: 0.1,
  });
}

describe('when a pack comes down', () => {
  it('never in the growing half of the year', () => {
    // The wood is feeding them. A settlement's spring and summer are its own
    // business, which is also what keeps the threat pointed at the season the
    // game is about.
    const simulation = new Simulation(OPTIONS);
    expect(raid(simulation, { season: 'spring' })).toBe(false);
    expect(raid(simulation, { season: 'summer' })).toBe(false);
    expect(simulation.wolves.count).toBe(0);
  });

  it('never in the settlement first year', () => {
    // Stated as a rule rather than hidden in a number: the first winter is this
    // game's whole objective and every figure in it was measured without wolves.
    const simulation = new Simulation(OPTIONS);
    expect(raid(simulation, { year: FIRST_WOLF_YEAR - 1 })).toBe(false);
    expect(raid(simulation, { year: FIRST_WOLF_YEAR })).toBe(true);
  });

  it('does not touch the settlement own random stream in a quiet season', () => {
    // No draw at all in spring, which is what makes every measurement taken
    // before wolves existed still describe those settlements exactly.
    const simulation = new Simulation(OPTIONS);
    let draws = 0;
    raid(simulation, {
      season: 'summer',
      random: {
        next: () => {
          draws += 1;
          return 0;
        },
      },
    });
    expect(draws).toBe(0);
  });

  it('brings several of them, out of the trees', () => {
    const simulation = new Simulation(OPTIONS);
    expect(raid(simulation)).toBe(true);

    expect(simulation.wolves.count).toBeGreaterThanOrEqual(PACK_MIN);
    for (const wolf of simulation.wolves.all) {
      // Out of cover, which is the only place they come from.
      expect(treesNear(simulation.world, wolf.cell)).toBe(true);
    }
  });

  it('brings one pack at a time', () => {
    const simulation = new Simulation(OPTIONS);
    raid(simulation);
    const arrived = simulation.wolves.count;

    expect(raid(simulation)).toBe(false);
    expect(simulation.wolves.count).toBe(arrived);
  });
});

describe('the alarm', () => {
  it('goes up the moment anybody sees them, and tells everybody', () => {
    // One villager seeing them tells the settlement, which is what a shout
    // across a valley actually does.
    const simulation = new Simulation(OPTIONS);
    raid(simulation);
    expect(simulation.wolves.isAlarmed).toBe(false);

    const wolf = simulation.wolves.all[0]!;
    simulation.villagers.all[0]!.position = { wx: wolf.position.wx, wy: wolf.position.wy };
    packTick(simulation);

    expect(simulation.wolves.isAlarmed).toBe(true);
  });

  it('sends the children and the old indoors, and everybody else out', () => {
    const simulation = new Simulation(OPTIONS);
    raid(simulation);
    const wolf = simulation.wolves.all[0]!;
    const child = simulation.villagers.all[0]!;
    const elder = simulation.villagers.all[1]!;
    const worker = simulation.villagers.all[2]!;
    child.age = WORKING_AGE - 4;
    elder.age = RETIREMENT_AGE + 5;
    worker.age = 30;
    worker.position = { wx: wolf.position.wx, wy: wolf.position.wy };
    packTick(simulation);

    expect(simulation.wolves.orderFor(child)).toBe('shelter');
    expect(simulation.wolves.orderFor(elder)).toBe('shelter');
    expect(simulation.wolves.orderFor(worker)).toBe('muster');
  });

  it('orders nobody about in peacetime', () => {
    const simulation = new Simulation(OPTIONS);
    expect(simulation.wolves.orderFor(simulation.villagers.all[0]!)).toBeNull();
  });

  it('is not raised by a settlement that is all indoors', () => {
    // The honest consequence of the rule: a village entirely under its roofs
    // never sees them, and loses whatever it left outside.
    const simulation = new Simulation(OPTIONS);
    raid(simulation);
    const wolf = simulation.wolves.all[0]!;
    for (const villager of simulation.villagers.all) {
      villager.activity = 'sheltering';
      villager.position = { wx: wolf.position.wx, wy: wolf.position.wy };
    }

    packTick(simulation);

    expect(simulation.wolves.isAlarmed).toBe(false);
  });
});

describe('what a pack takes', () => {
  it('the harvest, when it is lying in the open', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = besideTrees(simulation.world);
    simulation.world.piles.drop(cell, 'vegetables', 40);
    raid(simulation);
    // Nobody about to distract them, so they go for the heap.
    sendEverybodyFar(simulation);

    let taken = 0;
    for (let tick = 0; tick < 400 && taken === 0; tick += 1) {
      taken = packTick(simulation).stolen.reduce((total, take) => total + take.amount, 0);
    }

    expect(taken).toBeGreaterThan(0);
    expect(taken).toBeLessThanOrEqual(PACK_APPETITE);
  });

  it('nothing at all from a heap behind a wall', () => {
    // The whole point of the wall, and it is the firebreak rule doing a second
    // job: what lies between decides whether one thing reaches the other.
    const simulation = new Simulation(OPTIONS);
    const cell = besideTrees(simulation.world);
    simulation.world.piles.drop(cell, 'vegetables', 40);
    fenceAround(simulation.world, cell, 'stone-wall');
    sendEverybodyFar(simulation);

    // A pack will not even come for it: there is no cover with a line to it.
    raid(simulation);
    for (let tick = 0; tick < 200; tick += 1) {
      packTick(simulation);
    }

    expect(simulation.world.piles.totalOf('vegetables')).toBe(40);
  });

  it('stone never, however much of it is lying about', () => {
    const simulation = new Simulation(OPTIONS);
    simulation.world.piles.drop(besideTrees(simulation.world), 'stone', 30);
    sendEverybodyFar(simulation);
    raid(simulation);

    for (let tick = 0; tick < 200; tick += 1) {
      expect(packTick(simulation).stolen).toEqual([]);
    }
  });
});

describe('the fight', () => {
  it('is even between a wolf and somebody with a tool', () => {
    // **The rule the player asked for**: a wolf is worth a person. Nobody wins a
    // fair one-on-one, which is exactly why a settlement never sends one person.
    const villager = person({ age: 30 });
    const wolf = new Wolf(1, { gx: 0, gy: 0 }, WOLF_VIGOUR);

    let rounds = 0;
    let report = exchangeBlows([{ villager, wolf, armed: true }]);
    while (report.fallen.length === 0 && report.slain.length === 0 && rounds < 500) {
      report = exchangeBlows([{ villager, wolf, armed: true }]);
      rounds += 1;
    }

    expect(report.fallen).toEqual([villager.id]);
    expect(report.slain).toEqual([wolf.id]);
    expect(ARMED_BLOW).toBe(WOLF_BITE);
  });

  it('is lost by somebody with their bare hands', () => {
    const villager = person({ age: 30 });
    const wolf = new Wolf(1, { gx: 0, gy: 0 }, WOLF_VIGOUR);

    let report = exchangeBlows([{ villager, wolf, armed: false }]);
    for (let round = 0; round < 500 && report.fallen.length === 0; round += 1) {
      report = exchangeBlows([{ villager, wolf, armed: false }]);
    }

    expect(report.fallen).toEqual([villager.id]);
    expect(wolf.vigour).toBeGreaterThan(0);
    expect(BARE_BLOW).toBeLessThan(WOLF_BITE);
  });

  it('is won by two against one, whichever two', () => {
    // Both halves of the same claim, and the reason the numbers are equal.
    const oneVillager = person({ age: 30 });
    const twoWolves = [
      new Wolf(1, { gx: 0, gy: 0 }, WOLF_VIGOUR),
      new Wolf(2, { gx: 0, gy: 0 }, WOLF_VIGOUR),
    ];
    let mauled = exchangeBlows(
      twoWolves.map((wolf) => ({ villager: oneVillager, wolf, armed: true })),
    );
    for (let round = 0; round < 500 && mauled.fallen.length === 0; round += 1) {
      mauled = exchangeBlows(
        twoWolves.map((wolf) => ({ villager: oneVillager, wolf, armed: true })),
      );
    }
    expect(mauled.fallen).toEqual([oneVillager.id]);
    expect(mauled.slain).toEqual([]);

    const oneWolf = new Wolf(3, { gx: 0, gy: 0 }, WOLF_VIGOUR);
    const twoVillagers = [person({ id: 2, age: 30 }), person({ id: 3, age: 30 })];
    let hunted = exchangeBlows(
      twoVillagers.map((villager) => ({ villager, wolf: oneWolf, armed: true })),
    );
    for (let round = 0; round < 500 && hunted.slain.length === 0; round += 1) {
      hunted = exchangeBlows(
        twoVillagers.map((villager) => ({ villager, wolf: oneWolf, armed: true })),
      );
    }
    expect(hunted.slain).toEqual([oneWolf.id]);
    expect(hunted.fallen).toEqual([]);
  });

  it('hands out only the tools the settlement has', () => {
    expect(armedCount(0, 4)).toBe(0);
    expect(armedCount(2, 4)).toBe(2);
    expect(armedCount(9, 4)).toBe(4);
  });

  it('leaves the survivors hurt, and the hurt heal', () => {
    const simulation = new Simulation(OPTIONS);
    const villager = simulation.villagers.all[0]!;
    villager.wounds = VILLAGER_VIGOUR / 2;

    runADay(simulation);

    expect(villager.wounds).toBeLessThan(VILLAGER_VIGOUR / 2);
    expect(WOUND_HEALING_PER_DAY).toBeGreaterThan(0);
  });

  it('takes people, and the roll of the dead names the wolves', () => {
    // End to end through the simulation, with a whole pack on one villager who
    // has nothing in his hands.
    const simulation = new Simulation(OPTIONS);
    emptyTheYards(simulation);
    raid(simulation);
    const wolf = simulation.wolves.all[0]!;
    const victim = simulation.villagers.all[0]!;
    victim.age = 30;
    victim.position = { wx: wolf.position.wx, wy: wolf.position.wy };
    sendEverybodyFar(simulation, 1);
    const before = simulation.villagers.count;

    for (let tick = 0; tick < 600 && simulation.villagers.count === before; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
    }

    expect(simulation.villagers.count).toBeLessThan(before);
    expect(simulation.necrology.all.some((record) => record.cause === 'wolves')).toBe(true);
  });

  it('kills wolves too, and takes them off the map', () => {
    const simulation = new Simulation(OPTIONS);
    giveTools(simulation, 10);
    raid(simulation);
    const wolf = simulation.wolves.all[0]!;
    // Everybody of working age, standing on it.
    for (const villager of simulation.villagers.all) {
      villager.age = 30;
      villager.position = { wx: wolf.position.wx, wy: wolf.position.wy };
    }
    const arrived = simulation.wolves.count;

    for (let tick = 0; tick < 600 && simulation.wolves.count === arrived; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
    }

    expect(simulation.wolves.count).toBeLessThan(arrived);
  });
});

describe('a wall against a pack', () => {
  it('is chewed through if it is timber, and never if it is stone', () => {
    const simulation = new Simulation(OPTIONS);
    const timber = openGround(simulation);
    simulation.world.raiseFence(timber, 'palisade');

    let bites = 0;
    while (simulation.world.fences.hasAt(timber) && bites < TIMBER_STRENGTH * 4) {
      simulation.world.gnawFence(timber);
      bites += 1;
    }
    expect(simulation.world.fences.hasAt(timber)).toBe(false);
    expect(bites).toBeGreaterThan(10);

    const stone = openGround(simulation);
    simulation.world.raiseFence(stone, 'stone-wall');
    for (let bite = 0; bite < TIMBER_STRENGTH * 4; bite += 1) {
      simulation.world.gnawFence(stone);
    }
    expect(simulation.fenceKindAt(stone)).toBe('stone-wall');
  });

  it('carries the pack through a save and a load', () => {
    const simulation = new Simulation(OPTIONS);
    raid(simulation);
    const arrived = simulation.wolves.count;
    const where = simulation.wolves.all.map((wolf) => ({ ...wolf.position }));

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, 'now'));

    expect(loaded.wolves.count).toBe(arrived);
    expect(loaded.wolves.all.map((wolf) => ({ ...wolf.position }))).toEqual(where);
  });
});

describe('raising a stake line', () => {
  it('costs a log a cell, out of the yard', () => {
    const simulation = new Simulation(OPTIONS);
    const before = simulation.snapshot().stored.logs;

    expect(simulation.designateFence(openGround(simulation))).toBe(true);

    expect(simulation.snapshot().stored.logs).toBe(before - LOGS_PER_FENCE);
  });

  it('refuses when the yard has no timber', () => {
    const simulation = new Simulation(OPTIONS);
    emptyTheYards(simulation);

    expect(simulation.designateFence(openGround(simulation))).toBe(false);
  });

  it('gives the timber back when the order is called off', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openGround(simulation);
    const before = simulation.snapshot().stored.logs;

    simulation.designateFence(cell);
    expect(simulation.cancelFenceDesignation(cell)).toBe(true);

    expect(simulation.snapshot().stored.logs).toBe(before);
  });

  it('is work somebody has to walk out and do', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openGround(simulation);

    simulation.designateFence(cell);
    expect(simulation.hasFence(cell)).toBe(false);

    for (let day = 0; day < 20 && !simulation.hasFence(cell); day += 1) {
      runADay(simulation);
    }

    expect(simulation.hasFence(cell)).toBe(true);
  });

  it('stands in everybody way, which is what a wall is', () => {
    // **The rule this reverses.** A stake line villagers walked through was a
    // decoration; the interesting decision in any wall is where the way in is.
    const simulation = new Simulation(OPTIONS);
    const cell = openGround(simulation);
    expect(simulation.world.navigation.isWalkable(cell.gx, cell.gy)).toBe(true);

    simulation.world.raiseFence(cell, 'palisade');

    expect(simulation.world.navigation.isWalkable(cell.gx, cell.gy)).toBe(false);
  });

  it('opens again the moment a gate is hung in it', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openGround(simulation);
    simulation.world.raiseFence(cell, 'palisade');

    simulation.world.raiseFence(cell, 'timber-gate');

    expect(simulation.world.navigation.isWalkable(cell.gx, cell.gy)).toBe(true);
    expect(simulation.world.fences.isGate(cell)).toBe(true);
    // And it still keeps a pack out: a gate is barred when the alarm goes up.
    expect(simulation.world.fences.hasAt(cell)).toBe(true);
  });

  it('hangs a gate for timber and work, and opens the ground', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openGround(simulation);
    simulation.world.raiseFence(cell, 'palisade');
    const before = simulation.snapshot().stored.logs;

    expect(simulation.designateGate(cell)).toBe(true);
    expect(simulation.snapshot().stored.logs).toBe(before - LOGS_PER_GATE);

    for (let day = 0; day < 20 && !simulation.world.fences.isGate(cell); day += 1) {
      runADay(simulation);
    }

    expect(simulation.world.fences.isGate(cell)).toBe(true);
    expect(simulation.world.navigation.isWalkable(cell.gx, cell.gy)).toBe(true);
  });

  it('refuses a second gateway in the same cell', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openGround(simulation);
    simulation.world.raiseFence(cell, 'timber-gate');

    expect(simulation.designateGate(cell)).toBe(false);
  });

  it('builds a length up in stone, and a gate into a stone arch', () => {
    const simulation = new Simulation(OPTIONS);
    const wall = openGround(simulation);
    simulation.world.raiseFence(wall, 'palisade');
    // The quarry has not been built, so the founding stone is what there is.
    giveStone(simulation, STONE_PER_WALL + STONE_PER_GATE);

    expect(simulation.designateWall(wall)).toBe(true);
    for (let day = 0; day < 20 && simulation.fenceKindAt(wall) !== 'stone-wall'; day += 1) {
      runADay(simulation);
    }
    expect(simulation.fenceKindAt(wall)).toBe('stone-wall');

    // And a gateway cut into stone is a stone one, not a wooden door.
    simulation.designateGate(wall);
    for (let day = 0; day < 20 && !simulation.world.fences.isGate(wall); day += 1) {
      runADay(simulation);
    }
    expect(simulation.fenceKindAt(wall)).toBe('stone-gate');
  });

  it('refuses stone the settlement has not got, and keeps what it took', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openGround(simulation);
    simulation.world.raiseFence(cell, 'palisade');
    emptyTheYards(simulation);
    giveStone(simulation, 1);

    expect(simulation.designateWall(cell)).toBe(false);
    // The one stone it did have is back on the shelf rather than swallowed.
    expect(simulation.snapshot().stored.stone).toBe(1);
  });

  it('lets a pack chew through timber and never through stone', () => {
    const simulation = new Simulation(OPTIONS);
    const timber = openGround(simulation);
    simulation.world.raiseFence(timber, 'palisade');

    let bites = 0;
    while (simulation.world.fences.hasAt(timber) && bites < TIMBER_STRENGTH * 4) {
      simulation.world.gnawFence(timber);
      bites += 1;
    }
    expect(simulation.world.fences.hasAt(timber)).toBe(false);
    expect(bites).toBeGreaterThan(10);

    const stone = openGround(simulation);
    simulation.world.raiseFence(stone, 'stone-wall');
    for (let bite = 0; bite < TIMBER_STRENGTH * 4; bite += 1) {
      simulation.world.gnawFence(stone);
    }
    expect(simulation.fenceKindAt(stone)).toBe('stone-wall');
  });

  it('comes back after a save and a load', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openGround(simulation);
    simulation.world.raiseFence(cell);

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, 'now'));

    expect(loaded.hasFence(cell)).toBe(true);
  });

  it('remembers which kind each cell was, and how chewed', () => {
    const simulation = new Simulation(OPTIONS);
    const gate = openGround(simulation);
    simulation.world.raiseFence(gate, 'stone-gate');
    const timber = { gx: gate.gx + 2, gy: gate.gy };
    simulation.world.raiseFence(timber, 'palisade');
    simulation.world.gnawFence(timber);
    simulation.world.gnawFence(timber);

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, 'now'));

    expect(loaded.fenceKindAt(gate)).toBe('stone-gate');
    expect(loaded.fenceKindAt(timber)).toBe('palisade');
    expect(loaded.world.fences.damageAt(timber)).toBeGreaterThan(0);
    // And a gate is still a way through after a load, which is the thing a
    // settlement would notice first if the kinds came back wrong.
    expect(loaded.world.navigation.isWalkable(gate.gx, gate.gy)).toBe(true);
  });
});

// --- helpers ---

/**
 * Somebody to fight with, outside any settlement.
 *
 * The combat tests are about arithmetic rather than about a valley, so they use a
 * villager built by hand: no home, no job, nothing but an age and a body.
 */
function person(options: { id?: number; age?: number } = {}): Villager {
  return new Villager({
    id: options.id ?? 1,
    name: 'Test',
    sex: 'f',
    age: options.age ?? 30,
    position: { wx: 0, wy: 0 },
    lifespan: 70,
  });
}

/**
 * Sends everybody well clear of the wood, so a pack has nobody to go for.
 *
 * `keep` leaves the first few where they are, for the tests that want exactly one
 * person in reach.
 */
function sendEverybodyFar(simulation: Simulation, keep = 0): void {
  const away = clearOfTrees(simulation.world);
  simulation.villagers.all.forEach((villager, index) => {
    if (index < keep) {
      return;
    }
    villager.position = { wx: away.gx + 0.5, wy: away.gy + 0.5 };
  });
}

/** Puts tools on the shelf, for the tests about fighting armed. */
function giveTools(simulation: Simulation, amount: number): void {
  for (const storage of simulation.storages.all) {
    if (storage.accepts('tools')) {
      storage.inventory.add('tools', amount);
      return;
    }
  }
  throw new Error('nowhere to keep tools');
}

function runADay(simulation: Simulation): void {
  for (let tick = 0; tick < TICKS_PER_DAY; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
  }
}

/** A walkable cell with trees within a pack's reach. */
function besideTrees(world: World): GridPoint {
  for (let gy = 2; gy < world.height - 2; gy += 1) {
    for (let gx = 2; gx < world.width - 2; gx += 1) {
      const cell = { gx, gy };
      if (!world.navigation.isWalkable(cell.gx, cell.gy) || world.trees.has(cell)) {
        continue;
      }
      if (treesNear(world, cell)) {
        return cell;
      }
    }
  }
  throw new Error('no cell beside trees');
}

/** A walkable cell no pack could reach, for the tests about clearing ground. */
function clearOfTrees(world: World): GridPoint {
  for (let gy = 2; gy < world.height - 2; gy += 1) {
    for (let gx = 2; gx < world.width - 2; gx += 1) {
      const cell = { gx, gy };
      if (!world.navigation.isWalkable(cell.gx, cell.gy) || world.trees.has(cell)) {
        continue;
      }
      if (!treesNear(world, cell)) {
        return cell;
      }
    }
  }
  throw new Error('no cell clear of trees');
}

function treesNear(world: World, cell: GridPoint): boolean {
  for (let gy = cell.gy - WOLF_REACH; gy <= cell.gy + WOLF_REACH; gy += 1) {
    for (let gx = cell.gx - WOLF_REACH; gx <= cell.gx + WOLF_REACH; gx += 1) {
      if (world.terrain.contains(gx, gy) && world.trees.has({ gx, gy })) {
        return true;
      }
    }
  }
  return false;
}

/** Rings a cell with stakes, so nothing has a line to it. */
function fenceAround(world: World, cell: GridPoint, kind: FenceKind = 'palisade'): void {
  for (let gy = cell.gy - 1; gy <= cell.gy + 1; gy += 1) {
    for (let gx = cell.gx - 1; gx <= cell.gx + 1; gx += 1) {
      if (gx === cell.gx && gy === cell.gy) {
        continue;
      }
      world.raiseFence({ gx, gy }, kind);
    }
  }
}

/**
 * Somewhere to fence, near the settlement.
 *
 * Searched outwards from the camp rather than from the corner of the map: the
 * far corner of a valley is often across the river, and a job nobody can walk to
 * is a job nobody does — which is true of the game and useless as a fixture.
 */
function openGround(simulation: Simulation): GridPoint {
  const world = simulation.world;
  const camp = world.landfallCell;
  for (let ring = 2; ring < 12; ring += 1) {
    for (let gy = camp.gy - ring; gy <= camp.gy + ring; gy += 1) {
      for (let gx = camp.gx - ring; gx <= camp.gx + ring; gx += 1) {
        if (world.canFence({ gx, gy }) && world.navigation.isWalkable(gx, gy)) {
          return { gx, gy };
        }
      }
    }
  }
  throw new Error('nowhere to fence');
}

/** Puts stone on the shelf, for the tests about building in it. */
function giveStone(simulation: Simulation, amount: number): void {
  for (const storage of simulation.storages.all) {
    if (storage.accepts('stone')) {
      storage.inventory.add('stone', amount);
      return;
    }
  }
  throw new Error('nowhere to keep stone');
}

function emptyTheYards(simulation: Simulation): void {
  for (const storage of simulation.storages.all) {
    for (const { resource, amount } of storage.inventory.contents) {
      storage.inventory.remove(resource, amount);
    }
  }
}
