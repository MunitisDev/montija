/**
 * Getting ill, and getting better.
 *
 * Health already existed and had exactly one cause: it fell when somebody was
 * starving or freezing, and rose otherwise. That makes it a second display of
 * hunger and warmth rather than a thing of its own — and it means a settlement
 * with full stores can never be in any trouble at all, however large or badly
 * housed it gets.
 *
 * Illness is the thing of its own. It arrives on its own schedule, it is far
 * worse for people with no roof over them, and it does not care how full the
 * granary is. It is the reason to build something whose only output is that
 * people stop dying.
 *
 * **Illness costs work, not health**, and that took three measurements to
 * arrive at. Every version that drained health did the same damage to the shape
 * of the game: a settlement that would have reached winter lost somebody in
 * *autumn* instead, because a villager who had been ill during the good days
 * met the bad ones with less to spare. Softening the numbers did not help, and
 * neither did a floor, and neither did suppressing the drain while somebody was
 * already starving — the front-loading was the problem, not its size.
 *
 * So an ill villager simply stops working. That is a real cost, and in a
 * marginal settlement it is still a fatal one — but it kills by *starvation, in
 * winter*, which is the failure this whole game is about. It also scales the
 * right way: a big settlement has more cases, loses more hands, and needs a
 * healer for reasons a small one does not.
 *
 * One more deliberate limit: **nothing is contagious.** Each villager is rolled
 * independently. Modelling spread would make outbreaks a curve to be studied
 * rather than a problem to be answered, and the answer would still be "build a
 * healer".
 */

import type { SeededRandom } from '@/shared/math/random';
import type { Villager } from '@/simulation/villagers/Villager';

/**
 * Chance per villager per day of falling ill when everything is going well.
 *
 * Deliberately small: over a year a settlement of twenty under a roof sees a
 * handful of cases. Enough that a healer is worth having, far too few to be a
 * treadmill.
 *
 * The figure is measured rather than picked. A case costs {@link ILLNESS_DAYS}
 * of somebody's work, and a ten-person settlement only has two or three pairs
 * of hands not already committed to a workshop — so the labour bill is a good
 * deal steeper than the case count suggests. At twice this rate a settlement
 * playing well lost most of the food it had banked for winter, which made
 * sickness the game's dominant mechanic rather than its third one.
 */
export const BASE_ILLNESS_CHANCE = 0.002;

/**
 * How much more likely illness is for somebody with no roof over them.
 *
 * **Exposure only, and that took two measurements to arrive at.** The first
 * attempt also counted hunger and cold, on the reasoning that illness should
 * put teeth on the things the player is already managing. Measured, it did the
 * opposite: a starving settlement caught something, lost most of its remaining
 * health to it, and died in *autumn* — so sickness had quietly become the
 * primary cause of death and winter, which this whole game is about, never got
 * to make its case. Softening it did not help, because the compounding was the
 * problem rather than the numbers.
 *
 * Hunger kills by starvation and cold kills by freezing. Illness is the third
 * thing, and it is third precisely because it is *not* a consequence of the
 * other two: a settlement with full stores can still be in trouble, which is
 * the only reason the mechanic is worth having.
 */
export const EXPOSURE_MULTIPLIER = 5;

/**
 * How much of the settlement's sickness a fully varied diet keeps away.
 *
 * **This is where food variety turns into life expectancy**, and it does it
 * without the population system knowing anything about food. A day spent unwell
 * is already a day off the end of a life — that is what makes a Healer worth
 * building — so a settlement that eats a spread of things falls ill less, spends
 * fewer days ill, and lives longer for it. The chain is three rules long and
 * every link was already there.
 *
 * A third, deliberately below the roof's five-fold exposure: eating well helps,
 * and having somewhere to sleep helps far more. A settlement should never be
 * able to eat its way out of homelessness.
 */
export const DIET_HEALTH_SHARE = 1 / 3;

/** Days a case lasts on its own. */
export const ILLNESS_DAYS = 8;

/** How much of that a fully staffed, supplied healer removes. */
export const CARE_RECOVERY_SHARE = 0.75;

/** Herbs used per patient per day of care. */
export const HERBS_PER_PATIENT_PER_DAY = 0.5;

export interface IllnessReport {
  /** People who fell ill today. */
  readonly fellIll: number;
  /** People who recovered today. */
  readonly recovered: number;
  /** People ill right now. */
  readonly ill: number;
  /** How much of the settlement's sickness was being treated, in `0..1`. */
  readonly careFraction: number;
  readonly herbsUsed: number;
}

export const NO_ILLNESS: IllnessReport = {
  fellIll: 0,
  recovered: 0,
  ill: 0,
  careFraction: 0,
  herbsUsed: 0,
};

/**
 * Runs one day of sickness.
 *
 * `care` is how much treatment the settlement can offer, in `0..1` — the
 * healer's staffing and its herbs, worked out by the caller, because how a
 * building is staffed and supplied is not this system's business.
 */
export function runIllness(
  villagers: readonly Villager[],
  random: SeededRandom,
  care: number,
  /**
   * How varied the settlement's larder is, in `0..1`.
   *
   * Passed in rather than worked out here, for the same reason `care` is: what
   * is on the shelves is not this system's business. Defaults to nothing, which
   * is the rate the game always ran at.
   */
  nourishment = 0,
): IllnessReport {
  let fellIll = 0;
  let recovered = 0;
  let ill = 0;

  for (const villager of villagers) {
    if (villager.illDaysRemaining > 0) {
      // **A day spent unwell is a day off the end of a life.** Counted here,
      // spent in `PopulationSystem`. This is what makes a Healer's House worth
      // building rather than a convenience: shortening cases lengthens lives,
      // so the settlement's life expectancy is something the player builds.
      villager.illDaysLived += 1;

      // Care shortens a case rather than curing it outright: a healer is
      // somebody who gets you through it, not a switch that turns it off.
      villager.illDaysRemaining -= 1 + CARE_RECOVERY_SHARE * care * ILLNESS_DAYS;

      if (villager.illDaysRemaining <= 0) {
        villager.illDaysRemaining = 0;
        recovered += 1;
      } else {
        ill += 1;
      }
      continue;
    }

    if (random.next() < chanceFor(villager, nourishment)) {
      villager.illDaysRemaining = ILLNESS_DAYS;
      fellIll += 1;
      ill += 1;
    }
  }

  return {
    fellIll,
    recovered,
    ill,
    careFraction: care,
    herbsUsed: 0,
  };
}

/**
 * How likely this villager is to fall ill today.
 *
 * Rolled per person rather than from a settlement-wide figure, because
 * housing is per person: the villagers sleeping rough are the ones who get
 * sick, and they are the ones the player can do something about.
 */
export function chanceFor(villager: Villager, nourishment = 0): number {
  const exposed = villager.homeId === null;
  const wellFed = 1 - DIET_HEALTH_SHARE * Math.max(0, Math.min(1, nourishment));
  return Math.min(1, BASE_ILLNESS_CHANCE * (exposed ? EXPOSURE_MULTIPLIER : 1) * wellFed);
}
