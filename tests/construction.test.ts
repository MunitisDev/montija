import { describe, expect, it } from 'vitest';
import { buildingDefinition } from '@/data/buildings';
import type { GridPoint } from '@/shared/types/geometry';
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

/**
 * Clears a patch of ground on the settlement's own side of the river, and
 * returns its origin.
 *
 * It used to be a fixed corner of the map, which was fine while everything
 * walkable was one piece. The day a river cut the map in two, half of these
 * tests were putting a building on the far bank — where no material can be
 * carried and nothing can be built, and where placement is now refused outright.
 *
 * Inland from the camp rather than towards it, so clearing the patch cannot
 * accidentally fill in the river.
 */
function plotNear(simulation: Simulation, size = 4): GridPoint {
  const world = simulation.world;
  const heart = world.heartCell;
  const horizontal = world.river.axis === 'horizontal';
  const middle = world.river.middle[horizontal ? heart.gx : heart.gy] ?? heart;
  const away = -(Math.sign(horizontal ? middle.gy - heart.gy : middle.gx - heart.gx) || 1);

  const origin = horizontal
    ? { gx: heart.gx - 1, gy: heart.gy + away * 3 }
    : { gx: heart.gx + away * 3, gy: heart.gy - 1 };
  clearArea(simulation, origin, size);
  return origin;
}

/** Everything the settlement has, on shelves and on the ground alike. */
function logsEverywhere(simulation: Simulation): number {
  const snapshot = simulation.snapshot();
  return snapshot.stored.logs + snapshot.loose.logs;
}

/** Empties the store and clears the ground: a settlement with nothing at all. */
function strip(simulation: Simulation): void {
  simulation.storages.all[0]!.inventory.clear();
  simulation.storages.markChanged();
  for (const pile of [...simulation.world.piles.all]) {
    simulation.world.piles.remove(pile.id);
  }
}

function stock(simulation: Simulation, resource: 'logs' | 'stone', amount: number) {
  simulation.storages.all[0]!.inventory.add(resource, amount);
  simulation.storages.markChanged();
}

describe('placement', () => {
  it('accepts a clear, buildable patch', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = plotNear(simulation);

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
    const origin = plotNear(simulation);
    simulation.world.terrain.set(origin.gx + 1, origin.gy + 1, 'water');

    const check = simulation.canPlaceBuilding('house', origin);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toBe('blocked-terrain');
  });

  it('refuses a cell another building already occupies', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = plotNear(simulation, 6);
    simulation.placeBuilding('house', origin);

    const check = simulation.canPlaceBuilding('house', { gx: origin.gx + 1, gy: origin.gy + 1 });
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
    const origin = plotNear(simulation);

    const site = simulation.placeBuilding('house', origin)!;

    // Builders and haulers must be able to reach the middle of their own site.
    const inside = { gx: origin.gx + 1, gy: origin.gy + 1 };
    expect(simulation.world.isWalkable(inside)).toBe(true);

    simulation.world.buildings.complete(simulation.world, site);

    expect(simulation.world.isWalkable(inside)).toBe(false);
  });
});

