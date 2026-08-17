/**
 * What a villager looks like, derived from what they are.
 *
 * **A settlement of thirty was thirty of the same hooded figure.** Age and sex
 * exist in the simulation, matter to it — who may work, who may bear children,
 * who has earned the walk about the village — and could not be seen at all. A
 * player looking at their own settlement could not tell a child from the woman
 * who runs the quarry.
 *
 * Two facts, both of them presentation and neither of them a rule the simulation
 * consults:
 *
 * **Which figure**, from age first and sex second. Age first because it reads at
 * a glance where a number does not: a settlement whose streets are full of
 * children and elders looks like one, and that is exactly the thing to notice
 * about a population that has stopped working.
 *
 * **Which colour**, from the id, kept for life. Muted and earthy — dyed wool, not
 * highlighter pens — and the same for the sprite on the map and the portrait in
 * the panel, so a person is recognisable in both.
 *
 * Lives in `shared/` because the Phaser renderer and the HTML panels both need
 * it and neither should import the other. It is pure data about appearance: the
 * simulation neither calls it nor knows it exists.
 */

import { ADULT_AGE, RETIREMENT_AGE } from '@/data/population';
import type { Sex } from '@/simulation/villagers/Villager';

/** Which figure to draw. */
export type VillagerLook = 'child' | 'woman' | 'man' | 'elder';

export const VILLAGER_LOOKS: readonly VillagerLook[] = ['child', 'woman', 'man', 'elder'];

/**
 * The colours people are told apart by, as 24-bit numbers.
 *
 * Numbers rather than CSS strings because the renderer tints with them; the
 * panels format them back to `#rrggbb`. Six is enough that neighbours rarely
 * match and few enough that each stays a colour a medieval settlement could
 * actually dye wool: undyed brown, woad-ish green, madder red, slate, heather,
 * moss.
 */
export const PERSON_COLOURS: readonly number[] = [
  0x8a7a5c, 0x6f7f6a, 0x8c6a5a, 0x6c7484, 0x8a7f96, 0x7f8a6a,
];

/** The least a villager needs to have a look. Anything with an age and a sex. */
export interface Appearance {
  readonly id: number;
  readonly age: number;
  readonly sex: Sex;
}

export function lookFor(person: Appearance): VillagerLook {
  if (person.age < ADULT_AGE) {
    return 'child';
  }
  if (person.age >= RETIREMENT_AGE) {
    return 'elder';
  }
  return person.sex === 'f' ? 'woman' : 'man';
}

/** Their colour, the same one for life. */
export function colourFor(person: Appearance): number {
  return PERSON_COLOURS[colourIndexFor(person)] ?? PERSON_COLOURS[0]!;
}

/** Which of the colours, for whoever needs the index rather than the value. */
export function colourIndexFor(person: Appearance): number {
  return person.id % PERSON_COLOURS.length;
}

/** The same colour as CSS, for the HTML panels. */
export function cssColour(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}
