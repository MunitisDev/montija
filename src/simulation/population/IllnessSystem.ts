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
 * **And it spreads**, which it did not for a long time. The old rule was that
 * each villager was rolled independently, on the reasoning that an epidemic
 * curve is a thing to be studied rather than a problem to be answered. That
 * reasoning was wrong about which curve it would be: rolled independently,
 * sickness scales with population and with nothing else, so it is the one
 * hardship in the game a player cannot make better or worse. Contagion is what
 * gives it a shape the settlement's own plan decides.
 *
 * The channels are both places the player put people:
 *
 * - **A household.** Sharing a roof with somebody ill is far and away the
 *   likeliest way to catch anything, so a settlement that put fourteen people in
 *   three houses passes it round those houses. Crowding is a real saving — fewer
 *   houses, less firewood, less hauling — and this is what it costs.
 * - **The settlement.** A weaker channel, from working alongside people: it
 *   scales with the *share* of the settlement that is ill rather than the count,
 *   so a large village is not doomed by being large.
 *
 * People sleeping rough are *not* a household, which was tried the other way
 * round and measured away — see {@link roughSleeper}.
 *
 * And **water within reach of the houses holds it down** — the same Well, river
 * or channel that puts out fires. Washing is the answer a medieval settlement
 * actually had, it is a decision made seasons before the outbreak, and it gives
 * the Well a second reason to exist. It works on the spreading only: what
 * arrives on its own arrives anyway.
 */

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

/**
 * Chance of catching it from each person ill under the same roof, per day.
 *
 * By far the largest number in this file, and it has to be: a case lasts
 * {@link ILLNESS_DAYS}, so living with one sick person for the length of their
 * illness is roughly one chance in five. That is what makes a house a household
 * rather than a bed count, and what makes the fourth and fifth person in a
 * cottage cost something.
 *
 * It is per ill housemate rather than a flat rate, so two cases in one house is
 * worse than one — which is how a crowded settlement gets an outbreak and a
 * spread-out one gets a fortnight of somebody being unwell.
 *
 * **Measured, not chosen.** Across six settlements played out over eight years,
 * this rate makes rather more than a *third* of all illness contagious — 43
 * cases caught out of 89 — which is the point of adding it: below that it is a
 * rounding error on the base rate, and the mechanic may as well not exist.
 * Higher was tried and rejected. At 0.05 the share of caught cases rises to a
 * little over half and the difficulty curve visibly bends: a settlement living
 * off a single Gatherer Hut, which is *meant* to stand still rather than fail,
 * lost two of eight worlds outright instead of one. A hardship that turns a
 * mediocre plan into a wipe-out is not depth.
 */
export const HOUSEHOLD_CONTAGION = 0.03;

/**
 * Chance of catching it from the settlement at large, per day, when everybody
 * in it is ill.
 *
 * Multiplied by the share who actually are, so this is the *ceiling* rather than
 * the rate. Deliberately a twentieth of the household channel: standing in the
 * same valley as somebody unwell is not the same as sleeping beside them, and
 * scaling by share rather than by count is what keeps a settlement of forty from
 * being punished for existing.
 */
export const SETTLEMENT_CONTAGION = 0.02;

/**
 * How many ill housemates count, at most.
 *
 * **A cap, and it is not tidiness — it is the difference between a hardship and
 * a trap.** Without one the channel is linear in the household, and two
 * households in this game are enormous: a cottage the player has crammed
 * fourteen people into, and the settlement's homeless, who share a household by
 * the rule above. Ten people sleeping rough with one case among them meant all
 * ten of them ill inside a week — and every settlement *starts* with ten people
 * sleeping rough, so measured, the game's first autumn began killing people who
 * should have died in winter, which is the one shape this whole design protects.
 *
 * Three is the honest reading anyway: sleeping in a crowded room is worse than
 * sleeping in an empty one, and the fourth sick person in it does not make it
 * meaningfully worse than the third. The crowding lesson is intact — one, two and
 * three ill under the same roof are three different risks — and the heap is no
 * longer a death sentence.
 */
export const MOST_INFECTIOUS_HOUSEMATES = 3;

