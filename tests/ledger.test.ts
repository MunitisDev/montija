/**
 * The ledger, checked against the settlement it claims to describe.
 *
 * Every figure on that sheet is a claim, and two kinds of claim live there.
 *
 * The **counts** — how many people, how many buildings, how many beds — must be
 * exactly right, because they are simply the settlement restated and the player
 * has no way to audit them.
 *
 * The **estimates** — what a day produces and what it costs — are a projection,
 * and cannot be exact. What they must be is *honest*: demand has to come out of
 * the same constants the survival system spends by, production has to follow
 * the same seasonal curve the villagers actually work to, and neither may claim
 * anything for a workshop with nobody in it. Those are the properties tested
 * here. The absolute size of the production number is deliberately not asserted
 * against real output — it is an upper bound, and the model says so.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';
import { Simulation } from '@/simulation/Simulation';
import { DAYS_PER_SEASON, TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import {
  CLOTHING_PER_VILLAGER_PER_COLD_DAY,
  FIREWOOD_PER_VILLAGER_PER_COLD_DAY,
  FOOD_PER_VILLAGER_PER_DAY,
  TOOLS_PER_WORKER_PER_DAY,
} from '@/simulation/seasons/SurvivalSystem';
import { EN, type MessageKey } from '@/ui/i18n/messages';
import {
  LEDGER_TABS,
  buildLedger,
  estimateFlows,
  totalDemand,
  type LedgerRow,
  type LedgerTab,
  type LedgerTabId,
} from '@/ui/ledger/ledgerModel';

const TICK = 0.1;
const OPTIONS = { seed: 20260816, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

const t = (key: MessageKey): string => {
  const value = (EN as Record<string, string | undefined>)[key];
  if (value === undefined) {
    throw new Error(`No English string for ${key}`);
  }
  return value;
};

describe('the shape of the sheet', () => {
  it('builds every tab, in the declared order', () => {
    const tabs = buildLedger(new Simulation(OPTIONS), t);
    expect(tabs.map((tab) => tab.id)).toEqual(LEDGER_TABS);
  });

  it('gives every row a label and a value', () => {
    // A blank cell on a page of figures reads as a bug in the settlement rather
    // than a bug in the sheet, which is the worse of the two.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    run(simulation, TICKS_PER_DAY * 3);

    for (const row of everyRow(buildLedger(simulation, t))) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.value.length).toBeGreaterThan(0);
    }
  });

  it('never repeats a tab title as its own section heading', () => {
    // "Getting home" directly under the tab called "Getting home" is the same
    // word twice in three lines.
    for (const tab of buildLedger(new Simulation(OPTIONS), t)) {
      for (const section of tab.sections) {
        expect(section.title).not.toBe(tab.title);
      }
    }
  });

  it('never leaves a section empty without saying so', () => {
    const tabs = buildLedger(new Simulation(OPTIONS), t);
    for (const tab of tabs) {
      for (const section of tab.sections) {
        if (section.rows.length === 0) {
          expect(section.empty ?? '').not.toBe('');
        }
      }
    }
  });

  it('translates every string it shows', () => {
    // The model builds several keys at runtime — `hud.${resource}` and
    // `building.${id}` — which the compiler cannot check. An untranslated key
    // would surface as the raw key on screen.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    raise(simulation, 'house');
    run(simulation, TICKS_PER_DAY * 2);

    for (const row of everyRow(buildLedger(simulation, t))) {
      expect(row.label).not.toMatch(/^[a-z]+\.[a-z-]/);
    }
  });
});

describe('the counts', () => {
  it('reports exactly as many villagers as are alive', () => {
    const simulation = new Simulation(OPTIONS);
    run(simulation, TICKS_PER_DAY * 4);

    expect(figure(buildLedger(simulation, t), 'people', 'ledger.people.total')).toBe(
      String(simulation.villagers.all.length),
    );
  });

  it('splits the settlement into children, workers and elders that make up the whole', () => {
    // **Three groups rather than two, and that is the point of the panel.** A
    // settlement can sit at twenty people with half its workshops empty, and the
    // reason is always how many of the twenty are under fourteen or over sixty —
    // which "adults and children" could not tell the player.
    const simulation = new Simulation(OPTIONS);
    run(simulation, TICKS_PER_DAY * 4);
    const tabs = buildLedger(simulation, t);

    const total = Number(figure(tabs, 'people', 'ledger.people.total'));
    const workers = Number(figure(tabs, 'people', 'ledger.people.workers'));
    const children = Number(figure(tabs, 'people', 'ledger.people.children'));
    const elders = Number(figure(tabs, 'people', 'ledger.people.elders'));

    expect(children + workers + elders).toBe(total);
  });

  it('counts a building only once it is standing', () => {
    const simulation = new Simulation(OPTIONS);
    place(simulation, 'gatherer-hut');
    const tabs = buildLedger(simulation, t);

    const row = find(tabs, 'buildings', t('building.gatherer-hut'));
    expect(row?.value).toBe('0');
    expect(row?.detail).toContain(t('ledger.buildings.underway'));
  });

  it('counts it once it is finished', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');

    const row = find(buildLedger(simulation, t), 'buildings', t('building.gatherer-hut'));
    expect(row?.value).toBe('1');
  });

  it('reports beds against people', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'house');
    run(simulation, TICKS_PER_DAY);

    const snapshot = simulation.snapshot();
    expect(figure(buildLedger(simulation, t), 'buildings', 'ledger.buildings.beds')).toBe(
      `${snapshot.villagerCount}/${snapshot.housingCapacity}`,
    );
  });

  it('marks more people than beds as bad', () => {
    // Ten settlers and no houses. Anyone over the count sleeps rough and pays
    // for it in warmth, so this is exactly the row that should be shouting.
    const simulation = new Simulation(OPTIONS);
    const row = find(buildLedger(simulation, t), 'buildings', t('ledger.buildings.beds'));
    expect(row?.tone).toBe('bad');
  });
});

describe('what a day costs', () => {
  it('asks for exactly one ration per villager', () => {
    const simulation = new Simulation(OPTIONS);
    const flows = estimateFlows(simulation);

    expect(flows.survivalDemand.get('food')).toBeCloseTo(
      simulation.villagers.all.length * FOOD_PER_VILLAGER_PER_DAY,
    );
  });

  it('wears tools by the adult, not by the head', () => {
    const simulation = new Simulation(OPTIONS);
    const adults = simulation.villagers.all.filter((villager) => villager.isAdult).length;

    expect(estimateFlows(simulation).survivalDemand.get('tools')).toBeCloseTo(
      adults * TOOLS_PER_WORKER_PER_DAY,
    );
  });

  it('burns nothing above freezing', () => {
    const simulation = new Simulation(OPTIONS);
    expect(simulation.year.isFreezing).toBe(false);

    const flows = estimateFlows(simulation);
    expect(flows.survivalDemand.get('firewood') ?? 0).toBe(0);
    expect(flows.survivalDemand.get('clothing') ?? 0).toBe(0);
  });

  it('burns firewood and coats once it freezes', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'house');
    // Fed all the way to winter on purpose: a settlement that starves on the
    // way there arrives with nobody in the house, and the test would be
    // measuring the famine rather than the firewood.
    feed(simulation);
    toWinter(simulation, () => feed(simulation));
    expect(simulation.year.isFreezing).toBe(true);

    const people = simulation.villagers.all;
    const housed = people.filter((villager) => villager.homeId !== null).length;
    expect(housed).toBeGreaterThan(0);

    const flows = estimateFlows(simulation);
    expect(flows.survivalDemand.get('firewood')).toBeCloseTo(
      housed * FIREWOOD_PER_VILLAGER_PER_COLD_DAY,
    );
    expect(flows.survivalDemand.get('clothing')).toBeCloseTo(
      people.length * CLOTHING_PER_VILLAGER_PER_COLD_DAY,
    );
  });

  it('burns nothing for people with nowhere to burn it', () => {
    // No houses means no hearths. The settlement saves the firewood and pays
    // for it in warmth — and the sheet has to agree with the simulation about
    // which of those two it is.
    const simulation = new Simulation(OPTIONS);
    toWinter(simulation);

    expect(estimateFlows(simulation).survivalDemand.get('firewood') ?? 0).toBe(0);
  });
});

describe('what a day makes', () => {
  it('claims nothing for a workshop with nobody in it', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    expect(hut).not.toBeNull();
    hut!.desiredWorkers = 0;

    expect(estimateFlows(simulation).production.get('food') ?? 0).toBe(0);
  });

  it('claims food once somebody is foraging', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    run(simulation, TICKS_PER_DAY * 2);

    const staffed = [...simulation.world.buildings.all].some(
      (building) => building.definition.id === 'gatherer-hut' && building.workers.length > 0,
    );
    expect(staffed).toBe(true);
    expect(estimateFlows(simulation).production.get('food') ?? 0).toBeGreaterThan(0);
  });

  it('scales output with the staff', () => {
    const one = new Simulation(OPTIONS);
    const hutA = raise(one, 'gatherer-hut');
    hutA!.desiredWorkers = 1;
    run(one, TICKS_PER_DAY * 2);

    const two = new Simulation(OPTIONS);
    const hutB = raise(two, 'gatherer-hut');
    hutB!.desiredWorkers = 2;
    run(two, TICKS_PER_DAY * 2);

    const oneStaff = staffAt(one, 'gatherer-hut');
    const twoStaff = staffAt(two, 'gatherer-hut');
    expect(twoStaff).toBeGreaterThan(oneStaff);
    expect(estimateFlows(two).production.get('food') ?? 0).toBeGreaterThan(
      estimateFlows(one).production.get('food') ?? 0,
    );
  });

  it('follows the season down to nothing', () => {
    // A field yields nothing under snow, and a sheet promising a winter harvest
    // would send the player into January believing they were covered.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'crop-field');
    run(simulation, TICKS_PER_DAY * 2);
    expect(staffAt(simulation, 'crop-field')).toBeGreaterThan(0);

    toWinter(simulation);
    const winterField = [...simulation.world.buildings.all].find(
      (building) => building.definition.id === 'crop-field',
    );
    if (!winterField || winterField.workers.length === 0) {
      // Winter releases the field's staff, which is itself the right answer.
      expect(estimateFlows(simulation).production.get('food') ?? 0).toBe(0);
      return;
    }
    expect(estimateFlows(simulation).production.get('food') ?? 0).toBe(0);
  });

  it('counts a workshop input as demand', () => {
    // A woodcutter eats logs to make firewood. A ledger that showed only what
    // came out would tell the player their logs were safe.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'woodcutter');
    run(simulation, TICKS_PER_DAY * 2);
    expect(staffAt(simulation, 'woodcutter')).toBeGreaterThan(0);

    const flows = estimateFlows(simulation);
    expect(flows.workshopDemand.get('logs') ?? 0).toBeGreaterThan(0);
    expect(totalDemand(flows, 'logs')).toBe(flows.workshopDemand.get('logs'));
  });

  it('adds the workshop and the people together for one resource', () => {
    const simulation = new Simulation(OPTIONS);
    const flows = estimateFlows(simulation);
    // Nobody makes tools yet, so total demand is purely the people's wear.
    expect(totalDemand(flows, 'tools')).toBeCloseTo(flows.survivalDemand.get('tools') ?? 0);
  });
});

describe('how the sheet reads a shortfall', () => {
  it('marks a resource being spent faster than it is made', () => {
    // Ten mouths and no gatherer: food is going one way only.
    const simulation = new Simulation(OPTIONS);
    const row = find(buildLedger(simulation, t), 'consumption', t('hud.food'));
    expect(row?.tone).toBe('bad');
    expect(row?.detail).toContain(t('ledger.flow.lasts'));
  });

  it('says the shelf is empty rather than counting down from nothing', () => {
    // "Lasts about 0 days" against a resource the settlement has never had
    // reads as an emergency. Nobody has any tools and nobody is making any;
    // that is the baseline the game has always run at, not a crisis.
    const simulation = new Simulation(OPTIONS);
    expect(simulation.snapshot().stored.tools).toBe(0);

    const row = find(buildLedger(simulation, t), 'consumption', t('hud.tools'));
    expect(row?.detail).toBe(t('ledger.flow.empty'));
    expect(row?.detail).not.toContain(t('ledger.flow.lasts'));
  });

  it('does not put a countdown on something that is sustained', () => {
    // "Lasts N days" against a resource nobody spends is precision about
    // nothing, and reads as a warning when there is none.
    const flows = estimateFlows(new Simulation(OPTIONS));
    expect(flows.production.get('stone') ?? 0).toBe(0);
    expect(totalDemand(flows, 'stone')).toBe(0);

    const row = find(buildLedger(new Simulation(OPTIONS), t), 'consumption', t('hud.stone'));
    expect(row).toBeUndefined();
  });

  it('says whether tonight is a freezing one', () => {
    const mild = tab(buildLedger(new Simulation(OPTIONS), t), 'consumption');
    expect(mild?.note).toBe(t('ledger.consumption.mild'));

    const simulation = new Simulation(OPTIONS);
    toWinter(simulation);
    expect(tab(buildLedger(simulation, t), 'consumption')?.note).toBe(
      t('ledger.consumption.freezing'),
    );
  });

  it('carries the caveat on the production tab', () => {
    // The figure is an upper bound. A sheet that presented it as a forecast
    // would be the game lying, which is the one thing this panel must not do.
    expect(tab(buildLedger(new Simulation(OPTIONS), t), 'production')?.note).toBe(
      t('ledger.production.note'),
    );
  });
});

function run(simulation: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.update(simulation.tick + 1, TICK);
  }
}

/** Runs the clock forward until the settlement is in a freezing winter. */
function toWinter(simulation: Simulation, eachDay?: () => void): void {
  const limit = TICKS_PER_DAY * DAYS_PER_SEASON * 4;
  for (let tick = 0; tick < limit && !simulation.year.isFreezing; tick += 1) {
    simulation.update(simulation.tick + 1, TICK);
    if (eachDay && simulation.tick % TICKS_PER_DAY === 0) {
      eachDay();
    }
  }
}

