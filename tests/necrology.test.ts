/**
 * The roll of the dead, and the closing page built from it.
 *
 * The chronicle counted the dead and nothing more, which is the one thing that
 * cannot answer the question a player asks when a settlement fails: **not how
 * many, but what went wrong**. Six dead of cold in a single winter and six dead
 * of old age over twenty years are the same tally and opposite settlements.
 *
 * What is tested here is that the roll is *true* — every death recorded once,
 * attributed to the need that actually ran out, at the age the person actually
 * was, and still there after a reload. A closing page that misreports the cause
 * would be worse than the bare count it replaced, because a player would believe
 * it and prepare for the wrong winter next time.
 */

import { describe, expect, it } from 'vitest';

import { Simulation } from '@/simulation/Simulation';
import { causeOfDeath, Necrology } from '@/simulation/history/Necrology';
import { restore, serialise } from '@/simulation/save/serialise';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { Villager } from '@/simulation/villagers/Villager';
import { EN, type MessageKey } from '@/ui/i18n/messages';
import {
  BURIAL_ROLL_LIMIT,
  buildEndGame,
  burialRoll,
  deathsByCause,
} from '@/ui/endgame/endGameModel';

const OPTIONS = { seed: 20260816, worldWidth: 48, worldHeight: 48, startingVillagers: 10 };

const t = (key: MessageKey): string => {
  const value = (EN as Record<string, string | undefined>)[key];
  if (value === undefined) {
    throw new Error(`No English string for ${key}`);
  }
  return value;
};

describe('what the needs say killed somebody', () => {
  it('calls an empty larder hunger', () => {
    expect(causeOfDeath(needs({ hunger: 0, warmth: 60 }))).toBe('hunger');
  });

  it('calls an unlit house cold', () => {
    expect(causeOfDeath(needs({ hunger: 70, warmth: 0 }))).toBe('cold');
  });

  it('names both when both had run out', () => {
    // **Not a coin toss between the two.** A villager starving *and* freezing is
    // the settlement failing at both, and reporting one of them would tell the
    // player to fix half of what went wrong.
    expect(causeOfDeath(needs({ hunger: 0, warmth: 0 }))).toBe('hungerAndCold');
  });
});

describe('the roll', () => {
  it('writes down who, how old, and of what', () => {
    const simulation = new Simulation(OPTIONS);
    const victim = simulation.villagers.all[0]!;
    victim.age = 34;
    starve(simulation);

    const record = simulation.necrology.all.find((entry) => entry.name === victim.name);
    expect(record).toBeDefined();
    expect(record!.age).toBe(34);
    expect(record!.cause).toBe('hunger');
    expect(record!.year).toBeGreaterThanOrEqual(1);
  });

  it('records everyone exactly once', () => {
    const simulation = new Simulation(OPTIONS);
    starve(simulation);

    expect(simulation.villagers.count).toBe(0);
    expect(simulation.necrology.count).toBe(10);
    const names = new Set(simulation.necrology.all.map((record) => record.name));
    expect(names.size).toBe(10);
  });

  it('agrees with the chronicle about how many were buried', () => {
    // Two counters for the same event is two chances to disagree, and the closing
    // page shows both on the same screen.
    const simulation = new Simulation(OPTIONS);
    starve(simulation);
    expect(simulation.necrology.count).toBe(simulation.snapshot().chronicle.died);
  });

  it('keeps them in the order they died', () => {
    const necrology = new Necrology();
    const when = { year: 3, season: 'winter' as const };
    for (const age of [20, 40, 60]) {
      necrology.record(aged(age), 'cold', when);
    }
    expect(necrology.all.map((record) => record.age)).toEqual([20, 40, 60]);
  });

  it('counts by cause, with every cause named even at zero', () => {
    const necrology = new Necrology();
    const when = { year: 1, season: 'winter' as const };
    necrology.record(aged(30), 'cold', when);
    necrology.record(aged(31), 'cold', when);
    necrology.record(aged(70), 'oldAge', when);

    expect(necrology.byCause()).toEqual({
      hunger: 0,
      cold: 2,
      hungerAndCold: 0,
      oldAge: 1,
      fire: 0,
      illness: 0,
    });
  });

  it('has no average age until somebody has died', () => {
    expect(new Necrology().averageAge()).toBeNull();
  });

  it('averages the ages it has', () => {
    const necrology = new Necrology();
    const when = { year: 1, season: 'spring' as const };
    necrology.record(aged(20), 'hunger', when);
    necrology.record(aged(40), 'hunger', when);
    expect(necrology.averageAge()).toBe(30);
  });
});

describe('a settlement that forgets nothing', () => {
  it('carries the roll through a save and a load', () => {
    // A name and an age at death cannot be recomputed: the person is gone. A
    // reload that dropped them would show a clean history beside a village of
    // ghosts.
    const simulation = new Simulation(OPTIONS);
    starve(simulation);
    const before = simulation.necrology.all.map((record) => ({ ...record }));
    expect(before.length).toBe(10);

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, 'now'));

    expect(loaded.necrology.all).toEqual(before);
  });

  it('reads an old save with no roll as a history nobody wrote down', () => {
    const simulation = new Simulation(OPTIONS);
    const save = serialise(simulation, 'now');
    const { necrology: _dropped, ...older } = save;

    const loaded = new Simulation(OPTIONS);
    restore(loaded, older as typeof save);
    expect(loaded.necrology.count).toBe(0);
  });
});

