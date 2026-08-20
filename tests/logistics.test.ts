import { describe, expect, it } from 'vitest';
import { LOGS_PER_TREE, RESOURCE_IDS, resourceDefinition } from '@/data/resources';
import { STARTING_RESOURCES } from '@/app/config';
import { Simulation, STALE_PILE_DAYS } from '@/simulation/Simulation';
import { JobPriority } from '@/simulation/jobs/Job';
import { restore, serialise } from '@/simulation/save/serialise';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { Inventory } from '@/simulation/resources/Inventory';
import { ResourcePileRegistry } from '@/simulation/resources/ResourcePile';
import { StorageRegistry } from '@/simulation/logistics/Storage';
import type { BuildingId } from '@/data/buildings';
import type { ResourceId } from '@/data/resources';
import type { GridPoint } from '@/shared/types/geometry';
import { nearbyTrees, reachableTree } from './support/playtest';

const TICK = 0.1;
const OPTIONS = { seed: 20260815, worldWidth: 48, worldHeight: 48, startingVillagers: 10 };

describe('Inventory', () => {
  it('starts empty', () => {
    const inventory = new Inventory(10);
    expect(inventory.isEmpty).toBe(true);
    expect(inventory.total).toBe(0);
    expect(inventory.freeSpace).toBe(10);
  });

  it('adds and counts a resource', () => {
    const inventory = new Inventory(10);
    expect(inventory.add('logs', 4)).toBe(4);
    expect(inventory.count('logs')).toBe(4);
  });

  it('accepts only what fits, and reports how much', () => {
    const inventory = new Inventory(5);
    expect(inventory.add('logs', 8)).toBe(5);
    expect(inventory.count('logs')).toBe(5);
    expect(inventory.isFull).toBe(true);
  });

  it('counts capacity across resources, not per resource', () => {
    const inventory = new Inventory(10);
    inventory.add('logs', 6);
    expect(inventory.add('stone', 6)).toBe(4);
    expect(inventory.total).toBe(10);
  });

  it('removes only what is there', () => {
    const inventory = new Inventory(10);
    inventory.add('logs', 3);
    expect(inventory.remove('logs', 9)).toBe(3);
    expect(inventory.count('logs')).toBe(0);
    expect(inventory.isEmpty).toBe(true);
  });

  it('ignores non-positive amounts', () => {
    const inventory = new Inventory(10);
    expect(inventory.add('logs', 0)).toBe(0);
    expect(inventory.add('logs', -5)).toBe(0);
    expect(inventory.remove('logs', -5)).toBe(0);
  });

  describe('transfer', () => {
    it('moves resources between containers', () => {
      const from = new Inventory(10);
      const to = new Inventory(10);
      from.add('logs', 6);

      expect(from.transfer(to, 'logs', 4)).toBe(4);
      expect(from.count('logs')).toBe(2);
      expect(to.count('logs')).toBe(4);
    });

    it('conserves resources when the destination is full', () => {
      const from = new Inventory(10);
      const to = new Inventory(3);
      from.add('logs', 10);

      const moved = from.transfer(to, 'logs', 10);

      // Nothing may vanish in transit: what left one side arrived at the other.
      expect(moved).toBe(3);
      expect(from.count('logs') + to.count('logs')).toBe(10);
    });

    it('moves nothing when the source has nothing', () => {
      const from = new Inventory(10);
      const to = new Inventory(10);
      expect(from.transfer(to, 'logs', 5)).toBe(0);
    });

    it('moves everything it holds', () => {
      const from = new Inventory(10);
      const to = new Inventory(20);
      from.add('logs', 4);
      from.add('stone', 3);

      expect(from.transferAll(to)).toBe(7);
      expect(from.isEmpty).toBe(true);
      expect(to.count('logs')).toBe(4);
      expect(to.count('stone')).toBe(3);
    });
  });
});

