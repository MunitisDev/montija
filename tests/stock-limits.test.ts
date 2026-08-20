/**
 * The ceilings a player can put on their own stores.
 *
 * **The one thing a player could not say to this game was "enough".** A quarry
 * with two masons cut stone for ever, into a yard that already held five hundred
 * of it, and the only way to stop it was to take the masons off by hand and
 * remember why. A limit says it once and keeps saying it.
 *
 * What is tested here is mostly the *edges of the instruction*, because that is
 * where a standing order goes wrong: that it frees the people rather than
 * leaving them miming work, that a recipe with two outputs is not stopped for
 * one of them, that lowering it takes effect on the tap rather than at the end
 * of the batch, and that it survives a reload — a settlement that forgot its
 * limits every time the browser closed would be worse than not having them.
 */

import { describe, expect, it } from 'vitest';

import { Simulation } from '@/simulation/Simulation';
import { StockLimits } from '@/simulation/logistics/StockLimits';
import { restore, serialise } from '@/simulation/save/serialise';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { LIMIT_LADDER, atCeiling, atFloor, nextLimit } from '@/ui/hud/stockLimit';
import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';
import type { GridPoint } from '@/shared/types/geometry';

const OPTIONS = { seed: 20260820, worldWidth: 96, worldHeight: 96, startingVillagers: 10 };

describe('a ceiling on a good', () => {
  it('is absent until the player sets one', () => {
    const limits = new StockLimits();
    expect(limits.get('stone')).toBeNull();
    expect(limits.reached('stone', 10_000)).toBe(false);
  });

  it('is kept whole, and never negative', () => {
    const limits = new StockLimits();
    limits.set('stone', 199.6);
    expect(limits.get('stone')).toBe(200);
    limits.set('stone', -5);
    expect(limits.get('stone')).toBe(0);
  });

  it('tells nothing from no limit', () => {
    // Zero is a real instruction — *make no more of this at all* — and folding
    // it into "no limit" would make the bottom of the stepper mean the opposite
    // of what it says.
    const limits = new StockLimits();
    limits.set('stone', 0);
    expect(limits.get('stone')).toBe(0);
    expect(limits.reached('stone', 0)).toBe(true);

    limits.set('stone', null);
    expect(limits.get('stone')).toBeNull();
    expect(limits.reached('stone', 0)).toBe(false);
  });

  it('is reached at the figure, not past it', () => {
    const limits = new StockLimits();
    limits.set('vegetables', 200);
    expect(limits.reached('vegetables', 199)).toBe(false);
    expect(limits.reached('vegetables', 200)).toBe(true);
  });
});

describe('a workshop under a ceiling', () => {
  it('stops posting work, and hands its people back', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    simulation.setDesiredWorkers(hut.id, hut.definition.workerSlots);
    runDays(simulation, 3);
    expect(producing(simulation, hut.id)).toBeGreaterThan(0);

    // Whatever is on the shelves is already too much.
    simulation.setStockLimit('spices', 0);
    runDays(simulation, 1);

    expect(producing(simulation, hut.id)).toBe(0);
    expect(simulation.productionHaltedBy(hut.id)).toBe('spices');
  });

  it('starts again by itself once the stores fall', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    simulation.setDesiredWorkers(hut.id, hut.definition.workerSlots);
    // Long enough to have *carried something in*, not merely to have foraged
    // it: a heap beside the hut is not stock, and "stopped" and "has not started
    // yet" would otherwise be the same state and this would prove nothing.
    runDays(simulation, 6);
    const stocked = simulation.snapshot().stored.spices;
    expect(stocked).toBeGreaterThan(0);

    simulation.setStockLimit('spices', stocked);
    runDays(simulation, 1);
    expect(producing(simulation, hut.id)).toBe(0);

    // The settlement eats. Emptied by hand rather than waited out, so what is
    // being tested is the rule and not how long ten people take to get through a
    // barrel of dried roots.
    for (const storage of simulation.storages.all) {
      storage.inventory.remove('spices', storage.inventory.count('spices'));
    }
    simulation.storages.markChanged();

    // One tick, not a day: the work goes back on the board the moment the stores
    // are under the ceiling, and a whole day would let the heaps still lying
    // beside the hut be carried in and put it back over.
    simulation.update(simulation.tick + 1, 0.1);
    // Nobody touched the lever: the ceiling is still set, and the hut went back
    // to work on its own. That self-starting is the whole reason a limit beats
    // taking the workers off by hand.
    expect(simulation.stockLimits.get('spices')).toBe(stocked);
    expect(producing(simulation, hut.id)).toBeGreaterThan(0);
  });

  it('is not stopped for one of two goods it makes', () => {
    // A Hunter's meat may be capped while its hides are the only ones the
    // settlement has. Stopping it would take the coats with the venison.
    const simulation = new Simulation(OPTIONS);
    const cabin = raise(simulation, 'hunter');
    simulation.setDesiredWorkers(cabin.id, cabin.definition.workerSlots);
    simulation.setStockLimit('meat', 0);
    runDays(simulation, 3);

    expect(simulation.productionHaltedBy(cabin.id)).toBeNull();
    expect(producing(simulation, cabin.id)).toBeGreaterThan(0);
  });

  it('leaves what the player marked by hand alone', () => {
    // A tree marked for felling is an order, not a suggestion. A limit that
    // cancelled orders would be the game arguing with the player rather than
    // carrying out a standing instruction.
    const simulation = new Simulation(OPTIONS);
    simulation.setStockLimit('logs', 0);
    const tree = [...simulation.world.trees.all].find((candidate) =>
      simulation.world.trees.isMature(candidate),
    );
    expect(tree).toBeDefined();
    expect(simulation.designateTreeForFelling({ gx: tree!.gx, gy: tree!.gy })).toBe(true);
    expect(simulation.jobs.all.some((job) => job.type === 'chop-tree')).toBe(true);
  });
});