describe('the closing page', () => {
  it('says how far the settlement got and what took each of them', () => {
    const simulation = new Simulation(OPTIONS);
    starve(simulation);
    const report = buildEndGame(simulation, t);

    expect(report.ended).toContain(t('failure.survived'));
    expect(report.roll.length).toBe(10);
    expect(report.causes.map((entry) => entry.label)).toContain(t('death.hunger'));
    expect(report.stats.map((entry) => entry.label)).toContain(t('end.averageAge'));
  });

  it('lists the most recent death first', () => {
    // The deaths that ended the settlement are the ones that explain it. The
    // founders are history and can wait further down.
    const simulation = new Simulation(OPTIONS);
    starve(simulation);
    const last = simulation.necrology.all[simulation.necrology.count - 1]!;
    expect(buildEndGame(simulation, t).roll[0]?.name).toBe(last.name);
  });

  it('gives every line a name, an age and a cause', () => {
    const simulation = new Simulation(OPTIONS);
    starve(simulation);
    for (const entry of buildEndGame(simulation, t).roll) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.age).toMatch(/^\d+$/);
      expect(entry.cause.length).toBeGreaterThan(0);
      expect(entry.when).toContain(t('time.yearShort'));
    }
  });

  it('translates every line it shows', () => {
    const simulation = new Simulation(OPTIONS);
    starve(simulation);
    const report = buildEndGame(simulation, t);
    for (const text of [
      report.ended,
      report.rollTitle,
      ...report.stats.map((entry) => entry.label),
      ...report.causes.map((entry) => entry.label),
      ...report.roll.flatMap((entry) => [entry.cause, entry.note]),
    ]) {
      expect(text).not.toMatch(/^[a-z]+\.[a-z-]/);
    }
  });

  it('says nothing about illness when nobody died ill', () => {
    const simulation = new Simulation(OPTIONS);
    starve(simulation);
    const anyIll = simulation.necrology.all.some((record) => record.ill);
    expect(buildEndGame(simulation, t).illNote === '').toBe(!anyIll);
  });
});

describe('the ledger, mid-game', () => {
  it('lists no causes before anybody has died', () => {
    // Four zeroes on a settlement that has never lost anybody reads as a list of
    // things about to go wrong.
    expect(deathsByCause(new Simulation(OPTIONS), t)).toEqual([]);
  });

  it('lists the cause once it has taken somebody', () => {
    const simulation = new Simulation(OPTIONS);
    starve(simulation);
    const causes = deathsByCause(simulation, t);
    expect(causes.map((entry) => entry.cause)).toContain('hunger');
    expect(causes.every((entry) => Number(entry.value) > 0)).toBe(true);
  });
});

/**
 * The cemetery's own roll, asked for so that a death leaves a name somewhere.
 *
 * The end screen already read the roll out, which is exactly too late to be any
 * use: the player wants to know who the winter took while there is still a
 * settlement to do something about it.
 */
describe("the cemetery's roll", () => {
  it('says nobody lies there yet on a settlement that has lost no one', () => {
    const roll = burialRoll(new Simulation(OPTIONS), t);
    expect(roll.total).toBe(0);
    expect(roll.entries).toEqual([]);
    expect(roll.more).toBe(0);
  });

  it('names the dead, newest first', () => {
    const simulation = new Simulation(OPTIONS);
    starve(simulation);

    const roll = burialRoll(simulation, t);
    const records = simulation.necrology.all;
    expect(roll.total).toBe(records.length);
    expect(roll.total).toBeGreaterThan(0);

    // Newest first: the death a player is asking about is the last one.
    expect(roll.entries[0]!.name).toBe(records[records.length - 1]!.name);

    // Every line carries the four things that make it worth reading.
    for (const entry of roll.entries) {
      expect(entry.name.trim()).not.toBe('');
      expect(Number(entry.age)).toBeGreaterThanOrEqual(0);
      expect(entry.cause.trim()).not.toBe('');
      expect(entry.when).toContain(EN['time.yearShort']);
    }
  });

  it('counts the older graves rather than drawing all of them', () => {
    // A twenty-year settlement buries dozens. The panel it would have to grow to
    // in order to list them all is a panel that covers the settlement.
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 40 });
    starve(simulation);

    const roll = burialRoll(simulation, t);
    expect(roll.total).toBeGreaterThan(BURIAL_ROLL_LIMIT);
    expect(roll.entries).toHaveLength(BURIAL_ROLL_LIMIT);
    expect(roll.more).toBe(roll.total - BURIAL_ROLL_LIMIT);
  });

  it('reads the same roll the closing page does', () => {
    // One roll, formatted one way, whether it is read during the game or after.
    const simulation = new Simulation(OPTIONS);
    starve(simulation);
    const [first] = burialRoll(simulation, t).entries;
    const closing = buildEndGame(simulation, t).roll[0]!;
    expect(first).toEqual(closing);
  });
});

/** Empties the larders and runs until everybody is gone. */
function starve(simulation: Simulation): void {
  for (const storage of simulation.storages.all) {
    storage.inventory.clear();
  }
  simulation.storages.markChanged();

  const limit = TICKS_PER_DAY * 200;
  for (let tick = 0; tick < limit && simulation.villagers.count > 0; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
    // Anything they gather goes straight back out: the point is a settlement
    // with nothing to eat, not a race against a gatherer.
    if (simulation.tick % TICKS_PER_DAY === 0) {
      for (const storage of simulation.storages.all) {
        storage.inventory.clear();
      }
      simulation.storages.markChanged();
    }
  }
}

/** A stand-in villager with the needs a test wants to read a cause from. */
function needs(values: { hunger: number; warmth: number }): Villager {
  return { needs: { ...values, health: 0, spirit: 50 } } as Villager;
}

function aged(age: number): Villager {
  return {
    name: `Villager ${age}`,
    sex: 'f',
    age,
    isIll: false,
    bestTrade: null,
    skillAt: () => 'none',
  } as unknown as Villager;
}
