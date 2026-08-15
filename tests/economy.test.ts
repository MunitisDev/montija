import { describe, expect, it } from 'vitest';
import { RECIPES, recipe } from '@/data/recipes';
import { Simulation } from '@/simulation/Simulation';
import type { Building } from '@/simulation/buildings/Building';

const TICK = 0.1;
const OPTIONS = { seed: 20260815, worldWidth: 48, worldHeight: 48, startingVillagers: 10 };

function clearArea(simulation: Simulation, origin: { gx: number; gy: number }, size = 8) {
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      const cell = { gx: origin.gx + dx, gy: origin.gy + dy };
      const tree = simulation.world.trees.getAt(cell);
      if (tree) simulation.world.trees.remove(tree.id);
      simulation.world.terrain.set(cell.gx, cell.gy, 'grass');
      simulation.world.navigation.refreshCell(simulation.world.terrain, cell.gx, cell.gy);
    }
  }
}

/** Places a finished workshop, skipping construction so tests stay focused. */
function standingBuilding(simulation: Simulation, id: 'gatherer-hut' | 'woodcutter'): Building {
  clearArea(simulation, { gx: 30, gy: 30 });
  const building = simulation.placeBuilding(id, { gx: 32, gy: 32 })!;
  simulation.world.buildings.complete(simulation.world, building);
  return building;
}

describe('recipes', () => {
  it('defines the two the brief calls for', () => {
    expect(recipe('forage-food')).not.toBeNull();
    expect(recipe('split-firewood')).not.toBeNull();
  });

  it('turns logs into more firewood than it consumes', () => {
    const split = RECIPES['split-firewood']!;
    expect(split.inputs[0]!.resource).toBe('logs');
    expect(split.outputs[0]!.resource).toBe('firewood');
    expect(split.outputs[0]!.amount).toBeGreaterThan(split.inputs[0]!.amount);
  });

  it('returns null for an unknown recipe rather than throwing', () => {
    expect(recipe('nonsense')).toBeNull();
  });
});

describe('production', () => {
  it('a gatherer hut produces food through actual worker activity', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = standingBuilding(simulation, 'gatherer-hut');

    for (let tick = 1; tick <= 20000; tick += 1) {
      simulation.update(tick, TICK);
      if (simulation.snapshot().stored.food > 0) break;
    }

    expect(simulation.snapshot().stored.food).toBeGreaterThan(0);
    expect(hut.definition.recipeId).toBe('forage-food');
  });

  it('drops produced goods on the ground, not straight into storage', () => {
    const simulation = new Simulation(OPTIONS);
    standingBuilding(simulation, 'gatherer-hut');

    // Catch the moment food exists but has not been hauled in yet.
    let sawLoose = 0;
    for (let tick = 1; tick <= 8000; tick += 1) {
      simulation.update(tick, TICK);
      sawLoose = Math.max(sawLoose, simulation.snapshot().loose.food);
      if (sawLoose > 0) break;
    }

    expect(sawLoose).toBeGreaterThan(0);
  });

  it('a woodcutter will not make firewood without logs', () => {
    const simulation = new Simulation(OPTIONS);
    standingBuilding(simulation, 'woodcutter');
    // Deliberately no logs anywhere.

    for (let tick = 1; tick <= 5000; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.snapshot().stored.firewood).toBe(0);
    expect(simulation.snapshot().loose.firewood).toBe(0);
  });

  it('a woodcutter turns hauled logs into firewood', () => {
    const simulation = new Simulation(OPTIONS);
    standingBuilding(simulation, 'woodcutter');
    simulation.storages.all[0]!.inventory.add('logs', 60);
    simulation.storages.markChanged();

    let made = 0;
    for (let tick = 1; tick <= 30000; tick += 1) {
      simulation.update(tick, TICK);
      const snapshot = simulation.snapshot();
      made = snapshot.stored.firewood + snapshot.loose.firewood;
      if (made > 0) break;
    }

    expect(made).toBeGreaterThan(0);
  });

  it('consumes the logs it splits', () => {
    const simulation = new Simulation(OPTIONS);
    standingBuilding(simulation, 'woodcutter');
    simulation.storages.all[0]!.inventory.add('logs', 60);
    simulation.storages.markChanged();
    const before = simulation.snapshot().stored.logs;

    for (let tick = 1; tick <= 30000; tick += 1) {
      simulation.update(tick, TICK);
      if (simulation.snapshot().stored.firewood > 0) break;
    }

    expect(simulation.snapshot().stored.logs).toBeLessThan(before);
  });

  it('exposes worker slots from the building definition', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = standingBuilding(simulation, 'gatherer-hut');

    expect(hut.definition.workerSlots).toBeGreaterThan(0);
    expect(hut.needsWorker).toBe(true);
  });

  it('produces nothing at all without a workshop', () => {
    const simulation = new Simulation(OPTIONS);

    for (let tick = 1; tick <= 4000; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.snapshot().stored.food).toBe(0);
    expect(simulation.snapshot().stored.firewood).toBe(0);
  });

  it('stays deterministic while producing', () => {
    const play = (): string => {
      const simulation = new Simulation(OPTIONS);
      standingBuilding(simulation, 'gatherer-hut');
      for (let tick = 1; tick <= 5000; tick += 1) simulation.update(tick, TICK);
      const s = simulation.snapshot();
      return `${s.stored.food}|${s.loose.food}|${s.jobsCompleted}`;
    };

    expect(play()).toBe(play());
  });
});
