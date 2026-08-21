/**
 * The closing page: what this settlement was, and how each of them died.
 *
 * When the last villager goes the game used to say four words and offer a button.
 * That is the wrong amount of ceremony for something the player spent an hour on,
 * and worse, it withholds the one thing they want: **why**. A settlement that
 * starves in its second winter and one that quietly ages out over thirty years
 * end with the same sentence.
 *
 * So the end screen is a roll. Every person who lived here, most recent first,
 * with their age, what took them, and the year it happened in. Above it the
 * settlement's own totals, and a count by cause — because "six of cold" read in
 * one line is the whole post-mortem, and it is the sentence a player carries into
 * the next attempt.
 *
 * **Most recent first, deliberately.** The deaths that ended the settlement are
 * the ones that explain it; the founders' names are history and can wait further
 * down the list.
 *
 * Pure, like the ledger: simulation and a translator in, plain rows out. The
 * screen that draws it decides nothing.
 */

import { DEATH_CAUSES, type DeathCause, type DeathRecord } from '@/simulation/history/Necrology';
import { hasColdReading } from '@/simulation/history/Chronicle';
import type { Simulation } from '@/simulation/Simulation';
import type { MessageKey } from '@/ui/i18n/messages';
import { yearOfTick, type Translate } from '@/ui/ledger/ledgerModel';

/** One labelled figure. */
export interface EndGameStat {
  readonly label: string;
  readonly value: string;
}

/** One person, as the roll lists them. */
export interface EndGameEntry {
  readonly name: string;
  /** Age at death, in years, as a bare number. */
  readonly age: string;
  /** What took them. */
  readonly cause: string;
  /** When, as `Y6 · Winter`. */
  readonly when: string;
  /** Their trade and whether they were ill, or `''` for a plain labourer. */
  readonly note: string;
}

export interface EndGameReport {
  /** How far the settlement got, as one line. */
  readonly ended: string;
  /** The settlement's own totals. */
  readonly stats: readonly EndGameStat[];
  /** Deaths by cause. Every cause appears, including at zero. */
  readonly causes: readonly EndGameStat[];
  readonly rollTitle: string;
  readonly roll: readonly EndGameEntry[];
  /**
   * Said under the roll when anybody died ill.
   *
   * Illness *is* one of the causes now, and this line is still worth keeping
   * beside it: how many of the settlement's dead were unwell when whatever took
   * them took them. On a `hunger` or `cold` line that is context — a sickbed is
   * where a bad winter finishes people — and on a `fire` line it is very nearly
   * the cause, since being ill doubles the chance of not getting out.
   */
  readonly illNote: string;
}

export function buildEndGame(simulation: Simulation, t: Translate): EndGameReport {
  const snapshot = simulation.snapshot();
  const chronicle = snapshot.chronicle;
  const records = snapshot.necrology;

  const stats: EndGameStat[] = [
    { label: t('chronicle.year'), value: String(yearOfTick(simulation.tick)) },
    { label: t('chronicle.peak'), value: String(chronicle.peakPopulation) },
    { label: t('chronicle.born'), value: String(chronicle.born) },
    { label: t('chronicle.arrived'), value: String(chronicle.arrived) },
    { label: t('chronicle.raised'), value: String(chronicle.buildingsRaised) },
    { label: t('chronicle.foodEaten'), value: String(Math.round(chronicle.foodEaten)) },
  ];
  if (hasColdReading(chronicle)) {
    stats.push({ label: t('chronicle.coldest'), value: `${Math.round(chronicle.coldest)}°` });
  }

  const average = simulation.necrology.averageAge();
  if (average !== null) {
    stats.push({ label: t('end.averageAge'), value: String(Math.round(average)) });
  }

  const counts = simulation.necrology.byCause();
  const causes: EndGameStat[] = DEATH_CAUSES.map((cause) => ({
    label: t(`death.${cause}` as MessageKey),
    value: String(counts[cause]),
  }));

  const ill = records.filter((record) => record.ill).length;

  return {
    ended: [
      t('failure.survived'),
      `${t('time.yearShort')}${snapshot.year}`,
      t(`season.${snapshot.season}` as MessageKey),
      `${t('time.dayShort')}${snapshot.dayOfSeason}`,
    ].join(' · '),
    stats,
    causes,
    rollTitle: t('end.roll'),
    // A copy, because the caller reverses it and the snapshot's array is the
    // simulation's own.
    roll: [...records].reverse().map((record) => entryFor(record, t)),
    illNote: ill === 0 ? '' : `${ill} ${t('end.wereIll')}`,
  };
}

