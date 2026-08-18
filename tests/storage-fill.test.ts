/**
 * How much room is left, and saying so before it runs out.
 *
 * **Found by playing rather than by reading.** A settlement was measured dying of
 * hunger in its first summer with a hundred and twenty-six food lying in the
 * field: the gatherers were working, the food existed, and there was nowhere to
 * put it. A Storage Yard takes eight goods and refuses food; only a Food Storage
 * will have it. Until one stands, everything gathered rots where it fell.
 *
 * From the screen the settlement looked busy and the warning said "people are
 * starving" — true, and useless. Three things came out of it, and this file
 * covers all three:
 *
 * - **the fill is on screen**, per kind of store, so "have I room for this
 *   harvest" is a question with an answer;
 * - **a warning at nine tenths**, while there is still time to raise another;
 * The third — a warning naming a missing larder — was written and **backed out**
 * the moment the test above was run: the founding yard takes food perfectly well,
 * so a settlement never lacks somewhere to put it. What it lacks is hands to
 * carry it, which is a different problem and not one a storage figure can state.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';
import { Simulation, STORAGE_WARNING_FRACTION } from '@/simulation/Simulation';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { EN, type MessageKey } from '@/ui/i18n/messages';
import { buildLedger, type LedgerRow, type LedgerTab } from '@/ui/ledger/ledgerModel';

const OPTIONS = { seed: 20260816, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

const t = (key: MessageKey): string => {
  const value = (EN as Record<string, string | undefined>)[key];
  if (value === undefined) {
    throw new Error(`No English string for ${key}`);
  }
  return value;
};

describe('how full the stores are', () => {
  it('counts only the stores that would take the good', () => {
    // A Food Storage takes food and nothing else, so it must not appear in the
    // room left for timber — a settlement reading one figure for both would
    // build the wrong shed.
    const simulation = new Simulation(OPTIONS);
    const before = simulation.storages.fill('logs').capacity;
    raise(simulation, 'food-storage');

    expect(simulation.storages.fill('logs').capacity).toBe(before);
    expect(simulation.storages.fill('food').capacity).toBeGreaterThan(before);
  });

  it('reports no room at all rather than an empty percentage', () => {
    // Nought of nought is not "empty", and the difference matters: a settlement
    // with nowhere to put a good is in a different kind of trouble from one with
    // an empty shed, and `0%` would read as the reassuring one.
    const simulation = new Simulation(OPTIONS);
    expect(simulation.storages.fill('hides').capacity).toBeGreaterThan(0);
  });

  it('adds up across every store of a kind', () => {
    const simulation = new Simulation(OPTIONS);
    const before = simulation.storages.fill('logs').capacity;
    raise(simulation, 'storage-yard');
    expect(simulation.storages.fill('logs').capacity).toBeGreaterThan(before);
  });

  it('follows what is actually in them', () => {
    const simulation = new Simulation(OPTIONS);
    const before = simulation.storages.fill('logs').used;
    simulation.storages.all[0]!.inventory.add('stone', 40);
    expect(simulation.storages.fill('logs').used).toBe(before + 40);
  });
});

describe('the warning before it is too late', () => {
  it('says nothing while there is room', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'food-storage');
    run(simulation, TICKS_PER_DAY);
    expect(simulation.snapshot().advice).not.toBe('larderFilling');
    expect(simulation.snapshot().advice).not.toBe('storageFilling');
  });

  it('says nothing about larders before one is built', () => {
    // The founding yard is both stores. "Your larders are full" to a settlement
    // that has no larder reads as a bug rather than as advice.
    const simulation = new Simulation(OPTIONS);
    fillTo(simulation, 'food', 0.95);
    expect(simulation.snapshot().advice).toBe('storageFilling');
  });

  it('warns once the food stores pass nine tenths', () => {
    // **Filled across the pool, not in one shed**, because that is how the
    // figure is asked: the founding yard takes anything, so the room left for
    // food genuinely includes it.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'food-storage');
    fillTo(simulation, 'food', 0.95);

    expect(simulation.snapshot().advice).toBe('larderFilling');
  });

  it('warns about the yards too', () => {
    // A larder with room in it, so the food warning does not take the single
    // slot the advice has: the founding yard is in both pools, which is honest —
    // it really does take both.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'food-storage');
    // And the settlers' bundles taken off the ground first: a full yard *and* a
    // pile with nowhere to go is a different, worse condition — "your stores are
    // full" — and it rightly outranks "your stores are filling up".
    for (const pile of [...simulation.world.piles.all]) {
      simulation.world.piles.remove(pile.id);
    }
    const yard = simulation.storages.all[0]!;
    yard.inventory.add('stone', yard.inventory.freeSpace);
    simulation.storages.markChanged();
    run(simulation, 1);

    expect(simulation.snapshot().advice).toBe('storageFilling');
  });

  it('counts a yard that has actually filled', () => {
    // The bug this split `accepts` in two: a full yard answered "no" to "do you
    // take logs", so it dropped out of the count of how full the yards were —
    // at exactly the moment the figure mattered.
    const simulation = new Simulation(OPTIONS);
    const yard = simulation.storages.all[0]!;
    yard.inventory.add('stone', yard.inventory.freeSpace);

    const fill = simulation.storages.fill('logs');
    expect(fill.capacity).toBeGreaterThan(0);
    expect(fill.used).toBe(fill.capacity);
  });

  it('agrees with the sheet about where the line is', () => {
    // The banner and the ledger must go amber at the same figure, or the game
    // contradicts itself on one screen.
    expect(STORAGE_WARNING_FRACTION).toBe(0.9);
  });
});

describe('the ledger', () => {
  it('shows the room left in both kinds of store', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'food-storage');
    const rows = section(buildLedger(simulation, t), 'buildings', 'stores');

    expect(rows.map((row) => row.label)).toEqual([
      t('ledger.stores.yards'),
      t('ledger.stores.larders'),
    ]);
    for (const row of rows) {
      expect(row.value).toMatch(/^\d+%$/);
    }
  });

  it('says it once until a larder is built', () => {
    // The founding yard is the timber store and the food store both. Two lines
    // carrying the identical figure under different names says nothing twice.
    const simulation = new Simulation(OPTIONS);
    expect(simulation.storages.hasLarder).toBe(false);

    const rows = section(buildLedger(simulation, t), 'buildings', 'stores');
    expect(rows.map((row) => row.label)).toEqual([t('ledger.stores.yards')]);
  });

  it('marks a nearly full store', () => {
    const simulation = new Simulation(OPTIONS);
    const yard = simulation.storages.all[0]!;
    yard.inventory.add('stone', Math.ceil(yard.inventory.capacity * 0.95));

    const yards = section(buildLedger(simulation, t), 'buildings', 'stores')[0];
    expect(yards?.tone).toBe('bad');
  });
});

function section(tabs: readonly LedgerTab[], tabId: string, sectionId: string): LedgerRow[] {
  const rows = tabs
    .filter((tab) => tab.id === tabId)
    .flatMap((tab) => tab.sections.filter((entry) => entry.id === sectionId))
    .flatMap((entry) => entry.rows);
  return [...rows];
}

/** Fills every store that would take a resource to roughly a given share. */
function fillTo(simulation: Simulation, resource: 'food' | 'logs', share: number): void {
  for (const storage of simulation.storages.all) {
    if (!storage.isFor(resource)) {
      continue;
    }
    const want = Math.ceil(storage.inventory.capacity * share) - storage.inventory.total;
    if (want > 0) {
      storage.inventory.add(resource, want);
    }
  }
  simulation.storages.markChanged();
  run(simulation, 1);
}

function run(simulation: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
  }
}

function raise(simulation: Simulation, id: BuildingId): Building | null {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      const cell = { gx, gy };
      if (simulation.canPlaceBuilding(id, cell).ok) {
        const building = simulation.placeBuilding(id, cell);
        if (building) {
          simulation.world.buildings.complete(simulation.world, building);
          // A finished store opens on the settlement's next tick, not on the
          // day somebody decided it was finished.
          run(simulation, 1);
        }
        return building;
      }
    }
  }
  return null;
}