/**
 * How much of the spreading water within reach of the homes keeps away.
 *
 * Half, and only of the spreading. A settlement with a Well by its houses has
 * outbreaks that peter out; one drawing from nothing has outbreaks that go round
 * the houses twice. What it cannot do is stop people falling ill in the first
 * place, which is the difference between hygiene and medicine — the second one
 * is the Healer's job.
 */
export const WASHING_SHARE = 0.5;

/** Days a case lasts on its own. */
export const ILLNESS_DAYS = 8;

/** How much of that a fully staffed, supplied healer removes. */
export const CARE_RECOVERY_SHARE = 0.75;

/** Herbs used per patient per day of care. */
export const HERBS_PER_PATIENT_PER_DAY = 0.5;

/**
 * Chance an ill villager in their prime dies of it, per day unwell.
 *
 * **This reverses the oldest rule in this file, and the reversal is narrower
 * than it looks.** What was measured away three times was illness *draining
 * health*: a villager who had been unwell during the good days met the bad ones
 * with less to spare, so settlements that should have died in winter died in
 * autumn instead. A drain compounds with everything else and front-loads the
 * year. A discrete roll does not: it is a small chance each day, it takes the
 * frail rather than everybody, and it cannot quietly hollow out a settlement
 * that is otherwise fine.
 *
 * At this rate a whole case — {@link ILLNESS_DAYS} of it, untreated — is about one
 * chance in sixty for a twenty-year-old and nearly one in four for somebody of
 * sixty-eight. See {@link AGE_DOUBLING} for the curve, which is the point of the
 * mechanic.
 *
 * **Measured, and the first figure tried was four times smaller.** At 0.0008 the
 * rule was invisible: six settlements played out over twenty years buried *two*
 * people of illness between them, because a settlement that collapses in its
 * eighth year never has anybody old enough for the age term to matter. Raising it
 * changed nothing about the shape of the year — every claim in
 * `tests/balance.test.ts` still holds — and made the mechanic something a player
 * can actually see: 23 deaths over the same twelve decades of settlement, against
 * **one** for the same settlements with a Healer's House standing. That contrast
 * is the whole reason the rule exists.
 */
export const MORTAL_BASE = 0.002;

/** The age {@link MORTAL_BASE} is quoted at. */
export const PRIME_AGE = 20;

/**
 * Years of age in which the risk doubles.
 *
 * **Age is the strongest term by far, and doubling is the honest shape of it.**
 * Twelve years is steep enough that a settlement's elders are genuinely at risk
 * of not surviving a bad winter's illness and its young adults are barely
 * touched, which is what makes a Healer's House something a mature settlement
 * needs more than a new one:
 *
 * | Age | Chance of dying of one untreated case |
 * | --- | ------------------------------------- |
 * | 8   | 0.2%                                  |
 * | 20  | 0.6%                                  |
 * | 32  | 1.3%                                  |
 * | 44  | 2.5%                                  |
 * | 56  | 5.0%                                  |
 * | 68  | 9.6%                                  |
 *
 * Children are below a young adult rather than above them, which is a
 * deliberate departure from real medieval mortality: the curve the player asked
 * for is "the older, the worse", and a game that killed infants at the true
 * historical rate would be about something else. They are not immune, because a
 * monotonic curve with a hole in it is a rule nobody could reason about.
 */
export const AGE_DOUBLING = 12;

/**
 * How much of the risk a fully staffed, supplied healer takes away.
 *
 * Seven tenths, and it stacks with the case being shorter — {@link
 * CARE_RECOVERY_SHARE} — so a Healer's House cuts both the number of days at
 * risk and the risk of each day. That double return is deliberate: the building
 * has no output, costs two pairs of hands and a shelf of herbs, and the only
 * thing it can offer in exchange is that people the settlement would have buried
 * are still alive.
 *
 * Not ten tenths, ever. A healer who guaranteed survival would make the whole
 * mechanic a checkbox: build one, stop thinking about it.
 */
export const CARE_SURVIVAL_SHARE = 0.7;