describe('ResourcePileRegistry', () => {
  it('drops a pile on the ground', () => {
    const piles = new ResourcePileRegistry();
    expect(piles.drop({ gx: 3, gy: 4 }, 'logs', 5)).toBe(5);
    expect(piles.count).toBe(1);
    expect(piles.getAt({ gx: 3, gy: 4 }, 'logs')?.amount).toBe(5);
  });

  it('merges into an existing pile of the same resource', () => {
    const piles = new ResourcePileRegistry();
    piles.drop({ gx: 3, gy: 4 }, 'logs', 5);
    piles.drop({ gx: 3, gy: 4 }, 'logs', 4);

    expect(piles.count).toBe(1);
    expect(piles.getAt({ gx: 3, gy: 4 }, 'logs')?.amount).toBe(9);
  });

  it('keeps different resources on the same cell apart', () => {
    const piles = new ResourcePileRegistry();
    piles.drop({ gx: 1, gy: 1 }, 'logs', 3);
    piles.drop({ gx: 1, gy: 1 }, 'stone', 2);

    expect(piles.count).toBe(2);
  });

  it('refuses more than a pile can hold', () => {
    const piles = new ResourcePileRegistry();
    const max = resourceDefinition('logs').maxStack;

    expect(piles.drop({ gx: 0, gy: 0 }, 'logs', max + 50)).toBe(max);
  });

  it('removes a pile once it is emptied', () => {
    const piles = new ResourcePileRegistry();
    piles.drop({ gx: 2, gy: 2 }, 'logs', 3);
    const pile = piles.getAt({ gx: 2, gy: 2 }, 'logs')!;

    pile.inventory.remove('logs', 3);
    piles.removeIfEmpty(pile.id);

    expect(piles.count).toBe(0);
  });

  it('keeps a partly emptied pile', () => {
    const piles = new ResourcePileRegistry();
    piles.drop({ gx: 2, gy: 2 }, 'logs', 5);
    const pile = piles.getAt({ gx: 2, gy: 2 }, 'logs')!;

    pile.inventory.remove('logs', 2);
    piles.removeIfEmpty(pile.id);

    expect(piles.count).toBe(1);
    expect(pile.amount).toBe(3);
  });

  it('bumps its version when the ground changes', () => {
    const piles = new ResourcePileRegistry();
    const before = piles.version;
    piles.drop({ gx: 0, gy: 0 }, 'logs', 1);
    expect(piles.version).toBeGreaterThan(before);
  });
});

describe('StorageRegistry', () => {
  it('finds the nearest yard that will take a resource', () => {
    const storages = new StorageRegistry();
    storages.add({ cell: { gx: 40, gy: 40 }, capacity: 100 });
    const near = storages.add({ cell: { gx: 2, gy: 2 }, capacity: 100 });

    expect(storages.findNearestAccepting({ gx: 0, gy: 0 }, 'logs')?.id).toBe(near.id);
  });

  it('skips a yard that does not accept the resource', () => {
    const storages = new StorageRegistry();
    storages.add({ cell: { gx: 1, gy: 1 }, capacity: 100, accepts: ['vegetables'] });
    const general = storages.add({ cell: { gx: 30, gy: 30 }, capacity: 100 });

    expect(storages.findNearestAccepting({ gx: 0, gy: 0 }, 'logs')?.id).toBe(general.id);
  });

  it('skips a full yard', () => {
    const storages = new StorageRegistry();
    const full = storages.add({ cell: { gx: 1, gy: 1 }, capacity: 2 });
    full.inventory.add('logs', 2);
    const other = storages.add({ cell: { gx: 30, gy: 30 }, capacity: 100 });

    expect(storages.findNearestAccepting({ gx: 0, gy: 0 }, 'logs')?.id).toBe(other.id);
  });

  it('returns null when nowhere will take it', () => {
    const storages = new StorageRegistry();
    expect(storages.findNearestAccepting({ gx: 0, gy: 0 }, 'logs')).toBeNull();
  });

  it('totals a resource across yards', () => {
    const storages = new StorageRegistry();
    storages.add({ cell: { gx: 1, gy: 1 }, capacity: 100 }).inventory.add('logs', 5);
    storages.add({ cell: { gx: 9, gy: 9 }, capacity: 100 }).inventory.add('logs', 7);

    expect(storages.totalOf('logs')).toBe(12);
  });
});

