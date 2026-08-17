/**
 * Who died, how old they were, and what killed them.
 *
 * The chronicle already counted the dead. A number is the one thing that cannot
 * answer the question a player asks when a settlement fails, which is never "how
 * many" — it is **"what went wrong, and when"**. Four people dead of cold in one
 * winter and four dead of old age across twenty years are the same tally and
 * opposite settlements.
 *
 * So each death is written down once, as it happens, with the name, the age, the
 * season it fell in and the cause. Kept in the simulation rather than assembled
 * by the end screen for the reason every history is: by the time anybody reads
 * it, the people it is about are gone and cannot be measured.
 *
 * **The causes are the ones the simulation actually has.** Hunger and cold each
 * drain health, and health at zero is death; old age arrives on its own
 * schedule. Illness is deliberately *not* a cause, because in this game it does
 * not kill anybody: a case costs somebody their working days, and the settlement
 * dies of the starvation that follows in winter. Listing it would be inventing a
 * mechanic on a screen whose whole job is to explain what really happened — so
 * instead each record notes whether they were ill at the end, which is a true
 * thing that was true of them.
 */

import type { BuildingId } from '@/data/buildings';
import type { SkillLevel } from '@/data/skills';
import type { Season } from '@/simulation/seasons/SeasonClock';
import type { Sex, Villager } from '@/simulation/villagers/Villager';

/**
 * What took somebody.
 *
 * `hungerAndCold` is its own cause rather than a coin toss between the other
 * two: a villager who was starving *and* freezing is the settlement failing at
 * both, and picking one of them for the roll would misreport a winter.
 */
export type DeathCause = 'hunger' | 'cold' | 'hungerAndCold' | 'oldAge';

export const DEATH_CAUSES: readonly DeathCause[] = ['hunger', 'cold', 'hungerAndCold', 'oldAge'];

/** One line of the roll. Plain data, so it writes to a save as-is. */
export interface DeathRecord {
  readonly name: string;
  readonly sex: Sex;
  /** Age in years, as they were on the day. */
  readonly age: number;
  readonly cause: DeathCause;
  /** Settlement year, counting from 1. */
  readonly year: number;
  readonly season: Season;
  /** `true` when they were ill at the end. Never the cause — see the header. */
  readonly ill: boolean;
  /** The trade they had spent longest at, or `null` for a labourer or a child. */
  readonly trade: BuildingId | null;
  /**
   * How far they got at that trade. `'none'` whenever `trade` is `null`.
   *
   * Recorded rather than derived because experience dies with the person: a
   * master mason is the settlement's whole quarry output, and the roll should say
   * so on the line where the settlement lost her.
   */
  readonly level: SkillLevel;
}

/**
 * Which of hunger and cold had run out when health did.
 *
 * Read off the needs at the moment of death, which is the only place the answer
 * exists: health is a single number and does not remember what drained it.
 * Health only falls while a need is empty, so at least one of the two is always
 * zero here; the `hungerAndCold` fallback covers the impossible case rather than
 * guessing at it.
 */
export function causeOfDeath(villager: Villager): DeathCause {
  const starving = villager.needs.hunger <= 0;
  const freezing = villager.needs.warmth <= 0;
  if (starving && !freezing) {
    return 'hunger';
  }
  if (freezing && !starving) {
    return 'cold';
  }
  return 'hungerAndCold';
}

/** The settlement's roll of the dead, in the order they died. */
export class Necrology {
  private readonly records: DeathRecord[] = [];

  public record(
    villager: Villager,
    cause: DeathCause,
    when: { readonly year: number; readonly season: Season },
  ): void {
    const trade = villager.bestTrade;
    this.records.push({
      name: villager.name,
      sex: villager.sex,
      age: villager.age,
      cause,
      year: when.year,
      season: when.season,
      ill: villager.isIll,
      trade,
      level: trade === null ? 'none' : villager.skillAt(trade),
    });
  }

  public get all(): readonly DeathRecord[] {
    return this.records;
  }

  public get count(): number {
    return this.records.length;
  }

  /** How many went to each cause. Every cause appears, including at zero. */
  public byCause(): Readonly<Record<DeathCause, number>> {
    const counts: Record<DeathCause, number> = {
      hunger: 0,
      cold: 0,
      hungerAndCold: 0,
      oldAge: 0,
    };
    for (const record of this.records) {
      counts[record.cause] += 1;
    }
    return counts;
  }

  /** Mean age at death, or `null` while nobody has died. */
  public averageAge(): number | null {
    if (this.records.length === 0) {
      return null;
    }
    const total = this.records.reduce((sum, record) => sum + record.age, 0);
    return total / this.records.length;
  }

  public restore(records: readonly DeathRecord[]): void {
    this.records.length = 0;
    this.records.push(...records);
  }

  public clear(): void {
    this.records.length = 0;
  }
}
