import { describe, expect, it } from 'vitest';
import { Simulation } from '@/simulation/Simulation';
import { SAVE_VERSION, validateSave } from '@/simulation/save/SaveGame';
import { restore, serialise } from '@/simulation/save/serialise';
import { MemorySaveStore } from '@/simulation/save/SaveStore';

const TICK = 0.1;
const OPTIONS = { seed: 20260815, worldWidth: 32, worldHeight: 32, startingVillagers: 10 };

/** Runs a settlement for a while so there is real state worth saving. */
function playedSimulation(ticks = 900): Simulation {
  const simulation = new Simulation(OPTIONS);
  for (const tree of [...simulation.world.trees.all].slice(0, 6)) {
    simulation.designateTreeForFelling({ gx: tree.gx, gy: tree.gy });
  }
  for (let tick = 1; tick <= ticks; tick += 1) {
    simulation.update(tick, TICK);
  }
  return simulation;
}

/** Everything a player would notice, as one comparable string. */
function fingerprint(simulation: Simulation): string {
  const snapshot = simulation.snapshot();
  return [
    snapshot.tick,
    snapshot.villagerCount,
    snapshot.treeCount,
    snapshot.pileCount,
    snapshot.buildingCount,
    snapshot.stored.logs,
    snapshot.loose.logs,
    snapshot.season,
    snapshot.deaths,
    simulation.villagers.all
      .map(
        (v) => `${v.id}:${v.position.wx.toFixed(4)},${v.position.wy.toFixed(4)}:${v.needs.health}`,
      )
      .join(','),
    [...simulation.world.trees.all].map((t) => t.id).join(','),
    simulation.jobs.all.map((j) => `${j.id}${j.type}${j.state}`).join(','),
  ].join('|');
}

describe('save format', () => {
  it('stamps the current version', () => {
    expect(serialise(new Simulation(OPTIONS), 'now').version).toBe(SAVE_VERSION);
  });

  it('refuses a save from a future version', () => {
    const save = { ...serialise(new Simulation(OPTIONS), 'now'), version: SAVE_VERSION + 1 };
    const result = validateSave(save);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.kind).toBe('unsupported-version');
  });

  it('refuses something that is not a save at all', () => {
    expect(validateSave(null).ok).toBe(false);
    expect(validateSave(42).ok).toBe(false);
    expect(validateSave({ version: SAVE_VERSION }).ok).toBe(false);
  });

  it('survives JSON, holding no class instances', () => {
    const save = serialise(playedSimulation(), 'now');
    const roundTripped = JSON.parse(JSON.stringify(save));

    expect(validateSave(roundTripped).ok).toBe(true);
  });

  it('contains no Phaser or renderer state', () => {
    const raw = JSON.stringify(serialise(playedSimulation(), 'now'));

    expect(raw).not.toMatch(/phaser|sprite|texture|camera/i);
  });
});