describe('construction', () => {
  it('starts a site empty and unbuilt', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = plotNear(simulation);

    const site = simulation.placeBuilding('house', origin)!;

    expect(site.isComplete).toBe(false);
    expect(site.materials.isEmpty).toBe(true);
    expect(site.hasAllMaterials).toBe(false);
    expect(simulation.snapshot().sitesUnderConstruction).toBe(1);
  });

  it('knows what it still needs', () => {
    const simulation = new Simulation(OPTIONS);
    const site = simulation.placeBuilding('house', plotNear(simulation))!;
    const cost = buildingDefinition('house').constructionCost;

    expect(site.stillNeeds('logs')).toBe(cost.find((c) => c.resource === 'logs')!.amount);

    site.materials.add('logs', 3);
    expect(site.stillNeeds('logs')).toBe(cost.find((c) => c.resource === 'logs')!.amount - 3);
  });

  it('will not build without materials, however long it waits', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = plotNear(simulation);
    // Strip the settlers' supplies — the store *and* the bundles they set down on
    // the ground, since a site is built from either. The settlement genuinely has
    // nothing.
    strip(simulation);
    const site = simulation.placeBuilding('house', origin)!;

    for (let tick = 1; tick <= 3000; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(site.isComplete).toBe(false);
  });

  it('villagers carry materials from the yard to the site', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = plotNear(simulation, 8);
    stock(simulation, 'logs', 40);
    stock(simulation, 'stone', 20);
    const site = simulation.placeBuilding('house', { gx: origin.gx + 2, gy: origin.gy + 2 })!;

    for (let tick = 1; tick <= 12000 && !site.hasAllMaterials; tick += 1) {
      simulation.update(tick, TICK);
    }

    // The materials physically arrived; they were not deducted in place.
    expect(site.hasAllMaterials).toBe(true);
  });

  it('completes a house once materials and labour are done', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = plotNear(simulation, 8);
    stock(simulation, 'logs', 40);
    stock(simulation, 'stone', 20);
    const site = simulation.placeBuilding('house', { gx: origin.gx + 2, gy: origin.gy + 2 })!;

    for (let tick = 1; tick <= 30000 && !site.isComplete; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(site.isComplete).toBe(true);
    expect(simulation.snapshot().housingCapacity).toBe(buildingDefinition('house').housing);
  });

  it('takes the materials out of the settlement, not out of nowhere', () => {
    // Counted across the store *and* the ground, because a site now draws from
    // whichever is nearer. What must be true either way is that the timber came
    // from somewhere real: the settlement is poorer by what the walls are made of.
    const simulation = new Simulation(OPTIONS);
    const origin = plotNear(simulation, 8);
    stock(simulation, 'logs', 40);
    stock(simulation, 'stone', 20);
    const before = logsEverywhere(simulation);
    const site = simulation.placeBuilding('house', { gx: origin.gx + 2, gy: origin.gy + 2 })!;

    for (let tick = 1; tick <= 30000 && !site.isComplete; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(site.isComplete).toBe(true);
    expect(logsEverywhere(simulation)).toBeLessThan(before);
  });

  it('builds out of a pile on the ground, with nothing in any store', () => {
    // **What the settlers' own bundles made necessary.** A site used to be
    // suppliable only from a yard, so timber lying twenty paces away had to be
    // carried *past* the site into a store and then carried back out again — and
    // the bundle the settlers set down could not be touched until somebody had
    // tidied it away. Anything the settlement physically has and can walk to is
    // now fair game.
    const simulation = new Simulation(OPTIONS);
    const origin = plotNear(simulation, 8);
    strip(simulation);

    const cost = buildingDefinition('house').constructionCost;
    for (const entry of cost) {
      simulation.world.dropNear(origin, entry.resource, entry.amount);
    }
    expect(simulation.storages.totalOf('logs')).toBe(0);

    const site = simulation.placeBuilding('house', { gx: origin.gx + 2, gy: origin.gy + 2 })!;
    for (let tick = 1; tick <= 30000 && !site.isComplete; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(site.isComplete).toBe(true);
  });

  it('does not walk past a pile at its feet to fetch from a yard', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = plotNear(simulation, 8);
    stock(simulation, 'logs', 40);
    stock(simulation, 'stone', 20);

    const plot = { gx: origin.gx + 2, gy: origin.gy + 2 };
    const site = simulation.placeBuilding('house', plot)!;
    simulation.world.dropNear(site.accessCell, 'logs', 20);
    simulation.update(1, TICK);

    const delivery = simulation.jobs.all.find(
      (job) =>
        job.type === 'haul' &&
        job.haulResource === 'logs' &&
        job.deliverTo?.gx === site.accessCell.gx &&
        job.deliverTo?.gy === site.accessCell.gy,
    );

    expect(delivery?.haulSource).toBe('pile');
  });

  it('reports footprint cells correctly', () => {
    const simulation = new Simulation(OPTIONS);
    const origin = plotNear(simulation, 6);
    const yard = simulation.placeBuilding('storage-yard', origin)!;

    expect(yard.cells()).toHaveLength(9);
    expect(yard.cells()).toContainEqual({ gx: origin.gx + 2, gy: origin.gy + 2 });
  });

  it('stays deterministic through a full build', () => {
    const play = (): string => {
      const simulation = new Simulation(OPTIONS);
      const origin = plotNear(simulation, 8);
      stock(simulation, 'logs', 40);
      stock(simulation, 'stone', 20);
      const site = simulation.placeBuilding('house', { gx: origin.gx + 2, gy: origin.gy + 2 })!;
      for (let tick = 1; tick <= 6000; tick += 1) {
        simulation.update(tick, TICK);
      }
      return `${site.isComplete}|${site.buildTicksRemaining}|${simulation.snapshot().stored.logs}`;
    };

    expect(play()).toBe(play());
  });
});