/** Tops the larder up to a level, rather than piling food in without limit. */
function feed(simulation: Simulation): void {
  const yard = simulation.storages.all[0];
  if (!yard) {
    return;
  }
  const short = 60 - yard.inventory.count('food');
  if (short > 0) {
    yard.inventory.add('food', short);
    simulation.storages.markChanged();
  }
}

function staffAt(simulation: Simulation, id: BuildingId): number {
  return [...simulation.world.buildings.all]
    .filter((building) => building.definition.id === id)
    .reduce((total, building) => total + building.workers.length, 0);
}

function tab(tabs: readonly LedgerTab[], id: LedgerTabId): LedgerTab | undefined {
  return tabs.find((entry) => entry.id === id);
}

function everyRow(tabs: readonly LedgerTab[]): LedgerRow[] {
  return tabs.flatMap((entry) => entry.sections.flatMap((section) => section.rows));
}

function find(tabs: readonly LedgerTab[], id: LedgerTabId, label: string): LedgerRow | undefined {
  return tab(tabs, id)
    ?.sections.flatMap((section) => section.rows)
    .find((row) => row.label === label);
}

/** The value of the row whose label is the given message key's text. */
function figure(tabs: readonly LedgerTab[], id: LedgerTabId, key: MessageKey): string {
  const row = find(tabs, id, t(key));
  if (!row) {
    throw new Error(`No row labelled ${key} on the ${id} tab`);
  }
  return row.value;
}

function place(simulation: Simulation, id: BuildingId): Building | null {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      const cell = { gx, gy };
      if (simulation.canPlaceBuilding(id, cell).ok) {
        return simulation.placeBuilding(id, cell);
      }
    }
  }
  return null;
}

function raise(simulation: Simulation, id: BuildingId): Building | null {
  const building = place(simulation, id);
  if (building) {
    simulation.world.buildings.complete(simulation.world, building);
  }
  return building;
}
