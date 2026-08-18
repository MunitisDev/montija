/**
 * Villager data.
 *
 * **The names are Castilian, and specifically of these hills.** The game is
 * called Montija, which is a valley in Las Merindades, north of Burgos — old
 * Castile, and the same landscape the settlement is built in: high pasture,
 * beech and oak, hard winters. Generic-medieval names put the settlement
 * nowhere; these put it somewhere, and everything else about the game already
 * agrees with them.
 *
 * Given names are the ones Castile actually used in the centuries this game is
 * set in — Sancho, Jimena, Nuño, Urraca — rather than modern Spanish ones, which
 * would read as a village of tourists. Family names are half **patronymics**
 * (Fernández, Gutiérrez, Sáinz: "son of Fernán, of Gutierre, of Sancho") and half
 * **toponymics from the Merindades themselves** (de Espinosa, de Sotoscueva, de
 * Valdivielso), because that is how people were told apart before surnames
 * settled down: by their father or by where they came down from.
 *
 * Real historical names, not invented ones and not lifted from any game — which
 * is what the brief asks for, and the opposite of copying: nobody owns the
 * baptismal register of Espinosa de los Monteros.
 *
 * Given names and family names stay separate lists so a settlement can grow
 * without repeating a full name quickly, and given names are split by sex so a
 * villager's name matches who they are.
 */

/** Cells crossed per second on open ground, at 1x speed. */
export const VILLAGER_WALK_SPEED = 1.6;

/** How close counts as "arrived at this waypoint", in world units. */
export const WAYPOINT_TOLERANCE = 0.02;

/**
 * Given names, split by sex.
 *
 * The single list they came from was already recognisably one or the other
 * name by name, so splitting it invented nothing — it only lets the game know
 * what it was already implying. Sex exists so that a household can read the
 * way the player expects: a couple, and children who carry a family name.
 *
 * Kept the same length on each side so a founding settlement is not lopsided
 * by the name table before the seed has had any say.
 */
export const FEMININE_NAMES: readonly string[] = [
  'Aldonza',
  'Catalina',
  'Constanza',
  'Elvira',
  'Inés',
  'Jimena',
  'Leonor',
  'Mayor',
  'Mencía',
  'Oria',
  'Sancha',
  'Urraca',
];

export const MASCULINE_NAMES: readonly string[] = [
  'Álvaro',
  'Diego',
  'Domingo',
  'Fernán',
  'Gonzalo',
  'Íñigo',
  'Lope',
  'Martín',
  'Nuño',
  'Rodrigo',
  'Sancho',
  'Tello',
];

/** Both lists together, for anywhere that does not care. */
export const GIVEN_NAMES: readonly string[] = [...FEMININE_NAMES, ...MASCULINE_NAMES];

/**
 * Family names: patronymics, and the places people came down from.
 *
 * The `de X` ones are all real valleys, villages and merindades within a day's
 * walk of Montija — Espinosa de los Monteros, Sotoscueva, Valdivielso, Losa,
 * Mena, Frías, Bercedo — and the rest are the surnames those valleys are full of.
 * Velasco and Salazar were the two great houses of the Merindades, which is a
 * quiet joke worth having in a village of ten people.
 *
 * A surname may contain a space; the settlement's naming convention is "given
 * name, then everything else", so `de Valdivielso` is inherited whole. See
 * `PopulationSystem.familyNameOf`.
 */
export const FAMILY_NAMES: readonly string[] = [
  'Alonso',
  'Angulo',
  'de Bercedo',
  'de Espinosa',
  'de Frías',
  'de Losa',
  'de Mena',
  'de Sotoscueva',
  'de Valdivielso',
  'Díez',
  'Fernández',
  'Gutiérrez',
  'Ortiz',
  'Peña',
  'Ruiz',
  'Sáinz',
  'Salazar',
  'Velasco',
];
