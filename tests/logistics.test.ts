import { describe, expect, it } from 'vitest';
import { LOGS_PER_TREE, RESOURCE_IDS, resourceDefinition } from '@/data/resources';
import { STARTING_RESOURCES } from '@/app/config';
import { Simulation } from '@/simulation/Simulation';
import { Inventory } from '@/simulation/resources/Inventory';
import { ResourcePileRegistry } from '@/simulation/resources/ResourcePile';
import { StorageRegistry } from '@/simulation/logistics/Storage';
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
    storages.add({ cell: { gx: 1, gy: 1 }, capacity: 100, accepts: ['food'] });
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

  function run(simulation: Simulation, ticks: number, from = 1): void {
    for (let tick = from; tick <= from + ticks; tick += 1) {
      simulation.update(tick, TICK);
    }
  }

  it("starts with a storage yard holding the settlers' supplies", () => {
    const simulation = new Simulation(OPTIONS);

    expect(simulation.storages.count).toBe(1);
    expect(simulation.snapshot().stored.logs).toBe(STARTING_RESOURCES.logs);
    expect(simulation.snapshot().stored.food).toBe(STARTING_RESOURCES.food);
    // Nothing is lying in the field yet: supplies arrive already stored.
    expect(simulation.snapshot().loose.logs).toBe(0);
  });

  it('drops physical logs where a tree stood, not into a counter', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = firstTreeCell(simulation);
    const treeId = simulation.world.trees.getAt(cell)!.id;

    simulation.world.fellTree(treeId);

    // The logs exist on the ground...
    expect(simulation.world.piles.getAt(cell, 'logs')?.amount).toBe(LOGS_PER_TREE);
    // ...and the settlement's stock has not moved, because nobody carried them.
    expect(simulation.snapshot().stored.logs).toBe(STARTING_RESOURCES.logs);
  });

  it('hauls logs from the ground into storage', () => {
    const simulation = new Simulation(OPTIONS);
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

    const snapshot = simulation.snapshot();
    expect(snapshot.loose.logs).toBe(LOGS_PER_TREE);
    expect(snapshot.stored.logs).toBe(STARTING_RESOURCES.logs);
    expect(snapshot.pileCount).toBe(1);
  });

  it('exposes a total for every resource, even at zero', () => {
    const snapshot = new Simulation(OPTIONS).snapshot();
    for (const resource of RESOURCE_IDS) {
      expect(typeof snapshot.stored[resource]).toBe('number');
      expect(snapshot.loose[resource]).toBe(0);
    }
    // Firewood has no source at founding; it must be made.
    expect(snapshot.stored.firewood).toBe(0);
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