function entryFor(record: DeathRecord, t: Translate): EndGameEntry {
  const notes: string[] = [];
  if (record.trade) {
    const trade = t(`building.${record.trade}` as MessageKey);
    notes.push(
      record.level === 'none' ? trade : `${trade} · ${t(`skill.${record.level}` as MessageKey)}`,
    );
  }
  if (record.ill) {
    notes.push(t(`death.ill.${record.sex}` as MessageKey));
  }

  return {
    name: record.name,
    age: String(record.age),
    cause: t(`death.${record.cause}` as MessageKey),
    when: `${t('time.yearShort')}${record.year} · ${t(`season.${record.season}` as MessageKey)}`,
    note: notes.join(' · '),
  };
}

/**
 * How many graves the cemetery's panel shows before it stops counting.
 *
 * A settlement that lasts twenty years buries dozens of people, and the panel it
 * would have to grow to in order to list all of them is a panel that covers the
 * settlement. The newest are the ones a player is looking for — somebody died
 * *just now* and they want to know who — so the roll is newest-first and the
 * older graves are counted rather than drawn.
 */
export const BURIAL_ROLL_LIMIT = 24;

export interface BurialRoll {
  /** Newest first: the death a player is asking about is the last one. */
  readonly entries: readonly EndGameEntry[];
  /** Graves beyond the limit. `0` when the roll is complete. */
  readonly more: number;
  /** The whole count, including the ones not listed. */
  readonly total: number;
}

/**
 * Who lies in the settlement's ground, for the Cemetery's own panel.
 *
 * **Asked for: a death should leave a name somewhere.** People died and simply
 * stopped being in the list — the end screen read the roll out afterwards, which
 * is exactly too late to be any use. A cemetery is where a settlement keeps its
 * dead, so it is where the game should be able to name them.
 *
 * The settlement's dead rather than this cemetery's: nothing in the simulation
 * records *which* ground somebody went into, and inventing that to split one
 * roll across two cemeteries would be a mechanic for the sake of a list. Two
 * cemeteries therefore show the same names, which is the honest reading of a
 * settlement burying its people rather than a plot register.
 *
 * Shares `entryFor` with the end screen deliberately: one roll, formatted one
 * way, whether it is read during the game or after it.
 */
export function burialRoll(simulation: Simulation, t: Translate): BurialRoll {
  const records = simulation.necrology.all;
  const newest = [...records].reverse();
  return {
    entries: newest.slice(0, BURIAL_ROLL_LIMIT).map((record) => entryFor(record, t)),
    more: Math.max(0, newest.length - BURIAL_ROLL_LIMIT),
    total: newest.length,
  };
}

/**
 * Deaths by cause, for the ledger's chronicle page while the game is still on.
 *
 * The same question as the end screen's, asked at a point where the player can
 * still do something about the answer. Only causes that have actually taken
 * somebody appear: four zeroes on a settlement that has never lost anybody reads
 * as a list of things about to go wrong.
 */
export function deathsByCause(
  simulation: Simulation,
  t: Translate,
): readonly (EndGameStat & { readonly cause: DeathCause })[] {
  const counts = simulation.necrology.byCause();
  return DEATH_CAUSES.filter((cause) => counts[cause] > 0).map((cause) => ({
    cause,
    label: t(`death.${cause}` as MessageKey),
    value: String(counts[cause]),
  }));
}