describe('a ceiling being moved', () => {
  it('takes work off the board the moment it is lowered', () => {
    // Not at the end of the batch: the player has just pulled a lever and the
    // settlement they are looking at has to obey it.
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    simulation.setDesiredWorkers(hut.id, hut.definition.workerSlots);
    runDays(simulation, 3);
    expect(producing(simulation, hut.id)).toBeGreaterThan(0);

    simulation.setStockLimit('spices', 0);
    expect(producing(simulation, hut.id)).toBe(0);
  });

  it('reports whether it changed anything, so the UI can skip a redraw', () => {
    const simulation = new Simulation(OPTIONS);
    expect(simulation.setStockLimit('stone', 200)).toBe(true);
    expect(simulation.setStockLimit('stone', 200)).toBe(false);
    expect(simulation.setStockLimit('stone', null)).toBe(true);
    expect(simulation.setStockLimit('stone', null)).toBe(false);
  });

  it('comes back after a reload', () => {
    const simulation = new Simulation(OPTIONS);
    simulation.setStockLimit('stone', 200);
    simulation.setStockLimit('spices', 0);

    const loaded = new Simulation(OPTIONS);
    loaded.setStockLimit('iron', 50);
    restore(loaded, serialise(simulation, 'now'));

    expect(loaded.stockLimits.get('stone')).toBe(200);
    expect(loaded.stockLimits.get('spices')).toBe(0);
    // And the session's own limits are gone rather than left standing over a
    // settlement that never set them.
    expect(loaded.stockLimits.get('iron')).toBeNull();
  });
});

describe('the stepper the player actually touches', () => {
  it('lands near what the settlement already has, on the first tap', () => {
    // Coming down from "no limit", 2000 and eleven more taps is not an
    // instrument. A player with 180 stone means "about this much".
    expect(nextLimit(null, -1, 180)).toBe(200);
    expect(nextLimit(null, -1, 0)).toBe(0);
    expect(nextLimit(null, -1, 99_999)).toBe(LIMIT_LADDER.at(-1));
  });

  it('steps along the ladder after that', () => {
    expect(nextLimit(200, -1, 0)).toBe(150);
    expect(nextLimit(200, 1, 0)).toBe(300);
  });

  it('has no limit above the top rung, and stops at nothing below the bottom', () => {
    expect(nextLimit(LIMIT_LADDER.at(-1) ?? 0, 1, 0)).toBeNull();
    expect(nextLimit(0, -1, 0)).toBe(0);
    expect(atFloor(0)).toBe(true);
    expect(atCeiling(null)).toBe(true);
    expect(atFloor(25)).toBe(false);
    expect(atCeiling(25)).toBe(false);
  });

  it('raising from no limit does nothing at all', () => {
    expect(nextLimit(null, 1, 0)).toBeNull();
  });
});

// --- helpers ---------------------------------------------------------------

function producing(simulation: Simulation, buildingId: number): number {
  return simulation.jobs.all.filter(
    (job) => job.type === 'produce' && job.targetEntityId === buildingId,
  ).length;
}

function runDays(simulation: Simulation, days: number): void {
  for (let tick = 0; tick < TICKS_PER_DAY * days; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
  }
}

/** Puts a finished building up near the camp. */
function raise(simulation: Simulation, id: BuildingId): Building {
  const from = simulation.world.landfallCell;
  for (let radius = 2; radius < 26; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const origin: GridPoint = { gx: from.gx + dx, gy: from.gy + dy };
        const building = simulation.world.buildings.place(simulation.world, id, origin);
        if (building) {
          simulation.world.buildings.complete(simulation.world, building);
          return building;
        }
      }
    }
  }
  throw new Error(`nowhere to put a ${id}`);
}
