/**
 * Food going bad, and the building that stops it.
 *
 * The Food Storage previously had no purpose: the founding yard accepted every
 * resource and kept it forever, so the larder was a more expensive way to own
 * the same shelf. Spoilage is what makes it a decision.
 */

import { describe, expect, it } from 'vitest';

import { RESOURCES } from '@/data/resources';
import { StorageRegistry } from '@/simulation/logistics/Storage';
import { ResourcePileRegistry } from '@/simulation/resources/ResourcePile';
import { runSpoilage } from '@/simulation/resources/SpoilageSystem';

function registries() {
  return { storages: new StorageRegistry(), piles: new ResourcePileRegistry() };
}

describe('what spoils', () => {
  it('turns food left in an open yard', () => {
    const { storages, piles } = registries();
    const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 });
    yard.inventory.add('food', 100);

    const report = runSpoilage(storages, piles);

    expect(yard.inventory.count('food')).toBeLessThan(100);
    expect(report.lost.food).toBeGreaterThan(0);
  });

  it('leaves timber, stone and firewood alone', () => {
    const { storages, piles } = registries();
    const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 });
    yard.inventory.add('logs', 100);
    yard.inventory.add('stone', 100);
    yard.inventory.add('firewood', 100);

    const report = runSpoilage(storages, piles);

    expect(yard.inventory.count('logs')).toBe(100);
    expect(yard.inventory.count('stone')).toBe(100);
    expect(yard.inventory.count('firewood')).toBe(100);
    expect(report.total).toBe(0);
  });

  it('spoils food lying on the ground too', () => {
    const { storages, piles } = registries();
    piles.drop({ gx: 3, gy: 3 }, 'food', 50);

    runSpoilage(storages, piles);

    expect(piles.totalOf('food')).toBeLessThan(50);
  });

  it('is the same every time, with no randomness', () => {
    const first = registries();
    const second = registries();
    first.storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 }).inventory.add('food', 137);
    second.storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 }).inventory.add('food', 137);

    expect(runSpoilage(first.storages, first.piles).lost.food).toBe(
      runSpoilage(second.storages, second.piles).lost.food,
    );
  });
});

describe('the larder', () => {
  it('keeps food far longer than an open yard', () => {
    const { storages, piles } = registries();
    const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 });
    const larder = storages.add({
      cell: { gx: 5, gy: 0 },
      capacity: 500,
      accepts: ['food'],
      preservation: 0.1,
    });
    yard.inventory.add('food', 300);
    larder.inventory.add('food', 300);

    // A season of standing still.
    for (let day = 0; day < 12; day++) {
      runSpoilage(storages, piles);
    }

    expect(larder.inventory.count('food')).toBeGreaterThan(yard.inventory.count('food') * 2);
  });

  it('carries a winter of food where a yard cannot', () => {
    const { storages, piles } = registries();
    const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 });
    const larder = storages.add({
      cell: { gx: 5, gy: 0 },
      capacity: 500,
      accepts: ['food'],
      preservation: 0.1,
    });
    // What ten villagers eat across a twelve-day winter, banked in autumn.
    yard.inventory.add('food', 120);
    larder.inventory.add('food', 120);

    for (let day = 0; day < 12; day++) {
      runSpoilage(storages, piles);
    }

    expect(larder.inventory.count('food')).toBeGreaterThan(100);
    expect(yard.inventory.count('food')).toBeLessThan(40);
  });

  it('receives food in preference to a nearer open yard', () => {
    // Walking food past the larder to the closer yard, and watching it rot
    // there, is not what a person would do.
    const { storages } = registries();
    storages.add({ cell: { gx: 1, gy: 0 }, capacity: 500 });
    const larder = storages.add({
      cell: { gx: 9, gy: 0 },
      capacity: 500,
      accepts: ['food'],
      preservation: 0.1,
    });

    expect(storages.findNearestAccepting({ gx: 0, gy: 0 }, 'food')).toBe(larder);
  });

  it('does not divert goods that keep perfectly well anywhere', () => {
    const { storages } = registries();
    const near = storages.add({ cell: { gx: 1, gy: 0 }, capacity: 500 });
    storages.add({ cell: { gx: 9, gy: 0 }, capacity: 500, preservation: 0.1 });

    expect(storages.findNearestAccepting({ gx: 0, gy: 0 }, 'logs')).toBe(near);
  });
});

describe('spoilage arithmetic', () => {
  it('never takes more than there is', () => {
    const { storages, piles } = registries();
    const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 });
    yard.inventory.add('food', 4);

    for (let day = 0; day < 40; day++) {
      runSpoilage(storages, piles);
    }

    expect(yard.inventory.count('food')).toBeGreaterThanOrEqual(0);
  });

  it('agrees with the rate in the resource definition', () => {
    const { storages, piles } = registries();
    const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 500 });
    yard.inventory.add('food', 200);

    const report = runSpoilage(storages, piles);

    expect(report.lost.food).toBe(Math.round(200 * RESOURCES.food.spoilsPerDay));
  });
});