describe('the full logistics loop', () => {
  /**
   * The nearest tree with a route to it.
   *
   * The first tree in the registry stands in the map's top-left corner, which
   * since the river may be on the far bank — and a haul that cannot happen is
   * not a hauling test.
   */
  function firstTreeCell(simulation: Simulation) {
    return reachableTree(simulation);
  }

  /** Takes the settlers' bundles away, for tests that want an empty field. */
  function clearTheGround(simulation: Simulation): void {
    for (const pile of [...simulation.world.piles.all]) {
      simulation.world.piles.remove(pile.id);
    }
  }

  function run(simulation: Simulation, ticks: number, from = 1): void {
    for (let tick = from; tick <= from + ticks; tick += 1) {
      simulation.update(tick, TICK);
    }
  }

  it("starts with everything the settlers carried on the camp's shelves", () => {
    // One store, holding all of it, and nothing on the ground. It was bundles on
    // the ground for a while — see `river.test.ts` — and the reason it went back
    // is that a settlement whose opening move is tidying up reads as a mess
    // rather than as a camp.
    const simulation = new Simulation(OPTIONS);
    const snapshot = simulation.snapshot();

    expect(simulation.storages.count).toBe(1);
    expect(snapshot.stored.vegetables).toBe(STARTING_RESOURCES.vegetables);
    expect(snapshot.stored.logs).toBe(STARTING_RESOURCES.logs);
    expect(snapshot.stored.stone).toBe(STARTING_RESOURCES.stone);
    expect(snapshot.loose.logs).toBe(0);
    expect(snapshot.loose.stone).toBe(0);
  });

  it('drops physical logs where a tree stood, not into a counter', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = firstTreeCell(simulation);
    const treeId = simulation.world.trees.getAt(cell)!.id;

    const stored = simulation.snapshot().stored.logs;
    simulation.world.fellTree(treeId);

    // The logs exist on the ground...
    expect(simulation.world.piles.getAt(cell, 'logs')?.amount).toBe(LOGS_PER_TREE);
    // ...and the store has not moved, because nobody carried them. Measured as a
    // difference rather than as zero: the settlers arrive with timber on the
    // shelves, and the point of this test is the tree, not the total.
    expect(simulation.snapshot().stored.logs).toBe(stored);
  });

  it('hauls logs from the ground into storage', () => {
    const simulation = new Simulation(OPTIONS);
    // The settlers' own bundles are on the ground too; taken away here so what
    // reaches the store can only have come from the tree.
    clearTheGround(simulation);
    const before = simulation.snapshot().stored.logs;
    const cell = firstTreeCell(simulation);
    simulation.designateTreeForFelling(cell);

    for (let tick = 1; tick <= 8000; tick += 1) {
      simulation.update(tick, TICK);
      if (simulation.snapshot().stored.logs > before) {
        break;
      }
    }

    const gained = simulation.snapshot().stored.logs - before;
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThanOrEqual(LOGS_PER_TREE);
  });

  it('conserves every log: felled equals stored plus loose plus carried', () => {
    const simulation = new Simulation(OPTIONS);
    const trees = nearbyTrees(simulation, 6).map((cell) => simulation.world.trees.getAt(cell)!);
    for (const tree of trees) {
      simulation.designateTreeForFelling({ gx: tree.gx, gy: tree.gy });
    }

    run(simulation, 9000);

    const felled = trees.filter((t) => simulation.world.trees.getById(t.id) === null).length;
    const snapshot = simulation.snapshot();
    const carried = simulation.villagers.all.reduce(
      (sum, villager) => sum + villager.inventory.count('logs'),
      0,
    );

    // The invariant that makes this phase honest: wood is neither created nor
    // destroyed, only moved between the ground, a villager's arms and a yard.
    // Measured against what the settlers arrived with.
    const total = snapshot.stored.logs + snapshot.loose.logs + carried;
    expect(total - STARTING_RESOURCES.logs).toBe(felled * LOGS_PER_TREE);
  });

  it('empties the ground once hauling catches up', () => {
    const simulation = new Simulation(OPTIONS);
    const trees = nearbyTrees(simulation, 3).map((cell) => simulation.world.trees.getAt(cell)!);
    for (const tree of trees) {
      simulation.designateTreeForFelling({ gx: tree.gx, gy: tree.gy });
    }

    run(simulation, 20000);

    const snapshot = simulation.snapshot();
    expect(snapshot.loose.logs).toBe(0);
    expect(snapshot.stored.logs).toBe(STARTING_RESOURCES.logs + trees.length * LOGS_PER_TREE);
  });

  it('spills a load onto the next cell rather than losing it', () => {
    // **The largest single source of "where did my harvest go".** A pile holds one
    // stack, `drop` refuses the excess, and every caller ignored what it said it
    // had taken — so an Orchard making 22 food a batch onto one doorstep lost
    // everything past the first fifty until a hauler came.
    const simulation = new Simulation(OPTIONS);
    const cell = simulation.world.heartCell;
    const stack = resourceDefinition('vegetables').maxStack;

    const placed = simulation.world.dropNear(cell, 'vegetables', stack * 3);

    expect(placed).toBe(stack * 3);
    expect(simulation.world.piles.totalOf('vegetables')).toBe(stack * 3);
    // And spread over more than one cell, because one cell cannot hold it.
    expect(simulation.world.piles.getAt(cell, 'vegetables')?.amount).toBe(stack);
  });

  it('keeps a spilled load somewhere a hauler can stand', () => {
    const simulation = new Simulation(OPTIONS);
    const stack = resourceDefinition('vegetables').maxStack;
    simulation.world.dropNear(simulation.world.heartCell, 'vegetables', stack * 3);

    for (const pile of simulation.world.piles.all) {
      expect(simulation.world.isWalkable(pile.cell), `${pile.cell.gx},${pile.cell.gy}`).toBe(true);
    }
  });

  it('never lets two villagers haul the same pile', () => {
    const simulation = new Simulation(OPTIONS);
    for (const cell of nearbyTrees(simulation, 15)) {
      simulation.designateTreeForFelling(cell);
    }

    for (let tick = 1; tick <= 3000; tick += 1) {
      simulation.update(tick, TICK);

      const haulTargets = simulation.jobs.all
        .filter((job) => job.type === 'haul' && job.assignedVillager !== null)
        .map((job) => job.targetEntityId);

      expect(new Set(haulTargets).size, `tick ${tick} shared a pile`).toBe(haulTargets.length);
    }
  });

  it('mines a stone deposit into physical stone and opens the tile', () => {
    const simulation = new Simulation(OPTIONS);
    let deposit: { gx: number; gy: number } | null = null;
    simulation.world.terrain.forEach((gx, gy, type) => {
      if (!deposit && type === 'stone') {
        deposit = { gx, gy };
      }
    });
    expect(deposit).not.toBeNull();

    expect(simulation.world.isWalkable(deposit!)).toBe(false);
    simulation.world.mineStone(deposit!);

    expect(simulation.world.piles.getAt(deposit!, 'stone')).not.toBeNull();
    expect(simulation.world.isWalkable(deposit!)).toBe(true);
  });

  it('reports loose and stored separately', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = firstTreeCell(simulation);
    simulation.world.fellTree(simulation.world.trees.getAt(cell)!.id);

    // The two figures are genuinely different numbers about the same resource:
    // the tree's logs are on the ground and the settlers' are on a shelf, and a
    // HUD that added them together would tell a player they had timber to build
    // with when half of it was still lying in the wood.
    const snapshot = simulation.snapshot();
    expect(snapshot.loose.logs).toBe(LOGS_PER_TREE);
    expect(snapshot.stored.logs).toBe(STARTING_RESOURCES.logs);
    expect(snapshot.pileCount).toBe(1);
  });

  it('exposes a total for every resource, even at zero', () => {
    const snapshot = new Simulation(OPTIONS).snapshot();
    for (const resource of RESOURCE_IDS) {
      expect(typeof snapshot.stored[resource]).toBe('number');
      expect(typeof snapshot.loose[resource]).toBe('number');
    }
    // Firewood has no source at founding; it must be made.
    expect(snapshot.stored.firewood).toBe(0);
    expect(snapshot.loose.firewood).toBe(0);
  });

  it('stays deterministic through a full haul cycle', () => {
    const play = (): string => {
      const simulation = new Simulation(OPTIONS);
      for (const tree of [...simulation.world.trees.all].slice(0, 5)) {
        simulation.designateTreeForFelling({ gx: tree.gx, gy: tree.gy });
      }
      run(simulation, 4000);
      const s = simulation.snapshot();
      return `${s.stored.logs}|${s.loose.logs}|${s.pileCount}|${s.jobsCompleted}`;
    };

    expect(play()).toBe(play());
  });
});