/**
 * What an empty need adds to the risk, each.
 *
 * Being cold and being hungry are the two the player is already managing, and
 * this is where they meet the sickbed: an ill villager who is also freezing and
 * starving carries a little over three times the risk of a warm, fed one.
 *
 * Deliberately a *multiplier on a small number* rather than another way to lose
 * health. That is the whole distinction this file rests on — hunger and cold
 * still kill by themselves, on their own schedule, and what they do here is make
 * an illness the thing that finishes a bad winter rather than a second race
 * running alongside it.
 */
export const FRAILTY = 0.75;

export interface IllnessReport {
  /** People who fell ill today. */
  readonly fellIll: number;
  /**
   * How many of those took it from somebody else rather than falling ill on
   * their own.
   *
   * Attributed exactly rather than estimated: one roll per person is compared
   * first against what they would have caught alone and then against the total,
   * so the difference between the two is what the outbreak did.
   */
  readonly caught: number;
  /** People who recovered today. */
  readonly recovered: number;
  /**
   * Villagers who died of it today, by id.
   *
   * Ids rather than the villagers, because this system decides who does not
   * recover and `Simulation` owns what a death means for the roll of the dead,
   * the household and the jobs they were holding.
   */
  readonly died: readonly number[];
  /** People ill right now. */
  readonly ill: number;
  /** How much of the settlement's sickness was being treated, in `0..1`. */
  readonly careFraction: number;
  readonly herbsUsed: number;
}

