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

  it('a woodcutter makes no firewood until logs exist', () => {
    // **Rewritten when the woodcutter learned to fell its own timber.** The old
    // version stripped the stores and asserted no firewood ever appeared, which
    // stopped being true the moment the workshop could go and get wood — and it
    // was testing the supply, not the rule. The rule is that a recipe cannot run
    // without its inputs, and that is still exactly true: firewood may not
    // appear before a log has.
    const simulation = new Simulation(OPTIONS);
    standingBuilding(simulation, 'woodcutter');
    simulation.storages.all[0]!.inventory.clear();
    simulation.storages.markChanged();

    let firstLog = Number.POSITIVE_INFINITY;
    let firstFirewood = Number.POSITIVE_INFINITY;
    for (let tick = 1; tick <= 5000; tick += 1) {
      simulation.update(tick, TICK);
      const snapshot = simulation.snapshot();
      if (firstLog === Number.POSITIVE_INFINITY && snapshot.stored.logs + snapshot.loose.logs > 0) {
        firstLog = tick;
      }
      if (
        firstFirewood === Number.POSITIVE_INFINITY &&
        snapshot.stored.firewood + snapshot.loose.firewood > 0
      ) {
        firstFirewood = tick;
      }
    }

    expect(firstLog).toBeLessThan(firstFirewood);
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
    // Counted across the store and the ground together: the settlers' own bundles
    // are on the ground at the start and get carried in while this runs, so the
    // store's figure rises and falls for reasons that have nothing to do with the
    // woodcutter. What must hold is that the settlement is poorer in timber by
    // whatever the firewood was made of.
    const simulation = new Simulation(OPTIONS);
    standingBuilding(simulation, 'woodcutter');
    simulation.storages.all[0]!.inventory.add('logs', 60);
    simulation.storages.markChanged();
    const logs = (): number => {
      const snapshot = simulation.snapshot();
      return snapshot.stored.logs + snapshot.loose.logs;
    };
    const before = logs();

    for (let tick = 1; tick <= 30000; tick += 1) {
      simulation.update(tick, TICK);
      if (simulation.snapshot().stored.firewood > 0) break;
    }

    expect(simulation.snapshot().stored.firewood).toBeGreaterThan(0);
    expect(logs()).toBeLessThan(before);
  });

  it('exposes worker slots from the building definition', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = standingBuilding(simulation, 'gatherer-hut');

    expect(hut.definition.workerSlots).toBeGreaterThan(0);
    expect(hut.needsWorker).toBe(true);
  });

  it('produces nothing at all without a workshop', () => {
    const simulation = new Simulation(OPTIONS);
    const before = simulation.snapshot().stored.food;

    for (let tick = 1; tick <= 4000; tick += 1) {
      simulation.update(tick, TICK);
    }

    // Food only ever falls: it is eaten, and nothing replaces it.
    expect(simulation.snapshot().stored.food).toBeLessThanOrEqual(before);
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
