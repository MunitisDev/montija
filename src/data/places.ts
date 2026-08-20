/**
 * Names to suggest for a settlement, so the box is never empty.
 *
 * **A blank field is a decision a player has not been given any help with**, and
 * the first thing this game asks of them should not be a naming problem. The box
 * opens with one of these already in it: tap Found and get on with the valley,
 * or clear it and name the place yourself.
 *
 * Invented, every one of them. They are built to *sound* like the sort of thing a
 * hill village in an unforgiving valley might be called — a landscape word and
 * an ending — rather than borrowed from any real place or any other game. The
 * point is atmosphere, not geography.
 */
export const PLACE_NAMES: readonly string[] = [
  'Ardaña',
  'Bruneval',
  'Caldera Vieja',
  'Cerro Mudo',
  'Dosaguas',
  'Esparraga',
  'Fuenteseca',
  'Gorbea',
  'Hoznayo',
  'Irunza',
  'Lastrilla',
  'Maderuela',
  'Nogaleda',
  'Ombría',
  'Peñalba',
  'Quintanar',
  'Robledal',
  'Somoza',
  'Tejadillo',
  'Ubierna',
  'Valdehelecho',
  'Xarama',
  'Yesares',
  'Zurradero',
];

/**
 * The name to offer for a given world.
 *
 * Taken from the seed rather than rolled, so the suggestion is a property of the
 * valley the player is looking at: reload the same world and it offers the same
 * name, which reads as the place already having one rather than as a slot
 * machine.
 */
export function suggestedPlaceName(seed: number): string {
  const index = Math.abs(Math.floor(seed)) % PLACE_NAMES.length;
  return PLACE_NAMES[index] ?? 'Ardaña';
}
