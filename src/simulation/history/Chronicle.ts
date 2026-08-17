/**
 * What the settlement did, kept for the day somebody asks.
 *
 * A running tally of the things that only mean anything over a lifetime: how
 * many were born, how many were buried, how high the population ever got, what
 * was raised, what was eaten and burned, and the coldest night anyone lived
 * through.
 *
 * **Recorded as it happens rather than reconstructed.** Every figure here is
 * about the past, and the past is exactly what a snapshot of the present cannot
 * be asked for. A settlement of twelve tells you nothing about the forty who
 * lived there, and by the time the ship comes most of the people the chronicle
 * is about are gone.
 *
 * Deliberately small. It is a closing page, not an analytics pipeline: every
 * line has to be one a player would actually read at the end of a campaign.
 */

/** Totals since the settlement was founded. */
export interface Chronicle {
  born: number;
  died: number;
  /** Newcomers who walked in from outside, counted apart from the newborn. */
  arrived: number;
  peakPopulation: number;
  /** Buildings finished. Demolitions do not subtract — it still got built. */
  buildingsRaised: number;
  foodEaten: number;
  firewoodBurned: number;
  /** The lowest temperature the settlement has stood in, in degrees. */
  coldest: number;
  /** Days anybody spent a freezing night without a roof. */
  roughNights: number;
}

/**
 * A settlement on its first tick.
 *
 * `coldest` starts at `Number.POSITIVE_INFINITY` so the first reading wins
 * rather than being compared against a zero the settlement never saw. It is
 * shown as `--` until there has been a reading, which is the honest answer on
 * day one.
 */
export function newChronicle(): Chronicle {
  return {
    born: 0,
    died: 0,
    arrived: 0,
    peakPopulation: 0,
    buildingsRaised: 0,
    foodEaten: 0,
    firewoodBurned: 0,
    coldest: Number.POSITIVE_INFINITY,
    roughNights: 0,
  };
}

/** `true` once a temperature has been recorded, so `--` can be shown before. */
export function hasColdReading(chronicle: Chronicle): boolean {
  return Number.isFinite(chronicle.coldest);
}