/**
 * Goods nobody carries.
 *
 * **Reported from play, and the failure it names is a real one.** A settlement
 * can employ every pair of hands it has; then nothing is left to haul, and
 * because a workshop's own work is `urgent`, its people go on making more onto a
 * heap that never moves. Twelve days of that is not a busy settlement, it is a
 * broken one — and the fix is to make the heap the most important thing on the
 * board, so the nearest pair of hands carries it in. The nearest pair is almost
 * always the pair that made it.
 */
describe('a heap nobody has carried', () => {
  it('counts the days it has been lying there', () => {
    const piles = new ResourcePileRegistry();
    piles.drop({ gx: 4, gy: 4 }, 'logs', 6);
    const pile = piles.getAt({ gx: 4, gy: 4 }, 'logs')!;

    expect(pile.days).toBe(0);
    piles.ageByADay();
    piles.ageByADay();
    expect(pile.days).toBe(2);
  });

  it('does not start again when more is thrown on top', () => {
    // The whole point. A heap being topped up while nobody carries any of it
    // away is exactly the situation the count exists to notice, so adding to it
    // must not look like a fresh heap.
    const piles = new ResourcePileRegistry();
    piles.drop({ gx: 4, gy: 4 }, 'logs', 6);
    const pile = piles.getAt({ gx: 4, gy: 4 }, 'logs')!;
    for (let day = 0; day < 8; day += 1) {
      piles.ageByADay();
      piles.drop({ gx: 4, gy: 4 }, 'logs', 1);
    }
    expect(pile.days).toBe(8);
  });

  it('ages by one a day as the settlement runs', () => {
    // Nobody in the valley, so the heap is still there to be counted: with ten
    // idle villagers it is carried in on the first afternoon, which is the
    // behaviour every other test here is about.
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 0 });
    const cell = reachableTree(simulation);
    simulation.world.piles.drop(cell, 'stone', 4);
    const pile = simulation.world.piles.getAt(cell, 'stone')!;

    advance(simulation, TICKS_PER_DAY * 3);
    expect(pile.days).toBe(3);
  });

  it("outranks its own workshop's work once it is a season old", () => {
    // Above `urgent`, which nothing else in the game is. A forager's produce job
    // is urgent and sits at distance zero from her, so anything merely equal to
    // it would lose the tiebreak for ever.
    //
    // Nobody in the valley: a claimed job keeps the price it was claimed at, and
    // what is being tested is the price on the board.
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 0 });
    const hut = workshop(simulation, 'gatherer-hut');
    const pile = heapAt(simulation, hut.accessCell, 'spices');

    advance(simulation, 2);
    const job = haulFor(simulation, pile.id);
    expect(job.priority).toBeLessThan(JobPriority.urgent);

    pile.days = STALE_PILE_DAYS;
    advance(simulation, 2);
    expect(job.priority).toBe(JobPriority.overdue);
    expect(JobPriority.overdue).toBeGreaterThan(JobPriority.urgent);
  });

  it('leaves a heap in the wood at its ordinary price, however old', () => {
    // **Measured, not assumed.** Escalating every twelve-day-old pile anywhere
    // sent whole settlements across the map for the timber a player's felling
    // orders had left standing in log heaps, and food banked before the frost fell
    // from 181 to 92 with eighteen more dead over twenty-four worlds. Timber lying
    // in a wood nobody has reached yet is a backlog; a heap outside the hut that is
    // still making more of it is a deadlock. Only the second is worth a day.
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 0 });
    const far = reachableTree(simulation);
    simulation.world.piles.drop(far, 'logs', 8);
    const pile = simulation.world.piles.getAt(far, 'logs')!;
    pile.days = STALE_PILE_DAYS * 4;

    advance(simulation, 3);
    expect(haulFor(simulation, pile.id).priority).toBeLessThan(JobPriority.overdue);
  });

  it('ignores a heap of something the workshop beside it does not make', () => {
    // A heap of stone outside a Gatherer Hut is somebody else's backlog. The rule
    // is about a workshop's *own* output piling up, because that is the case where
    // making more of it is worse than useless.
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 0 });
    const hut = workshop(simulation, 'gatherer-hut');
    const pile = heapAt(simulation, hut.accessCell, 'stone');
    pile.days = STALE_PILE_DAYS * 2;

    advance(simulation, 3);
    expect(haulFor(simulation, pile.id).priority).toBeLessThan(JobPriority.overdue);
  });

  it('is still the same age after a reload', () => {
    // A reload that forgot the age would hand the player back the deadlock they
    // had just been rescued from.
    const simulation = new Simulation(OPTIONS);
    const cell = reachableTree(simulation);
    simulation.world.piles.drop(cell, 'stone', 5);
    simulation.world.piles.getAt(cell, 'stone')!.days = 9;

    const save = serialise(simulation, 'now');
    const reloaded = new Simulation(OPTIONS);
    restore(reloaded, save);

    expect(reloaded.world.piles.getAt(cell, 'stone')?.days).toBe(9);
  });

  it("takes the workshop's own people off production to carry it", () => {
    // The request, in one assertion: the people who made it are the people who
    // carry it. They are also the nearest — a forager standing beside her own
    // harvest — so no rule has to name them; putting the heap above `urgent` is
    // enough, and it is her own workshop's job she is being taken off.
    // Two settlers and a two-post hut, which is the deadlock in miniature: every
    // pair of hands is employed, so there is nobody left to haul and the hut's own
    // work is `urgent` for ever.
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 2 });
    const hut = workshop(simulation, 'gatherer-hut');
    advance(simulation, TICKS_PER_DAY * 2);
    expect(hut.workers).toHaveLength(2);

    const pile = heapAt(simulation, hut.accessCell, 'spices');
    pile.days = STALE_PILE_DAYS;
    advance(simulation, 2);
    expect(haulFor(simulation, pile.id).priority).toBe(JobPriority.overdue);

    // Polled rather than run for a fixed stretch: nobody abandons a job
    // half-done, so a forager finishes the armful she is gathering first. What
    // matters is who picks the errand up when she next looks at the board.
    let taker: number | null = null;
    for (let tick = 0; tick < TICKS_PER_DAY * 2 && taker === null; tick += 1) {
      advance(simulation, 1);
      taker = standingHaul(simulation, pile.id)?.assignedVillager ?? null;
    }
    expect(hut.workers).toContain(taker);
  });
});

