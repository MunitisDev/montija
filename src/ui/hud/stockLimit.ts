/**
 * The ladder a stock limit steps up and down.
 *
 * **A number field would have been the wrong control.** The game is played on a
 * tablet held in two hands, and asking for "200" means an on-screen keyboard
 * over the settlement, a text cursor, and a value that is briefly `2` and then
 * `20`. Two big buttons and a rung ladder is one thumb, no keyboard, and no
 * intermediate state that means anything.
 *
 * The rungs are coarse on purpose. Nobody plans a settlement around the
 * difference between 210 and 220 stone; what they decide is *roughly two
 * hundred*, and a ladder that offers that in one tap is a better instrument than
 * one that offers four hundred numbers in fifty.
 *
 * Pure, so the awkward part — which rung a first tap lands on — is testable
 * without a browser.
 */

/** Rungs, low to high. `null` sits above the top of this and means no limit. */
export const LIMIT_LADDER: readonly number[] = [
  0, 25, 50, 100, 150, 200, 300, 400, 600, 800, 1200, 1600, 2000,
];

/**
 * The rung a step lands on, or `null` for no limit at all.
 *
 * **The first tap is the one that matters.** Coming down from "no limit", the
 * useful place to land is *just above what the settlement already has* — a
 * player with 180 stone who wants to stop the quarry means "about this much",
 * not 2000 and then eleven more taps. So the first step down lands on the first
 * rung at or above the current stock, and everything after it is an ordinary
 * step along the ladder.
 *
 * @param current the limit now, or `null` when there is none
 * @param direction `-1` to lower, `1` to raise
 * @param stored how much is on the shelves right now
 */
export function nextLimit(
  current: number | null,
  direction: 1 | -1,
  stored: number,
): number | null {
  if (current === null) {
    if (direction > 0) {
      return null;
    }
    return LIMIT_LADDER.find((rung) => rung >= stored) ?? LIMIT_LADDER.at(-1) ?? null;
  }

  if (direction > 0) {
    const above = LIMIT_LADDER.find((rung) => rung > current);
    // Off the top of the ladder is no limit, which is where the ladder came
    // from: the two ends of the control are "none of this" and "as much as you
    // like", and both have to be reachable.
    return above ?? null;
  }

  const below = [...LIMIT_LADDER].reverse().find((rung) => rung < current);
  // The floor is a real setting — *make no more of this at all* — so it stops
  // there rather than wrapping round to no limit.
  return below ?? 0;
}

/** `true` when lowering would do nothing, so the button can say so. */
export function atFloor(current: number | null): boolean {
  return current === 0;
}

/** `true` when raising would do nothing, because there is no limit already. */
export function atCeiling(current: number | null): boolean {
  return current === null;
}
