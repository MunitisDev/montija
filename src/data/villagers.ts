/**
 * Villager data.
 *
 * Names are original and generic-medieval on purpose — nothing lifted from any
 * existing game. Given names and family names are separate lists so a
 * settlement can grow without repeating a full name quickly, and given names
 * are further split by sex so a villager's name matches who they are.
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
  'Alda',
  'Cwen',
  'Edith',
  'Gerta',
  'Isolde',
  'Kestrel',
  'Maren',
  'Ottilie',
  'Quenna',
  'Thea',
  'Verity',
  'Yrsa',
];

export const MASCULINE_NAMES: readonly string[] = [
  'Bertran',
  'Doran',
  'Fenwick',
  'Hollis',
  'Jarrow',
  'Leofric',
  'Norrin',
  'Perrin',
  'Rowan',
  'Sefton',
  'Ulric',
  'Wystan',
];

/** Both lists together, for anywhere that does not care. */
export const GIVEN_NAMES: readonly string[] = [...FEMININE_NAMES, ...MASCULINE_NAMES];

export const FAMILY_NAMES: readonly string[] = [
  'Ashdown',
  'Barrowfield',
  'Coldwater',
  'Dunmoor',
  'Elmsworth',
  'Fallowbrook',
  'Greyfen',
  'Harrowgate',
  'Ironhollow',
  'Longmire',
  'Mossbank',
  'Northwood',
  'Oakenshaw',
  'Pinehurst',
  'Redmarsh',
  'Stonebridge',
  'Thornbury',
  'Wexford',
];