describe('round trip', () => {
  it('restores a played settlement exactly', () => {
    const original = playedSimulation();
    const save = JSON.parse(JSON.stringify(serialise(original, 'now')));
    const before = fingerprint(original);

    const loaded = new Simulation(OPTIONS);
    restore(loaded, save);

    expect(fingerprint(loaded)).toBe(before);
  });

  it('keeps running identically after loading', () => {
    const original = playedSimulation();
    const save = JSON.parse(JSON.stringify(serialise(original, 'now')));

    const loaded = new Simulation(OPTIONS);
    restore(loaded, save);

    // Both continue from the same tick; they must stay in step.
    for (let i = 1; i <= 300; i += 1) {
      const tick = original.tick + 1;
      original.update(tick, TICK);
      loaded.update(tick, TICK);
    }

    expect(fingerprint(loaded)).toBe(fingerprint(original));
  });

  it('restores terrain the villagers changed, not the generated terrain', () => {
    const simulation = new Simulation(OPTIONS);
    const tree = [...simulation.world.trees.all][0]!;
    const cell = { gx: tree.gx, gy: tree.gy };
    expect(simulation.world.terrainAt(cell)).toBe('forest');
    simulation.world.fellTree(tree.id);

    const save = JSON.parse(JSON.stringify(serialise(simulation, 'now')));
    const loaded = new Simulation(OPTIONS);
    restore(loaded, save);

    // Regenerating from the seed would put the forest back.
    expect(loaded.world.terrainAt(cell)).toBe('grass');
    expect(loaded.world.trees.getById(tree.id)).toBeNull();
  });

  it('restores buildings, their blocking and their stores', () => {
    const simulation = new Simulation(OPTIONS);
    for (let dy = 0; dy < 6; dy += 1) {
      for (let dx = 0; dx < 6; dx += 1) {
        const cell = { gx: 10 + dx, gy: 10 + dy };
        const tree = simulation.world.trees.getAt(cell);
        if (tree) simulation.world.trees.remove(tree.id);
        simulation.world.terrain.set(cell.gx, cell.gy, 'grass');
        simulation.world.navigation.refreshCell(simulation.world.terrain, cell.gx, cell.gy);
      }
    }
    const building = simulation.placeBuilding('house', { gx: 11, gy: 11 })!;
    building.materials.add('logs', 3);
    simulation.world.buildings.complete(simulation.world, building);

    const save = JSON.parse(JSON.stringify(serialise(simulation, 'now')));
    const loaded = new Simulation(OPTIONS);
    restore(loaded, save);

    const restored = loaded.world.buildings.getById(building.id)!;
    expect(restored.isComplete).toBe(true);
    expect(loaded.world.isWalkable({ gx: 11, gy: 11 })).toBe(false);
    expect(loaded.snapshot().housingCapacity).toBe(simulation.snapshot().housingCapacity);
  });

  it('restores what villagers were carrying', () => {
    const simulation = playedSimulation(1500);
    const carriedBefore = simulation.villagers.all.reduce((sum, v) => sum + v.inventory.total, 0);

    const save = JSON.parse(JSON.stringify(serialise(simulation, 'now')));
    const loaded = new Simulation(OPTIONS);
    restore(loaded, save);

    const carriedAfter = loaded.villagers.all.reduce((sum, v) => sum + v.inventory.total, 0);
    expect(carriedAfter).toBe(carriedBefore);
  });

  it('restores the calendar from the tick alone', () => {
    const simulation = playedSimulation(3000);
    const save = JSON.parse(JSON.stringify(serialise(simulation, 'now')));

    const loaded = new Simulation(OPTIONS);
    restore(loaded, save);

    expect(loaded.year).toEqual(simulation.year);
  });
});

describe('save store', () => {
  it('writes and reads a save back', async () => {
    const store = new MemorySaveStore();
    const save = serialise(playedSimulation(), 'now');

    await store.write('slot-1', save);
    const result = await store.read('slot-1');

    expect(result.ok).toBe(true);
    expect(result.ok && result.save.simulationTime).toBe(save.simulationTime);
  });

  it('reports a missing slot rather than throwing', async () => {
    const result = await new MemorySaveStore().read('nothing-here');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.kind).toBe('missing');
  });

  it('knows whether a slot exists', async () => {
    const store = new MemorySaveStore();
    expect(await store.has('slot-1')).toBe(false);

    await store.write('slot-1', serialise(new Simulation(OPTIONS), 'now'));
    expect(await store.has('slot-1')).toBe(true);
  });

  it('deletes a slot', async () => {
    const store = new MemorySaveStore();
    await store.write('slot-1', serialise(new Simulation(OPTIONS), 'now'));

    await store.remove('slot-1');

    expect(await store.has('slot-1')).toBe(false);
  });

  it('overwrites a slot rather than accumulating', async () => {
    const store = new MemorySaveStore();
    await store.write('slot-1', serialise(playedSimulation(300), 'first'));
    const second = serialise(playedSimulation(900), 'second');
    await store.write('slot-1', second);

    const result = await store.read('slot-1');
    expect(result.ok && result.save.savedAt).toBe('second');
  });
});
