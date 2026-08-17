/**
 * Rates on screen, by the season and in whole numbers.
 *
 * **A player reported decimals in their stores and the stores were the smaller
 * half of the problem.** Stock is whole now, but every *rate* the game quotes was
 * still a fraction: a quarry made `10.3` stone a day, a settlement's net came out
 * `-0.5`, tools wore at `0.5`. Each of those is arithmetically honest and none of
 * them answers the only question a player asks a rate — *is that enough?*
 *
 * The fix is the window, not the rounding. Twelve days is a season, the season is
 * what the whole survival loop is built on, and over twelve days those same rates
 * are 123 stone and 6 tools: whole, and directly comparable with what is on the
 * shelf.
 *
 * What these tests pin is that the conversion is a *display* one. The per-day
 * rate stays exact behind it — the ledger's "stores last about N days" runway
 * divides by it — and no panel is allowed to print a fraction of a thing.
 */

import { describe, expect, it } from 'vitest';

import { Simulation } from '@/simulation/Simulation';
import { DAYS_PER_SEASON, TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { perSeason, seasonFigure, signedSeason } from '@/ui/format/rates';
import { productionSummary } from '@/ui/hud/productionModel';
import { EN, type MessageKey } from '@/ui/i18n/messages';
import { buildLedger, estimateFlows, type LedgerRow } from '@/ui/ledger/ledgerModel';

const OPTIONS = { seed: 20260816, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

const t = (key: MessageKey): string => {
  const value = (EN as Record<string, string | undefined>)[key];
  if (value === undefined) {
    throw new Error(`No English string for ${key}`);
  }
  return value;
};

describe('a day stretched into a season', () => {
  it('counts twelve days of it', () => {
    expect(perSeason(2)).toBe(2 * DAYS_PER_SEASON);
  });

  it('turns an awkward rate into a whole number', () => {
    // Three cutters at a stone every seventeen-and-a-half ticks. Nobody can plan
    // a winter around 10.285714 of anything.
    expect(perSeason(10.285714)).toBe(123);
  });

  it('is nothing when the rate is nothing', () => {
    expect(perSeason(0)).toBe(0);
  });

  it('keeps a trickle rather than rounding it away', () => {
    // **The one case worth a rule.** A settlement losing a little of something
    // every day is not a settlement in balance, and a red row reading `-0` would
    // be the sheet contradicting itself.
    expect(perSeason(0.01)).toBe(1);
    expect(perSeason(-0.01)).toBe(-1);
  });

  it('marks a surplus as one and leaves a shortfall to its own sign', () => {
    expect(signedSeason(1)).toBe('+12');
    expect(signedSeason(-1)).toBe('-12');
    expect(signedSeason(0)).toBe('0');
  });

  it('never prints a decimal point', () => {
    for (const perDay of [0.05, 0.5, 1 / 3, 10.285714, 52.8, -4.4]) {
      expect(seasonFigure(perDay)).not.toContain('.');
    }
  });
});

describe("a workshop's ceiling", () => {
  it('keeps the per-day rate exact so the season can round it', () => {
    // If the model rounded first, the panel would round twice and drift.
    const quarry = productionSummary('quarry');
    const stone = quarry.outputs[0];
    expect(stone).toBeDefined();
    expect(Number.isInteger(stone!.perDay)).toBe(false);
    expect(perSeason(stone!.perDay)).toBe(Math.round(stone!.perDay * DAYS_PER_SEASON));
  });

  it('quotes a season, which is twelve times the day', () => {
    const woodcutter = productionSummary('woodcutter');
    const firewood = woodcutter.outputs[0];
    const logs = woodcutter.inputs[0];
    expect(firewood).toBeDefined();
    expect(logs).toBeDefined();
    expect(perSeason(firewood!.perDay)).toBe(firewood!.perDay * DAYS_PER_SEASON);
    expect(perSeason(logs!.perDay)).toBe(logs!.perDay * DAYS_PER_SEASON);
  });
});

describe('the ledger, in whole things', () => {
  it('shows no fraction on any figure it prints', () => {
    // The player's complaint, applied to the whole sheet: production, demand,
    // and yesterday's actual spend.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    raise(simulation, 'woodcutter');
    run(simulation, TICKS_PER_DAY * 3);

    for (const row of everyRow(simulation)) {
      expect(row.value, row.label).not.toContain('.');
      expect(row.detail ?? '', row.label).not.toMatch(/\d\.\d/);
    }
  });

  it('states production as the season it labels', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'gatherer-hut');
    run(simulation, TICKS_PER_DAY * 2);

    const perDay = estimateFlows(simulation).production.get('food') ?? 0;
    expect(perDay).toBeGreaterThan(0);
    expect(row(simulation, 'production', t('hud.food'))?.value).toBe(`+${perSeason(perDay)}`);
  });

  it('states demand as the season it labels', () => {
    const simulation = new Simulation(OPTIONS);
    const perDay = estimateFlows(simulation).survivalDemand.get('food') ?? 0;
    expect(perDay).toBeGreaterThan(0);
    expect(row(simulation, 'consumption', t('hud.food'))?.value).toBe(`-${perSeason(perDay)}`);
  });

  it('still counts the runway down in days', () => {
    // Deliberately a different unit from the figure beside it. Four days of
    // larder left is the one number a player has to act on tonight, and
    // "about 0 seasons" would bury it.
    const simulation = new Simulation(OPTIONS);
    const food = row(simulation, 'consumption', t('hud.food'));
    expect(food?.detail).toContain(t('ledger.flow.days'));

    const flows = estimateFlows(simulation);
    const net = (flows.production.get('food') ?? 0) - (flows.survivalDemand.get('food') ?? 0);
    expect(net).toBeLessThan(0);
    const days = Math.floor(simulation.snapshot().stored.food / -net);
    expect(food?.detail).toContain(String(days));
  });
});

function run(simulation: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
  }
}

function everyRow(simulation: Simulation): LedgerRow[] {
  return buildLedger(simulation, t).flatMap((tab) =>
    tab.sections.flatMap((section) => section.rows),
  );
}

function row(simulation: Simulation, tabId: string, label: string): LedgerRow | undefined {
  return buildLedger(simulation, t)
    .filter((tab) => tab.id === tabId)
    .flatMap((tab) => tab.sections.flatMap((section) => section.rows))
    .find((entry) => entry.label === label);
}

function raise(simulation: Simulation, id: 'gatherer-hut' | 'woodcutter'): void {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      if (simulation.canPlaceBuilding(id, { gx, gy }).ok) {
        const building = simulation.placeBuilding(id, { gx, gy });
        if (building) {
          simulation.world.buildings.complete(simulation.world, building);
        }
        return;
      }
    }
  }
}
