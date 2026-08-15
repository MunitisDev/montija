/**
 * How a settlement's people age, are born, and die of old age.
 *
 * Data rather than code, so the shape of a population is something to tune
 * rather than something to refactor.
 *
 * Deliberately not a family simulation. There are no couples, no genders, no
 * relationships and no inheritance: the brief asks for a settlement survival
 * game, warns against implementing dozens of needs, and none of that would earn
 * its complexity yet. What is modelled is the only part the player actually
 * plays against — that people take years to become useful, eat the whole time,
 * and eventually die.
 */

/** The age at which a villager starts taking jobs. */
export const WORKING_AGE = 15;

/**
 * The span of a life, in years.
 *
 * Each villager is given a lifespan from this range when they are born, drawn
 * from the seeded stream, so a settlement does not lose its whole founding
 * generation in the same winter.
 */
export const LIFESPAN_MIN = 55;
export const LIFESPAN_MAX = 78;

/** Age range of the founding settlers. Adults, with working years ahead. */
export const FOUNDER_AGE_MIN = 18;
export const FOUNDER_AGE_MAX = 45;

/** Years within which a villager may have a child. */
export const CHILDBEARING_AGE_MIN = 18;
export const CHILDBEARING_AGE_MAX = 42;

/**
 * What a household needs before it will take on a child.
 *
 * A settlement that cannot feed itself should not grow — not as a punishment,
 * but because a child is another mouth for fifteen years before it is another
 * pair of hands, and a village on the edge of starvation growing itself to
 * death is a frustrating thing to watch and not a decision the player made.
 */
export const BIRTH_REQUIREMENTS = {
  /** Days of food in store, per villager, before a birth is considered. */
  foodDaysPerPerson: 12,
  /** Minimum health among the household's adults. */
  minimumHealth: 70,
  /** Days between births in the same household. */
  cooldownDays: 40,
} as const;

/**
 * Chance per household per day, once every requirement is met.
 *
 * Low on purpose. A settlement should grow over years, not seasons — the brief
 * asks for "many years" — and a slow curve gives the player time to notice the
 * population rising and build ahead of it.
 */
export const BIRTH_CHANCE_PER_DAY = 0.04;
