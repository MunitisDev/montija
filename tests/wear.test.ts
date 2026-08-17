/**
 * Spending a fraction of a thing a day, out of stores that hold whole things.
 *
 * **A player reported seeing decimals in their stores**, and they were right to.
 * Three things in this game wear out slowly and honestly — a tool lasts a worker
 * twenty days, a coat most of a winter, a healer gets through half a bundle per
 * patient — and until now that fraction came straight out of the yard. Ten
 * workers meant the settlement held 99.5 tools, then 99, then 98.5. A resource
 * here is a physical object somebody carried up a hill; there is no such thing as
 * half a tool.
 *
 * The fix is a **tab rather than a rounding**, and the difference is the whole
 * point of these tests: rounding each day to the nearest unit would make ten
 * workers spend either nothing or twenty times too much, depending which way it
 * fell. Carrying the remainder keeps the long-run rate exactly what the data
 * says.
 */

import { describe, expect, it } from 'vitest';

import type { ResourceId } from '@/data/resources';
import { Simulation } from '@/simulation/Simulation';
import { Inventory } from '@/simulation/resources/Inventory';
import { WearLedger } from '@/simulation/resources/wear';
import { restore, serialise } from '@/simulation/save/serialise';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';

const OPTIONS = { seed: 20260815, worldWidth: 48, worldHeight: 48, startingVillagers: 10 };

describe('a store holds whole things', () => {
  it('refuses to take in a fraction', () => {
    const inventory = new Inventory(100);
    expect(inventory.add('tools', 0.9)).toBe(0);
    expect(inventory.count('tools')).toBe(0);
  });

  it('keeps the whole part of a mixed amount', () => {
    const inventory = new Inventory(100);
    expect(inventory.add('tools', 3.7)).toBe(3);
    expect(inventory.count('tools')).toBe(3);
  });

  it('refuses to give out a fraction', () => {
    const inventory = new Inventory(100);
    inventory.add('tools', 5);
    expect(inventory.remove('tools', 0.35)).toBe(0);
    expect(inventory.count('tools')).toBe(5);
  });

  it('never leaves part of a thing behind', () => {
    const inventory = new Inventory(100);
    inventory.add('tools', 5);
    inventory.remove('tools', 2.9);
    expect(inventory.count('tools')).toBe(3);
  });
});

describe('the running tab', () => {
  it('takes nothing until a whole unit is owed', () => {
    const wear = new WearLedger();
    const shelf = new Inventory(100);
    shelf.add('tools', 10);
    const take = (resource: ResourceId, whole: number): number => shelf.remove(resource, whole);

    expect(wear.spend('tools', 0.5, take)).toBe(0);
    expect(shelf.count('tools')).toBe(10);
    expect(wear.debt('tools')).toBeCloseTo(0.5);

    expect(wear.spend('tools', 0.5, take)).toBe(1);
    expect(shelf.count('tools')).toBe(9);
    expect(wear.debt('tools')).toBeCloseTo(0);
  });

  it('keeps the long-run rate exactly', () => {
    // **The reason it is a tab and not a rounding.** Twenty days of ten workers
    // at a twentieth each is ten tools, and it has to be ten — not nought and
    // not two hundred.
    const wear = new WearLedger();
    const shelf = new Inventory(1000);
    shelf.add('tools', 500);
    const take = (resource: ResourceId, whole: number): number => shelf.remove(resource, whole);

    for (let day = 0; day < 200; day += 1) {
      wear.spend('tools', 10 * 0.05, take);
    }

    expect(500 - shelf.count('tools')).toBe(100);
  });

  it('goes on owing what the settlement could not pay', () => {
    // A village with no tools left still wore them out. It pays the moment it
    // forges some, because the work happened and the tools took the punishment.
    const wear = new WearLedger();
    const empty = new Inventory(100);
    const take = (resource: ResourceId, whole: number): number => empty.remove(resource, whole);

    for (let day = 0; day < 40; day += 1) {
      wear.spend('tools', 0.5, take);
    }
    expect(wear.debt('tools')).toBeCloseTo(20);

    empty.add('tools', 30);
    expect(wear.spend('tools', 0.5, take)).toBe(20);
    expect(empty.count('tools')).toBe(10);
  });

  it("keeps each resource's tab apart", () => {
    const wear = new WearLedger();
    const shelf = new Inventory(100);
    shelf.add('tools', 10);
    shelf.add('clothing', 10);
    const take = (resource: ResourceId, whole: number): number => shelf.remove(resource, whole);

    wear.spend('tools', 0.6, take);
    wear.spend('clothing', 0.3, take);

    expect(wear.debt('tools')).toBeCloseTo(0.6);
    expect(wear.debt('clothing')).toBeCloseTo(0.3);
    expect(shelf.count('tools')).toBe(10);
  });

  it('ignores a demand of nothing', () => {
    const wear = new WearLedger();
    const shelf = new Inventory(100);
    shelf.add('tools', 5);
    expect(wear.spend('tools', 0, (r, whole) => shelf.remove(r, whole))).toBe(0);
    expect(wear.debt('tools')).toBe(0);
  });
});

describe('a settlement in play', () => {
  it('never shows a fraction of anything in its stores', () => {
    // The player's actual complaint, tested end to end over a fortnight of a
    // real settlement with tools, coats and herbs all on the shelf.
    const simulation = new Simulation(OPTIONS);
    const yard = simulation.storages.all[0]!;
    yard.inventory.add('tools', 60);
    yard.inventory.add('clothing', 60);
    yard.inventory.add('herbs', 60);

    for (let tick = 0; tick < TICKS_PER_DAY * 14; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
      const stored = simulation.snapshot().stored;
      for (const [resource, amount] of Object.entries(stored)) {
        expect(Number.isInteger(amount), `${resource} is ${amount}`).toBe(true);
      }
    }
  });

  it('wears its tools down over a season, in whole units', () => {
    const simulation = new Simulation(OPTIONS);
    simulation.storages.all[0]!.inventory.add('tools', 100);
    const before = simulation.storages.totalOf('tools');

    for (let tick = 0; tick < TICKS_PER_DAY * 24; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
    }

    const worn = before - simulation.storages.totalOf('tools');
    expect(worn).toBeGreaterThan(0);
    expect(Number.isInteger(worn)).toBe(true);
  });

  it('does not forgive the tab when the settlement is saved', () => {
    // Dropping what is owed on load would be free tools, and over a long game a
    // lot of them.
    const simulation = new Simulation(OPTIONS);
    simulation.storages.all[0]!.inventory.add('tools', 100);
    for (let tick = 0; tick < TICKS_PER_DAY + 1; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
    }
    const owed = simulation.wearDebt;
    expect(owed.length).toBeGreaterThan(0);

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, 'now'));

    expect(loaded.wearDebt).toEqual(owed);
  });
});