/** A finished workshop of this kind, put up wherever the ground allows. */
function workshop(simulation: Simulation, id: BuildingId) {
  const world = simulation.world;
  const from = world.landfallCell;
  for (let radius = 3; radius < 20; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const placed = world.buildings.place(world, id, { gx: from.gx + dx, gy: from.gy + dy });
        if (placed) {
          world.buildings.complete(world, placed);
          return placed;
        }
      }
    }
  }
  throw new Error(`nowhere to put a ${id}`);
}

/** A heap on or beside a cell, whichever the ground took. */
function heapAt(simulation: Simulation, cell: GridPoint, resource: ResourceId) {
  simulation.world.dropNear(cell, resource, 8);
  const pile = [...simulation.world.piles.all].find((candidate) => candidate.resource === resource);
  if (!pile) {
    throw new Error(`no heap of ${resource} was dropped`);
  }
  return pile;
}

/** The standing haul job against a heap, or `undefined` once it is done with. */
function standingHaul(simulation: Simulation, pileId: number) {
  return [...simulation.jobs.all].find(
    (candidate) => candidate.type === 'haul' && candidate.targetEntityId === pileId,
  );
}

/** The same, for the tests that would be meaningless without one. */
function haulFor(simulation: Simulation, pileId: number) {
  const job = standingHaul(simulation, pileId);
  if (!job) {
    throw new Error(`no haul job for pile ${pileId}`);
  }
  return job;
}

/** Runs a settlement forward, keeping its own tick count. */
function advance(simulation: Simulation, ticks: number): void {
  const from = simulation.tick + 1;
  for (let tick = from; tick < from + ticks; tick += 1) {
    simulation.update(tick, TICK);
  }
}
