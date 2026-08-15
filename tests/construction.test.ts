import { describe, expect, it } from 'vitest';
import { buildingDefinition } from '@/data/buildings';
import { Simulation } from '@/simulation/Simulation';

const TICK = 0.1;
const OPTIONS = { seed: 20260815, worldWidth: 48, worldHeight: 48, startingVillagers: 10 };

/** A cleared, buildable patch next to the founding yard. */
function clearArea(simulation: Simulation, origin: { gx: number; gy: number }, size = 4) {
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      const cell = { gx: origin.gx + dx, gy: origin.gy + dy };
      const tree = simulation.world.trees.getAt(cell);
      if (tree) {
        simulation.world.trees.remove(tree.id);
      }
      simulation.world.terrain.set(cell.gx, cell.gy, 'grass');
      simulation.world.navigation.refreshCell(simulation.world.terrain, cell.gx, cell.gy);
    }
  }
}

function stock(simulation: Simulation, resource: 'logs' | 'stone', amount: number) {
  simulation.storages.all[0]!.inventory.add(resource, amount);
  simulation.storages.markChanged();
}

describe('placement', () => {
  it('accepts a clear, buildable patch', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = { gx: 20, gy: 20 };
    clearArea(simulation, origin);

    expect(simulation.canPlaceBuilding('house', origin).ok).toBe(true);
  });

  it('refuses a footprint hanging off the map', () => {
    const simulation = new Simulation(OPTIONS);
    // Clear the on-map corner so the overhang is the only remaining problem.
    clearArea(simulation, { gx: 46, gy: 46 }, 2);

    const check = simulation.canPlaceBuilding('house', { gx: 47, gy: 47 });

    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toBe('off-map');
  });

  it('refuses standing trees rather than clearing them silently', () => {
    const simulation = new Simulation(OPTIONS);
    const tree = [...simulation.world.trees.all][0]!;
    const check = simulation.canPlaceBuilding('house', { gx: tree.gx, gy: tree.gy });

    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toBe('trees-in-the-way');
  });

  it('refuses water and rock', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = { gx: 20, gy: 20 };
    clearArea(simulation, origin);
    simulation.world.terrain.set(21, 21, 'water');

    const check = simulation.canPlaceBuilding('house', origin);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toBe('blocked-terrain');
  });

  it('refuses a cell another building already occupies', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = { gx: 20, gy: 20 };
    clearArea(simulation, origin, 6);
    simulation.placeBuilding('house', origin);

    const check = simulation.canPlaceBuilding('house', { gx: 21, gy: 21 });
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toBe('occupied');
  });

  it('gives the ghost and the command the same answer', () => {
    const simulation = new Simulation(OPTIONS);
    const tree = [...simulation.world.trees.all][0]!;
    const origin = { gx: tree.gx, gy: tree.gy };

    expect(simulation.canPlaceBuilding('house', origin).ok).toBe(false);
    expect(simulation.placeBuilding('house', origin)).toBeNull();
  });

  it('leaves a site walkable while it is being built, and blocks it once finished', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = { gx: 20, gy: 20 };
    clearArea(simulation, origin);

    const site = simulation.placeBuilding('house', origin)!;

    // Builders and haulers must be able to reach the middle of their own site.
    expect(simulation.world.isWalkable({ gx: 21, gy: 21 })).toBe(true);

    simulation.world.buildings.complete(simulation.world, site);

    expect(simulation.world.isWalkable({ gx: 21, gy: 21 })).toBe(false);
  });
});

describe('construction', () => {
  it('starts a site empty and unbuilt', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = { gx: 20, gy: 20 };
    clearArea(simulation, origin);

    const site = simulation.placeBuilding('house', origin)!;

    expect(site.isComplete).toBe(false);
    expect(site.materials.isEmpty).toBe(true);
    expect(site.hasAllMaterials).toBe(false);
    expect(simulation.snapshot().sitesUnderConstruction).toBe(1);
  });

  it('knows what it still needs', () => {
    const simulation = new Simulation(OPTIONS);
    clearArea(simulation, { gx: 20, gy: 20 });
    const site = simulation.placeBuilding('house', { gx: 20, gy: 20 })!;
    const cost = buildingDefinition('house').constructionCost;

    expect(site.stillNeeds('logs')).toBe(cost.find((c) => c.resource === 'logs')!.amount);

    site.materials.add('logs', 3);
    expect(site.stillNeeds('logs')).toBe(cost.find((c) => c.resource === 'logs')!.amount - 3);
  });

  it('will not build without materials, however long it waits', () => {
    const simulation = new Simulation(OPTIONS);
    clearArea(simulation, { gx: 20, gy: 20 });
    const site = simulation.placeBuilding('house', { gx: 20, gy: 20 })!;
    // Deliberately no stock in the yard.

    for (let tick = 1; tick <= 3000; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(site.isComplete).toBe(false);
  });

  it('villagers carry materials from the yard to the site', () => {
    const simulation = new Simulation(OPTIONS);
    clearArea(simulation, { gx: 30, gy: 30 }, 8);
    stock(simulation, 'logs', 40);
    stock(simulation, 'stone', 20);
    const site = simulation.placeBuilding('house', { gx: 32, gy: 32 })!;

    for (let tick = 1; tick <= 12000 && !site.hasAllMaterials; tick += 1) {
      simulation.update(tick, TICK);
    }

    // The materials physically arrived; they were not deducted in place.
    expect(site.hasAllMaterials).toBe(true);
  });

  it('completes a house once materials and labour are done', () => {
    const simulation = new Simulation(OPTIONS);
    clearArea(simulation, { gx: 30, gy: 30 }, 8);
    stock(simulation, 'logs', 40);
    stock(simulation, 'stone', 20);
    const site = simulation.placeBuilding('house', { gx: 32, gy: 32 })!;

    for (let tick = 1; tick <= 30000 && !site.isComplete; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(site.isComplete).toBe(true);
    expect(simulation.snapshot().housingCapacity).toBe(buildingDefinition('house').housing);
  });

  it('takes the materials out of storage, not out of nowhere', () => {
    const simulation = new Simulation(OPTIONS);
    clearArea(simulation, { gx: 30, gy: 30 }, 8);
    stock(simulation, 'logs', 40);
    stock(simulation, 'stone', 20);
    const before = simulation.snapshot().stored.logs;
    const site = simulation.placeBuilding('house', { gx: 32, gy: 32 })!;

    for (let tick = 1; tick <= 30000 && !site.isComplete; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.snapshot().stored.logs).toBeLessThan(before);
  });

  it('reports footprint cells correctly', () => {
    const simulation = new Simulation(OPTIONS);
    clearArea(simulation, { gx: 20, gy: 20 }, 6);
    const yard = simulation.placeBuilding('storage-yard', { gx: 20, gy: 20 })!;

    expect(yard.cells()).toHaveLength(9);
    expect(yard.cells()).toContainEqual({ gx: 22, gy: 22 });
  });

  it('stays deterministic through a full build', () => {
    const play = (): string => {
      const simulation = new Simulation(OPTIONS);
      clearArea(simulation, { gx: 30, gy: 30 }, 8);
      stock(simulation, 'logs', 40);
      stock(simulation, 'stone', 20);
      const site = simulation.placeBuilding('house', { gx: 32, gy: 32 })!;
      for (let tick = 1; tick <= 6000; tick += 1) {
        simulation.update(tick, TICK);
      }
      return `${site.isComplete}|${site.buildTicksRemaining}|${simulation.snapshot().stored.logs}`;
    };

    expect(play()).toBe(play());
  });
});
