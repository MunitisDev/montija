/**
 * How a settlement's people age, are born, and die of old age.
 *
 * Data rather than code, so the shape of a population is something to tune
 * rather than something to refactor.
 *
 * A family simulation only as far as it earns its keep. There are couples,
 * households, parents and children, because a settlement whose people are
 * interchangeable is a settlement nobody minds losing — and because who is of an
 * age to work, to marry and to bear children is the whole of a village's growth
 * curve. There is no inheritance, no kinship beyond parents, and no ambition to
 * add either.
 */

/**
 * The age at which a villager starts taking jobs.
 *
 * **Not the same as being grown up**, and the difference matters. A fourteen
 * year old works — fetches, carries, helps at the hut — but does not marry, does
 * not take a house of their own, and does not count against a house's four
 * grown-ups. Those three belong to {@link ADULT_AGE}.
 *
 * Conflating the two was quietly costing the settlement four years of every
 * villager's labour and, worse, was filling houses with children who counted as
 * adults — so a family of four blocked every birth in the village.
 */
export const WORKING_AGE = 14;

/**
 * The age at which a villager becomes one of the household's grown-ups.
 *
 * Marries, may take a house, and occupies one of its four adult places. A
 * villager who reaches this age in their parents' house will move out when there
 * is somebody to move out with.
 */
export const ADULT_AGE = 18;

/**
 * The age at which a villager stops working.
 *
 * They still live in the settlement, still eat, still need a fire and still take
 * up a place at home — they simply do not work any more. That is the cost of a
 * long-lived village, and it is a cost worth having: it makes the working-age
 * share of a population something the player can watch and plan around rather
 * than a number that only ever goes up.
 */
export const RETIREMENT_AGE = 60;

/**
 * The span of a life, in years, before illness takes its share.
 *
 * Centred near seventy. Each villager is given a lifespan from this range when
 * they are born, drawn from the seeded stream, so a settlement does not lose its
 * whole founding generation in the same winter.
 *
 * This is the number a villager would reach in perfect health. What they
 * actually reach is this minus what sickness cost them — see
 * {@link ILL_DAYS_PER_YEAR_LOST}.
 */
export const LIFESPAN_MIN = 64;
export const LIFESPAN_MAX = 76;

/**
 * Days of illness that cost a villager a year of life.
 *
 * **This is what a Healer's House is worth.** A healer shortens illnesses, and
 * until now that bought the settlement nothing but a few working days back —
 * the case ended either way and nobody died of it. Tying the length of illnesses
 * to the length of lives means the building that shortens them raises the whole
 * settlement's life expectancy, which is a far better reason to build one.
 *
 * A dozen days: a full season spent unwell costs a year. An untended settlement
 * running two or three long cases a person over a lifetime loses several years
 * off seventy; a well-tended one barely notices.
 */
export const ILL_DAYS_PER_YEAR_LOST = 12;

/**
 * Age range of the founding settlers.
 *
 * Capped at forty rather than above it. A founder rolled at fifty could never
 * have a child and would retire within ten years — a settler too old to help
 * found anything, which is not a decision the player made or could see. People
 * who walk out of a place in the night are whoever could walk.
 */
export const FOUNDER_AGE_MIN = 18;
export const FOUNDER_AGE_MAX = 40;

/**
 * How many of the founding party are young people rather than grown-ups.
 *
 * **The settlement needs a second generation sooner than it can grow one.** The
 * founders pair off on the first day and have children within the year, and
 * those children are eighteen in year eighteen — so a village's working
 * population barely moves for a decade and a half, and then arrives all at once.
 *
 * A few near-adults in the party close that gap: they come of age within a year
 * or two, pair with each other, and give the settlement a wave of households
 * before the founders' own children are anywhere near grown. They are also the
 * right people to be walking out of a place that was attacked — a group fleeing
 * in the night is families, not a work detail.
 */
export const FOUNDING_YOUNG_SHARE = 0.3;

/** Ages of those young people: close enough to adulthood to matter soon. */
export const FOUNDING_YOUNG_AGE_MIN = 14;
export const FOUNDING_YOUNG_AGE_MAX = 17;

/**
 * Years within which a **woman** may bear a child.
 *
 * The window belongs to the mother, and it is hers alone: a household needs a
 * father who is a grown-up and nothing more of him. Applying the same range to
 * both was simpler and wrong in a way that mattered — it retired a couple the
 * moment *either* of them aged out, so a woman of thirty could stop having
 * children because her husband turned forty-one.
 */
export const CHILDBEARING_AGE_MIN = 18;
export const CHILDBEARING_AGE_MAX = 40;

/**
 * The widest gap in years between two people who will pair up.
 *
 * Pairing used to be done by lining the unattached women and men up by id and
 * matching them off in order, which married a nineteen year old to a
 * forty-year-old whenever that was the order they happened to arrive in. Six
 * years keeps households plausible without making a small settlement sterile.
 *
 * Applies to a second marriage exactly as to a first: a widow of thirty-five and
 * a widower of forty will pair, and one of fifty-five will not.
 */
export const MAX_PAIR_AGE_GAP = 6;

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

/**
 * What draws newcomers to a settlement.
 *
 * Without this the game has a dead end with no way back: a settlement that
 * loses its last adults of childbearing age can never grow again, however well
 * the player then plays. Nothing arrives from outside, so the only outcome left
 * is a slow decline the player can watch but not change — which is a failure
 * state that fails to say so.
 *
 * Newcomers are earned rather than given. Word travels because a place has
 * spare beds and food to spare, so the requirements are the ones the player
 * controls, and they are stiffer than a birth's: a stranger walking out of the
 * woods wants more assurance than a family already living there.
 */
export const IMMIGRATION_REQUIREMENTS = {
  /** Days of food in store, per villager, before word gets round. */
  foodDaysPerPerson: 18,
  /**
   * Empty beds needed before anyone will make the journey.
   *
   * This is also the pacing. Each arrival fills the beds it needed, so a
   * settlement has to keep building to keep attracting people — no separate
   * cooldown required.
   */
  spareHousing: 2,
} as const;

/** Chance per day, once a settlement is worth walking to. */
export const IMMIGRATION_CHANCE_PER_DAY = 0.05;

/** How many arrive at once. A pair travels; a lone stranger is a sadder story. */
export const IMMIGRANTS_PER_ARRIVAL = 2;

/** Ages of the people who make that journey: young enough to start again. */
export const IMMIGRANT_AGE_MIN = 17;
export const IMMIGRANT_AGE_MAX = 38;
