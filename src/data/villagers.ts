/**
 * Villager data.
 *
 * Names are original and generic-medieval on purpose — nothing lifted from any
 * existing game. They are split into two lists so a settlement can grow without
 * repeating a full name quickly.
 */

/** Cells crossed per second on open ground, at 1x speed. */
export const VILLAGER_WALK_SPEED = 1.6;

/** How close counts as "arrived at this waypoint", in world units. */
export const WAYPOINT_TOLERANCE = 0.02;

export const GIVEN_NAMES: readonly string[] = [
  'Alda',
  'Bertran',
  'Cwen',
  'Doran',
  'Edith',
  'Fenwick',
  'Gerta',
  'Hollis',
  'Isolde',
  'Jarrow',
  'Kestrel',
  'Leofric',
  'Maren',
  'Norrin',
  'Ottilie',
  'Perrin',
  'Quenna',
  'Rowan',
  'Sefton',
  'Thea',
  'Ulric',
  'Verity',
  'Wystan',
  'Yrsa',
];

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
