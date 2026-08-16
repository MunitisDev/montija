/**
 * The closing page, and the rescue tab that leads to it.
 *
 * The one page a player sees exactly once, at the end of a campaign measured in
 * hours. Nobody will catch a wrong figure on it by playing, and by the time it
 * appears the settlement it describes has mostly stopped existing — the people
 * it counts are dead and the winters are decades gone. So the figures are
 * checked against the chronicle rather than trusted.
 *
 * The rescue tab is tested here too, because it is the other half of the same
 * arc: it is where the player learns what to build and where the one button
 * that starts the wait lives.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';
import { Simulation } from '@/simulation/Simulation';
import { arrivalTick } from '@/simulation/rescue/RescueSystem';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { buildEnding } from '@/ui/ending/endingModel';
import { EN, type MessageKey } from '@/ui/i18n/messages';
import { buildLedger, type LedgerRow, type LedgerTab } from '@/ui/ledger/ledgerModel';

const TICK = 0.1;
const OPTIONS = { seed: 20260816, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

const t = (key: MessageKey): string => {
  const value = (EN as Record<string, string | undefined>)[key];
  if (value === undefined) {
    throw new Error(`No English string for ${key}`);
  }
  return value;
};

describe('the rescue tab', () => {
  it('leads the ledger, because it is the question the game asks', () => {
    const tabs = buildLedger(new Simulation(OPTIONS), t);
    expect(tabs[0]?.id).toBe('rescue');
  });

  it('tells a settlement with no school what it needs', () => {
    const tab = rescueTab(new Simulation(OPTIONS));
    expect(tab.note).toBe(t('rescue.unaware'));
    expect(tab.action).toBeUndefined();
    expect(row(tab, t('rescue.school'))?.value).toBe(t('rescue.schoolNone'));
  });

  it('offers the bottle once the school stands', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'school');

    const tab = rescueTab(simulation);
    expect(tab.note).toBe(t('rescue.ready'));
    expect(tab.action?.enabled).toBe(true);
    expect(row(tab, t('rescue.school'))?.tone).toBe('good');
  });

  it('greys the button out while somebody is carrying it', () => {
    // Still shown rather than removed: a button that vanishes on being pressed
    // reads as though the press failed.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'school');
    simulation.sendMessage();

    const tab = rescueTab(simulation);
    expect(tab.action).toBeDefined();
    expect(tab.action?.enabled).toBe(false);
    expect(tab.note).toBe(t('rescue.carrying'));
  });

  it('drops the button and starts counting once the bottle is away', () => {
    const simulation = sentSettlement();
    const tab = rescueTab(simulation);

    expect(tab.action).toBeUndefined();
    expect(tab.note).toBe(t('rescue.awaited'));
    expect(Number(row(tab, t('rescue.remaining'))?.value)).toBeGreaterThan(0);
  });

  it('counts down in years rather than in four-figure days', () => {
    // "14,600 days" is a number nobody can hold. The question the tab answers
    // is "are we close", and the answer to that is a year.
    const simulation = sentSettlement();
    const years = Number(row(rescueTab(simulation), t('rescue.remaining'))?.value);
    expect(years).toBeLessThanOrEqual(40);
    expect(years).toBeGreaterThan(30);
  });

  it('records the year word went out', () => {
    const simulation = sentSettlement();
    expect(row(rescueTab(simulation), t('ending.messageYear'))?.value).toBe('1');
  });
});

describe('the closing page', () => {
  it('reports who is sailing home, not who ever lived here', () => {
    // The one figure on the page that is about the present, and it is the one
    // the player most wants: these are the people who make it.
    const simulation = rescuedSettlement();
    const view = buildEnding(simulation, t);

    expect(figure(view.figures, t('ending.leaving'))).toBe(String(simulation.villagers.all.length));
  });

  it('reports the chronicle rather than the settlement standing today', () => {
    const simulation = rescuedSettlement();
    const chronicle = simulation.snapshot().chronicle;
    const view = buildEnding(simulation, t);

    expect(figure(view.figures, t('ending.born'))).toBe(String(chronicle.born));
    expect(figure(view.figures, t('ending.died'))).toBe(String(chronicle.died));
    expect(figure(view.figures, t('ending.peak'))).toBe(String(chronicle.peakPopulation));
    expect(figure(view.figures, t('ending.raised'))).toBe(String(chronicle.buildingsRaised));
  });

  it('dates the settlement to the ship, not to now', () => {
    // A player who stays on after the ending should not watch its own headline
    // figure creep upwards behind them.
    const simulation = rescuedSettlement();
    const atArrival = figure(buildEnding(simulation, t).figures, t('ending.founded'));

    feed(simulation);
    run(simulation, TICKS_PER_DAY * 200);
    expect(figure(buildEnding(simulation, t).figures, t('ending.founded'))).toBe(atArrival);
  });

  it('shows a dash rather than inventing a coldest night', () => {
    // A settlement with no reading has not stood through a cold night. Showing
    // "0°" would make it the coldest in the game.
    const simulation = new Simulation(OPTIONS);
    expect(figure(buildEnding(simulation, t).figures, t('ending.coldest'))).toBe('--');
  });

  it('shows a real coldest night once there has been one', () => {
    const simulation = new Simulation(OPTIONS);
    run(simulation, TICKS_PER_DAY * 3);
    expect(figure(buildEnding(simulation, t).figures, t('ending.coldest'))).toMatch(/^-?\d+°$/);
  });

  it('marks nights slept in the open as a cost, never as an achievement', () => {
    const simulation = new Simulation(OPTIONS);
    run(simulation, TICKS_PER_DAY * 3);
    const chronicle = simulation.snapshot().chronicle;
    const rough = buildEnding(simulation, t).figures.find(
      (entry) => entry.label === t('ending.roughNights'),
    );

    expect(rough?.value).toBe(String(chronicle.roughNights));
    expect(rough?.tone).toBe(chronicle.roughNights > 0 ? 'bad' : undefined);
  });

  it('gives every figure a label and a value', () => {
    for (const entry of buildEnding(rescuedSettlement(), t).figures) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.value.length).toBeGreaterThan(0);
      expect(entry.label).not.toMatch(/^[a-z]+\.[a-z]/);
    }
  });

  it('omits the message year for a page built before one was sent', () => {
    // The page is only ever meant to open after a rescue, but a blank row is a
    // worse answer than no row if it is ever built early.
    const view = buildEnding(new Simulation(OPTIONS), t);
    expect(view.figures.some((entry) => entry.label === t('ending.messageYear'))).toBe(false);
  });
});

function rescueTab(simulation: Simulation): LedgerTab {
  const tab = buildLedger(simulation, t).find((entry) => entry.id === 'rescue');
  if (!tab) {
    throw new Error('the ledger has no rescue tab');
  }
  return tab;
}

function row(tab: LedgerTab, label: string): LedgerRow | undefined {
  return tab.sections.flatMap((section) => section.rows).find((entry) => entry.label === label);
}

function figure(figures: readonly LedgerRow[], label: string): string {
  const found = figures.find((entry) => entry.label === label);
  if (!found) {
    throw new Error(`the closing page has no ${label}`);
  }
  return found.value;
}

/** A settlement whose bottle has physically reached the water. */
function sentSettlement(): Simulation {
  const simulation = new Simulation(OPTIONS);
  raise(simulation, 'school');
  simulation.sendMessage();
  feed(simulation);
  run(simulation, TICKS_PER_DAY * 12);
  if (simulation.rescueTicks.messageSentTick === null) {
    throw new Error('the messenger never reached the water');
  }
  return simulation;
}

/**
 * The same, wound forward to the day the ship lands.
 *
 * Jumped rather than played: forty years at ten ticks a second is not something
 * a test suite should sit through, and the arrival is decided by the tick. Fed
 * on the way, because a settlement that starves before the ship arrives is a
 * different ending and the rule that no ship comes for an empty settlement
 * would quite correctly refuse this one.
 */
function rescuedSettlement(): Simulation {
  const simulation = sentSettlement();
  simulation.restoreClock(arrivalTick(simulation.rescueTicks.messageSentTick!), 0);
  feed(simulation);
  run(simulation, TICKS_PER_DAY);
  if (simulation.rescueTicks.arrivedTick === null) {
    throw new Error('the ship never came');
  }
  return simulation;
}

/** Tops the larder up to a level, rather than piling food in without limit. */
function feed(simulation: Simulation): void {
  const yard = simulation.storages.all[0];
  if (!yard) {
    return;
  }
  const short = 200 - yard.inventory.count('food');
  if (short > 0) {
    yard.inventory.add('food', short);
    simulation.storages.markChanged();
  }
}

function run(simulation: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.update(simulation.tick + 1, TICK);
  }
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