export const NO_ILLNESS: IllnessReport = {
  fellIll: 0,
  caught: 0,
  recovered: 0,
  died: [],
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
  /**
   * Where the day's luck comes from.
   *
   * Narrowed to the one method this system uses, so a test can hand it a day
   * that always catches or one that never does — which is the only way to hold a
   * rate of three in a hundred to account.
   */
  random: { next(): number },
  care: number,
  /**
   * How varied the settlement's larder is, in `0..1`.
   *
   * Passed in rather than worked out here, for the same reason `care` is: what
   * is on the shelves is not this system's business. Defaults to nothing, which
   * is the rate the game always ran at.
   */
  nourishment = 0,
  /**
   * How much of the settlement can wash, in `0..1` — the share of housed people
   * with water within reach of their home.
   *
   * Passed in for the third time for the same reason as the other two: where the
   * water is is the world's business, not this system's. Defaults to nothing,
   * which is a settlement drawing from puddles.
   */
  hygiene = 0,
): IllnessReport {
  let fellIll = 0;
  let caught = 0;
  let recovered = 0;
  let ill = 0;
  const died: number[] = [];

  // **Who is ill is counted before anybody is resolved**, and it has to be: walk
  // the list live and the first person to fall ill this morning is infecting
  // their family by the afternoon, which chains a whole household in a day and
  // makes the outcome depend on the order the villagers happen to be stored in.
  // Today's exposure is yesterday's sick list.
  const sickAtHome = new Map<number, number>();
  let sickTotal = 0;
  for (const villager of villagers) {
    if (villager.illDaysRemaining > 0) {
      const household = villager.homeId ?? roughSleeper(villager);
      sickAtHome.set(household, (sickAtHome.get(household) ?? 0) + 1);
      sickTotal += 1;
    }
  }
  const illShare = villagers.length === 0 ? 0 : sickTotal / villagers.length;
  const washing = 1 - WASHING_SHARE * clamp(hygiene);

  for (const villager of villagers) {
    if (villager.illDaysRemaining > 0) {
      // **A day spent unwell is a day off the end of a life.** Counted here,
      // spent in `PopulationSystem`. This is what makes a Healer's House worth
      // building rather than a convenience: shortening cases lengthens lives,
      // so the settlement's life expectancy is something the player builds.
      villager.illDaysLived += 1;

      // **And a day unwell is a day that can be the last one.** Rolled before
      // the case is advanced, so the day they would have recovered on is still a
      // day they were ill — and rolled per day rather than per case, which is
      // what makes a healer shortening the illness worth something twice over.
      if (random.next() < mortalRiskFor(villager, care)) {
        villager.illDaysRemaining = 0;
        died.push(villager.id);
        continue;
      }

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

    const household = villager.homeId ?? roughSleeper(villager);
    const contagion =
      (HOUSEHOLD_CONTAGION * Math.min(MOST_INFECTIOUS_HOUSEMATES, sickAtHome.get(household) ?? 0) +
        SETTLEMENT_CONTAGION * illShare) *
      washing;

    // One roll, read twice: below their own chance and they would have fallen
    // ill in an empty valley, below the total and the settlement gave it to
    // them. Two rolls would answer the same question and spend twice as much of
    // a stream a save has to remember the position of.
    const roll = random.next();
    if (roll < chanceFor(villager, nourishment, contagion)) {
      villager.illDaysRemaining = ILLNESS_DAYS;
      fellIll += 1;
      ill += 1;
      if (roll >= chanceFor(villager, nourishment)) {
        caught += 1;
      }
    }
  }

  return {
    fellIll,
    caught,
    recovered,
    died,
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
export function chanceFor(
  villager: Villager,
  nourishment = 0,
  /**
   * What the people around them add today, worked out by {@link runIllness}.
   *
   * Additive rather than a multiplier, because it is a second way of catching
   * something and not a worse version of the first: a villager with no roof
   * sleeping alone in a healthy valley is exposed, and one in a warm house full
   * of sick children is infected. Both, and the two do not need to agree.
   */
  contagion = 0,
): number {
  const exposed = villager.homeId === null;
  const wellFed = 1 - DIET_HEALTH_SHARE * clamp(nourishment);
  const own = BASE_ILLNESS_CHANCE * (exposed ? EXPOSURE_MULTIPLIER : 1);
  // Eating well resists what is going round as well as what is not: a body that
  // has had a winter of nothing but roots is the one that takes it.
  return Math.min(1, (own + Math.max(0, contagion)) * wellFed);
}

/**
 * How likely this villager is to die of what they have, today.
 *
 * Four terms, and each one is something the player either decided or can do
 * something about:
 *
 * - **their age**, doubling every {@link AGE_DOUBLING} years, which is the term
 *   that dominates and the reason a settlement of elders is fragile in a way a
 *   settlement of twenty-year-olds is not;
 * - **whether anybody is treating them** — {@link CARE_SURVIVAL_SHARE};
 * - **whether they are warm**, which is firewood and a roof;
 * - **whether they are fed**, which is the larder.
 *
 * Multiplicative, so the frail old man in an unheated house during a hard winter
 * is in real danger and the fed, warm young woman is very nearly not. Capped at
 * one, which nothing in this game's numbers can reach.
 */
export function mortalRiskFor(villager: Villager, care = 0): number {
  const age = Math.pow(2, (villager.age - PRIME_AGE) / AGE_DOUBLING);
  const cold = 1 + FRAILTY * (1 - clamp(villager.needs.warmth / 100));
  const hungry = 1 + FRAILTY * (1 - clamp(villager.needs.hunger / 100));
  const treated = 1 - CARE_SURVIVAL_SHARE * clamp(care);
  return Math.min(1, MORTAL_BASE * age * cold * hungry * treated);
}

/**
 * A household key for somebody with no household.
 *
 * **They do not share one, and that is a rule that was tried and measured
 * away.** Written first as "the homeless are one household", which is both
 * evocative and, in a settlement of any size, a death sentence: every game
 * *begins* with all ten settlers sleeping rough, so a single case in the first
 * fortnight went round all ten of them, and the settlement lost most of its
 * hands in the exact week it needed them to find stone. Measured, the first
 * death moved out of winter and into autumn — and a well-played settlement's
 * deaths across twenty-four worlds doubled while a careless one's did not
 * change, which is the difficulty curve pointing the wrong way. Capping how many
 * ill housemates count softened it and did not fix it.
 *
 * So sleeping rough is dangerous for the reason it always was —
 * {@link EXPOSURE_MULTIPLIER}, five times the chance of falling ill at all — and
 * the settlement channel still reaches them. What it is not is a shared roof,
 * because they have no roof. Negative and unique per person, so nobody can
 * collide with a building id or with each other.
 */
function roughSleeper(villager: Villager): number {
  return -villager.id - 1;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
