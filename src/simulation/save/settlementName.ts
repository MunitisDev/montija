/**
 * What a settlement is called, and which file that is.
 *
 * **A save with no name is a save nobody can choose between.** The game kept one
 * autosave in one slot called `autosave`, which is fine for a game with one
 * settlement and wrong for a game about founding them: a player who begins again
 * after a hard winter wants their own valley back, not whichever one was saved
 * last. So a settlement is named when it is founded, and its name *is* its file.
 *
 * Two rules, and both are here rather than in the store because both are about
 * words rather than about disks:
 *
 * - **A name is tidied, not rejected.** Trailing spaces, double spaces and a
 *   novel pasted into the box are all things a player did by accident, and
 *   refusing them with an error is worse than quietly fixing them.
 * - **Two settlements never share a name.** The second Montija is *Montija II*.
 *   Roman numerals rather than "(2)" because this is a game about medieval
 *   settlements and a village register is exactly where roman numerals belong.
 *
 * Pure, so both rules are testable without a browser or a database.
 */

/**
 * Longest a settlement's name may be.
 *
 * Twenty-four characters fits in the menu's list and on the failure screen's
 * title at every width the game supports. Longer names are cut rather than
 * refused.
 */
export const MAX_SETTLEMENT_NAME = 24;

/** What an unnamed settlement is called, until the player says otherwise. */
export const FALLBACK_SETTLEMENT_NAME = 'A settlement';

/**
 * Cleans up whatever was typed into the box.
 *
 * @returns the tidied name, or `''` when there was nothing but whitespace
 */
export function tidyName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SETTLEMENT_NAME).trim();
}

/**
 * The key a settlement's save is stored under.
 *
 * Derived from the name so a settlement's file is findable from its name alone,
 * and folded to lower case so `Montija` and `montija` are the same village
 * rather than two — which is what a player who typed it twice meant.
 *
 * Prefixed, because the store holds other things: the summaries the menu lists
 * are keyed off this, and a bare name would collide with them.
 */
export function slotFor(name: string): string {
  return `settlement:${tidyName(name).toLocaleLowerCase()}`;
}

/**
 * A name nobody else is using, given the ones that are.
 *
 * `Montija`, then `Montija II`, then `Montija III`. Compared by slot rather than
 * by name so the check is the same one the store will make when it writes.
 */
export function uniqueName(wanted: string, taken: readonly string[]): string {
  const tidy = tidyName(wanted);
  const used = new Set(taken.map((name) => slotFor(name)));
  if (!used.has(slotFor(tidy))) {
    return tidy;
  }

  // From the second, because the first is the plain name. The ceiling is a
  // guard rather than a rule: a player with ninety-nine villages of the same
  // name has made their point.
  for (let index = 2; index <= 99; index += 1) {
    const candidate = tidyName(`${tidy} ${roman(index)}`);
    if (!used.has(slotFor(candidate))) {
      return candidate;
    }
  }
  return tidy;
}

/**
 * A number as a roman numeral.
 *
 * Only ever used for the suffix above, so it is written for the range it will
 * see: two to ninety-nine.
 */
export function roman(value: number): string {
  const numerals: readonly (readonly [number, string])[] = [
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let left = Math.max(1, Math.floor(value));
  let out = '';
  for (const [amount, numeral] of numerals) {
    while (left >= amount) {
      out += numeral;
      left -= amount;
    }
  }
  return out;
}
