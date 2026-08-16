/**
 * The closing page.
 *
 * Pure, like the guide, the roster and the ledger: simulation and a translator
 * in, plain rows out. It exists as its own module for the same reason those do
 * — this is the one page a player sees exactly once, at the end of a campaign
 * measured in hours, and nobody is going to catch a wrong figure on it by
 * playing.
 *
 * **Everything here is about the past.** The chronicle is recorded as it
 * happens precisely because the present cannot be asked what the past was: by
 * the time the ship comes, most of the people this page is about are dead and
 * most of the winters it counts are decades gone. A settlement of twelve tells
 * you nothing about the forty who lived there.
 *
 * The one figure that is about the present is who is on the ship, and it is
 * labelled as such.
 */

import { hasColdReading, type Chronicle } from '@/simulation/rescue/Chronicle';
import type { Simulation } from '@/simulation/Simulation';
import type { LedgerRow, Translate } from '@/ui/ledger/ledgerModel';
import { yearOfTick } from '@/ui/ledger/ledgerModel';

export interface EndingView {
  readonly title: string;
  readonly lede: string;
  readonly figures: readonly LedgerRow[];
}

export function buildEnding(simulation: Simulation, t: Translate): EndingView {
  const chronicle: Readonly<Chronicle> = simulation.snapshot().chronicle;
  const sentTick = simulation.rescueTicks.messageSentTick;
  const arrivedTick = simulation.rescueTicks.arrivedTick;

  const figures: LedgerRow[] = [
    {
      label: t('ending.founded'),
      // Counted to the ship rather than to now, so a player who keeps the
      // settlement running afterwards does not watch the ending's own headline
      // figure creep upwards behind them.
      value: String(yearOfTick(arrivedTick ?? simulation.tick)),
    },
    {
      label: t('ending.leaving'),
      value: String(simulation.villagers.all.length),
      tone: 'good',
    },
    { label: t('ending.born'), value: String(chronicle.born) },
    { label: t('ending.arrived'), value: String(chronicle.arrived) },
    { label: t('ending.died'), value: String(chronicle.died) },
    { label: t('ending.peak'), value: String(chronicle.peakPopulation) },
    { label: t('ending.raised'), value: String(chronicle.buildingsRaised) },
    { label: t('ending.foodEaten'), value: String(Math.round(chronicle.foodEaten)) },
    { label: t('ending.firewoodBurned'), value: String(Math.round(chronicle.firewoodBurned)) },
    {
      label: t('ending.coldest'),
      // `--` rather than a number on a settlement that never saw a reading. A
      // fabricated zero would be the coldest night in the game.
      value: hasColdReading(chronicle) ? `${Math.round(chronicle.coldest)}°` : '--',
    },
    {
      label: t('ending.roughNights'),
      value: String(chronicle.roughNights),
      ...(chronicle.roughNights > 0 ? { tone: 'bad' as const } : {}),
    },
  ];

  if (sentTick !== null) {
    figures.push({ label: t('ending.messageYear'), value: String(yearOfTick(sentTick)) });
  }

  return { title: t('ending.title'), lede: t('ending.body'), figures };
}
