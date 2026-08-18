/**
 * Building placeholder art, built from each building's own footprint.
 *
 * Every building used to share one 128×128 texture drawn around a hard-coded
 * base line, whatever its footprint. Three things went wrong as a result, and
 * all three were visible in play:
 *
 * - a 3×3 Storage Yard was drawn exactly as large as a 2×2 House, so neither
 *   sat on the plot it actually occupied;
 * - the front corner of the base fell 22px below the texture's bottom edge, so
 *   buildings were **clipped along their front**;
 * - because the drawn base did not match the footprint, terrain in front of a
 *   building sorted over parts of it, which reads as the ground **overlapping**
 *   the walls.
 *
 * So the geometry is derived rather than hand-placed. A `w × h` footprint maps
 * to a rhombus `(w + h)·TILE_WIDTH/2` across and `(w + h)·TILE_HEIGHT/2` tall;
 * the building is that rhombus extruded upward, and the texture is sized to
 * hold it with the anchor exactly on the footprint's centre.
 *
 * ```text
 *            ▲ apex            texture top
 *           ╱ ╲
 *          ╱   ╲               roofHeight
 *         ╱_____╲
 *         │     │              wallHeight
 *      ╲  │     │  ╱
 *        ╲│_____│╱             ◀── ground line: the anchor, at the
 *         ╲     ╱                  footprint's centre
 *           ╲ ╱                 half the base rhombus, below the anchor
 *            ▼                 texture bottom
 * ```
 */

import type Phaser from 'phaser';

import { BUILDINGS, type BuildingId } from '@/data/buildings';
import { TILE_HEIGHT, TILE_WIDTH } from '@/shared/math/isometric';
import { HOUSE_LOOKS, drawHouse } from './houseArt';
import {
  SHADOW_SPREAD,
  SUN_OFFSET,
  bevel,
  contactShadow,
  occlude,
  polygon,
  shade,
  type Point,
} from './shading';

export interface BuildingPalette {
  readonly wall: number;
  readonly roof: number;
  readonly trim: number;
}

/** How each building is massed. Footprint comes from the building data. */
/** The four corners of a footprint rhombus, at some height. */
interface Rhombus {
  readonly back: Point;
  readonly right: Point;
  readonly front: Point;
  readonly left: Point;
}

interface BuildingMass {
  /** Height of the walls, in pixels. */
  readonly wallHeight: number;
  /** Height of the roof above the walls. `0` leaves the building open. */
  readonly roofHeight: number;
  /** How far the roof oversails the walls, in pixels. */
  readonly eaves: number;
  /** Set for buildings that are a yard rather than a hall: no roof, low walls. */
  readonly open?: boolean;
  /** A stone footing under the walls, in pixels. Damp-proofing, and weight. */
  readonly plinth?: number;
  /** Set when the building has a hearth, and so a chimney and smoke. */
  readonly chimney?: boolean;
  /** How many window openings the front wall carries. */
  readonly windows?: number;
  /** Set for a thatched roof rather than shingled: softer, straw-coloured. */
  readonly thatch?: boolean;
  /** Set for worked land rather than a structure: furrows, or fruit trees. */
  readonly field?: 'crop' | 'orchard' | 'graves';
  /**
   * A working prop standing on the plot beside the building.
   *
   * Mass and colour get a building most of the way to being recognisable, and
   * then stop: a Woodcutter and a Tailor are both a brown box with a pitched
   * roof. The prop is the bit that says which trade this is without a label —
   * a stack of split logs, a forge mouth, a drying rack — and it is drawn on
   * the ground in front rather than on the walls so it survives being small.
   */
  readonly prop?: 'logpile' | 'forge' | 'racks' | 'cart' | 'spoil';
  /**
   * Set for the open storage yard: a plank deck on posts, with goods on it.
   *
   * Its own drawing routine rather than a flag on the generic path, because it
   * is the one structure in the settlement that is a *platform* rather than a
   * box — and the generic path can only make boxes.
   */
  readonly yard?: boolean;
  /**
   * How much of its own plot the built part covers, as a fraction, `1` for all.
   *
   * **The rule this exists to keep: nothing a building draws may leave its
   * footprint.** A yard wants a worn path around it and a house wants a bit of
   * garden and a fence, and the tempting way to get either is to draw past the
   * plot edge. That was tried on the yard and it is wrong — the footprint is what
   * blocks navigation, validates placement and gets saved, so art that oversails
   * it promises the player ground they cannot build on and cannot walk through.
   *
   * So the building shrinks instead and the ground around it is drawn *inside*
   * the plot. A 3x3 yard is a deck with a path round it; a 2x2 house is a cottage
   * with a garden. Both are contained, and both read as larger than the bare box
   * did, because there is somewhere for them to sit.
   */
  readonly inset?: number;
  /**
   * Ground drawn on the rest of the plot, where the building is inset.
   *
   * `worn` is the bare earth of a yard people cross all day; `garden` is the
   * kept ground round a house — a bit of green, and a path beaten from the gate
   * to the door.
   */
  readonly ground?: 'worn' | 'garden';
  /** A low fence round the plot's edge, with the near corner left open. */
  readonly fence?: boolean;
  /** A lean-to over the door, on two posts. */
  readonly porch?: boolean;
}

/**
 * Roof heights are large on purpose.
 *
 * A pyramid roof only reads as pitched once its apex clears the *back* corner
 * of its own rhombus — for a 2x2 building that corner is already 32px above the
 * centre, so a 30px roof produced a flat lozenge with a suspicion of a ridge.
 * Steep pitches are also what the period asks for.
 */
const MASS: Readonly<Record<BuildingId, BuildingMass>> = {
  // A bridge, while it is being built: a course of timbers just clear of the
  // water and nothing above them. Once it is finished the road art draws it, so
  // this is only ever seen as a half-built crossing.
  bridge: { wallHeight: 4, roofHeight: 0, eaves: 0, open: true },
  // The only building people live in, and the only one with a hearth — so it is
  // the only one with smoke coming out of it, which is most of what makes a
  // settlement look inhabited rather than built.
  // **A cottage on its plot, not a box filling it.** Two thirds the width it used
  // to be drawn at, which leaves ground for a garden, a fence with a gap at the
  // gate and a lean-to over the door — and reads as *larger*, because a building
  // with somewhere to stand looks like a building rather than a block.
  house: {
    wallHeight: 24,
    roofHeight: 44,
    eaves: 5,
    plinth: 5,
    chimney: true,
    windows: 2,
    // **Fewer things round it, more definition on it.** The first pass had a
    // fence and a lean-to and a garden, and the report was that the house itself
    // looked vague — so the accessories are gone and the effort went into how the
    // walls are built. See `houseArt.ts`.
    inset: 0.66,
    ground: 'garden',
  },
  // **A deck, not a box.** It was a low flat slab with three rectangles on it —
  // the least built-looking thing in the settlement, and the first thing every
  // player sees, since the founding camp borrows this art. It is now a plank
  // floor standing clear of the ground on posts, framed with a rail, with a
  // trodden path worn round it and goods stacked on the boards.
  //
  // `wallHeight` here is not a wall: nothing about a yard is a wall. It is the
  // headroom the tallest thing on the deck needs, which is what the texture is
  // sized from. See `drawStorageYard`.
  'storage-yard': {
    wallHeight: 30,
    roofHeight: 0,
    eaves: 0,
    inset: 0.7,
    open: true,
    yard: true,
  },
  // A granary: shut tight, because its whole purpose is keeping weather out.
  // No windows for the same reason, and a stone footing to keep damp off grain.
  'food-storage': { wallHeight: 20, roofHeight: 40, eaves: 7, plinth: 6 },
  // A forager's shelter: thatched, cheap, one opening.
  'gatherer-hut': { wallHeight: 20, roofHeight: 42, eaves: 6, thatch: true, windows: 1 },
  // Herbs are dried over a slow fire, which is also why the hut smells.
  // A workshop. Taller than it needs to be, because the work happens indoors.
  woodcutter: { wallHeight: 22, roofHeight: 44, eaves: 6, plinth: 4, windows: 1, prop: 'logpile' },
  // A lodge out among the trees: low, thatched, one window, no stone to spare.
  forester: { wallHeight: 18, roofHeight: 38, eaves: 7, thatch: true, windows: 1, prop: 'logpile' },
  // A quarry is a hole with a shed over it. Low walls and a deep stone footing,
  // because most of what the player should read is *cut rock*.
  quarry: { wallHeight: 14, roofHeight: 22, eaves: 5, plinth: 10, prop: 'spoil' },
  // A mine is a mouth in the hillside: a short stone head and a shallow roof.
  mine: { wallHeight: 16, roofHeight: 26, eaves: 5, plinth: 8, prop: 'spoil' },
  // A forge: stone-footed against the fire, and the second building in the game
  // with a chimney — because the second building in the game with a hearth.
  blacksmith: {
    wallHeight: 20,
    roofHeight: 34,
    eaves: 6,
    plinth: 6,
    chimney: true,
    windows: 1,
    prop: 'forge',
  },
  // Not buildings at all: broken ground inside a low fence. Drawn flat so the
  // settlement's skyline stays buildings, and a field reads as worked land.
  // A big open-fronted shed on a stone footing: goods come and go, so it reads
  // as a place things pass through rather than a place people live.
  'trading-post': { wallHeight: 16, roofHeight: 30, eaves: 9, plinth: 5, prop: 'cart' },
  // A small thatched hut with drying racks: the cheapest building in the game.
  herbalist: {
    wallHeight: 15,
    roofHeight: 30,
    eaves: 7,
    thatch: true,
    chimney: true,
    windows: 1,
    prop: 'racks',
  },
  // Stone-footed and shuttered: the one building meant to keep weather out for
  // the sake of the people inside rather than the goods.
  // A hearth of its own: somebody nursing the sick keeps a fire in.
  healer: { wallHeight: 21, roofHeight: 36, eaves: 6, plinth: 7, chimney: true, windows: 2 },
  // A cabin out at the treeline: thatched, low, no stone.
  hunter: { wallHeight: 17, roofHeight: 34, eaves: 7, thatch: true, windows: 1, prop: 'racks' },
  // A workshop with good light: two windows, which nothing else has.
  tailor: { wallHeight: 20, roofHeight: 36, eaves: 6, plinth: 4, windows: 2 },
  'crop-field': { wallHeight: 4, roofHeight: 0, eaves: 0, field: 'crop' },
  orchard: { wallHeight: 4, roofHeight: 0, eaves: 0, field: 'orchard' },
  // The tallest and squarest thing the settlement ever raises: a deep stone
  // plinth, high walls and more windows than anything else has, because a room
  // people read in needs light. It should be legible as the monument it is
  // from across the map, and it is the only building whose silhouette says
  // "this settlement has time to spare".
  // Low walls round a piece of ground, and markers standing in it. Drawn as a
  // field so the settlement's skyline stays buildings — a cemetery is worked
  // ground, not a structure.
  cemetery: { wallHeight: 5, roofHeight: 0, eaves: 0, field: 'graves' },
  // Taller than a house and narrower than the school, under a steep roof. The
  // one building whose silhouette should read as reaching upwards.
  temple: {
    wallHeight: 26,
    roofHeight: 54,
    eaves: 6,
    plinth: 8,
    windows: 2,
  },
  school: {
    wallHeight: 30,
    roofHeight: 50,
    eaves: 7,
    plinth: 9,
    chimney: true,
    windows: 3,
  },
};

/** Muted, earthy, and distinguishable at a glance without being colourful. */
export const BUILDING_COLOURS: Readonly<Record<BuildingId, BuildingPalette>> = {
  // Wet timber, darker than anything on dry land.
  bridge: { wall: 0x6b5a41, roof: 0x4a3d2c, trim: 0x332a1e },
  // Limewashed daub on a dark oak frame, under a russet tiled roof. The single
  // biggest change the art ever had: every building used to be brown walls
  // under a slightly darker brown roof, and at a settlement's worth of zoom
  // that is one silhouette with no parts. Value separation, not detail, is
  // what makes a roof read as a roof.
  house: { wall: 0xa79c85, roof: 0x7b4a33, trim: 0x3b3228 },
  // Open yards keep their timber: no roof to contrast against, and they should
  // read as structures rather than as dwellings.
  'storage-yard': { wall: 0x8a7350, roof: 0x574733, trim: 0x4a3826 },
  // A granary. Daub like a house, but its roof is ochre thatch-board rather
  // than tile — cheaper building, cheaper roof.
  'food-storage': { wall: 0x9c9179, roof: 0x6d5a3a, trim: 0x3f382a },
  // Thatched, so the roof colour is barely used; the walls carry the identity.
  'gatherer-hut': { wall: 0x8d8a6c, roof: 0x4c5039, trim: 0x3b4030 },
  // A workshop: timber walls, dark shingles. Still a clear gap between them.
  woodcutter: { wall: 0x86714f, roof: 0x4a3b2a, trim: 0x362c20 },
  forester: { wall: 0x7f8058, roof: 0x44452f, trim: 0x33341f },
  // Cut rock, pale and cold, under slate.
  quarry: { wall: 0x8e8a7e, roof: 0x4a473e, trim: 0x37352f },
  mine: { wall: 0x807a70, roof: 0x413e37, trim: 0x2f2c28 },
  // The forge: soot has been at these walls, and its roof is the darkest in
  // the settlement.
  blacksmith: { wall: 0x8a7867, roof: 0x3a322b, trim: 0x2b2620 },
  'trading-post': { wall: 0x9c8664, roof: 0x6a4b33, trim: 0x3f3427 },
  // Thatch over herb-stained boards.
  herbalist: { wall: 0x7f8a63, roof: 0x7a6942, trim: 0x39422d },
  // Plastered and kept clean, which is the point of the building.
  healer: { wall: 0xa9a493, roof: 0x5a564a, trim: 0x36332d },
  hunter: { wall: 0x8a7454, roof: 0x7a6942, trim: 0x3c3327 },
  // A workshop with good light, and the palest walls of the working buildings.
  tailor: { wall: 0xa08c84, roof: 0x584740, trim: 0x342c29 },
  // Worked ground rather than buildings — the wall colour is the soil.
  'crop-field': { wall: 0x6d6234, roof: 0x5b5230, trim: 0x4a4128 },
  orchard: { wall: 0x4f5c37, roof: 0x44502f, trim: 0x3a4428 },
  // Dressed stone, paler and greyer than anything around it, under slate. The
  // settlement's one monument should be legible from across the map.
  // Turned earth and grey markers, kept deliberately quiet.
  cemetery: { wall: 0x5d6350, roof: 0x8d8a80, trim: 0x45483c },
  // Limewashed like a house, under the darkest slate in the settlement: the
  // one roof that should read as heavy.
  temple: { wall: 0xada598, roof: 0x4c4740, trim: 0x37332c },
  school: { wall: 0xb6b1a1, roof: 0x60594a, trim: 0x413c33 },
};

/** Breathing room above the roof, so nothing touches the texture edge. */
const TOP_MARGIN = 4;

/** Rubble footing and chimney stone. Cold and grey against the warm timber. */
const STONE_FOOTING = 0x6a675e;

/**
 * The storage yard, in pixels. See {@link drawStorageYard}.
 *
 * `stand` minus `slab` is the gap you can see under the boards, and it is the
 * number that decides whether the deck reads as raised at all: at four pixels it
 * looked like a thick rug, at nine it looks like a platform.
 */
const YARD = {
  /** Height of the deck surface above the ground. */
  stand: 13,
  /** How thick the deck reads from the side. */
  slab: 4,
  /** Boards across the deck. Odd, so the middle of the yard is a board. */
  planks: 11,
  /** Height of the rail posts above the deck. */
  post: 15,
} as const;

/** Ground worn bare around a yard people walk to all day. */
const YARD_APRON = 0x776449;

/**
 * The ground round a cottage: beaten earth, with grass surviving in patches.
 *
 * Earth rather than lawn, and not only because it is what a cottage yard was.
 * Green ground against green terrain reads as nothing at all — the first pass was
 * a tended green and the plot simply disappeared into the meadow around it. The
 * grass is the tufts; the ground is what people have walked on.
 */
const GARDEN_GROUND = 0x6a5c45;
/** The line beaten from the gate to the door, barer still. */
const GARDEN_PATH = 0x82724f;
/** Grass surviving in the corners, at fixed places: nothing here may be rolled. */
const GARDEN_TUFTS: readonly (readonly [number, number])[] = [
  [0.24, 0.72],
  [0.7, 0.34],
  [0.82, 0.78],
  [0.4, 0.2],
];

/** A fence's posts along one edge, and how tall they stand. */
const FENCE_POSTS: readonly number[] = [0.06, 0.34, 0.62, 0.9];
const FENCE_HEIGHT = 7;

/** What is left of the grass, between the path and the fence. */
const GARDEN_TUFT = 0x5d6b40;

/**
 * The shadowed space under the boards.
 *
 * Not black. A void that dark swallowed the posts standing in it, and the posts
 * are the whole point of the gap being there.
 */
const UNDER_DECK = 0x241d15;

/** Sawn timber, weathered unevenly. Three tones read as boards; two as stripes. */
const PLANK_TONES: readonly number[] = [1, 0.9, 0.96, 0.84, 1.04, 0.92];

/** Where the posts under the deck stand, along the two near edges. */
const YARD_POSTS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.5, 1],
  [1, 1],
  [1, 0.5],
  [1, 0],
];

/** The rail stands on the two far corners and the back, framing the goods. */
const YARD_RAIL_POSTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
  [1, 0],
];

/** Turns round the apron where a rut or a stone shows. Fixed, never rolled. */
const APRON_SCUFFS: readonly number[] = [0.06, 0.19, 0.33, 0.47, 0.61, 0.78, 0.91];
const APRON_STONES: readonly number[] = [0.12, 0.29, 0.55, 0.7, 0.86];

/** What is stacked on the boards, and where. */
interface YardGood {
  readonly u: number;
  readonly v: number;
  /** Size across, as a fraction of the deck's half-width. */
  readonly size: number;
  readonly kind: 'crate' | 'barrel' | 'sacks' | 'logs';
  /** A second, smaller crate on top of this one. */
  readonly stacked?: boolean;
}

/**
 * A fixed arrangement, and deliberately an uneven one.
 *
 * Goods laid out on a grid read as a warehouse inventory screen. A yard is
 * stacked by people carrying things in and putting them down where there is
 * room, so the pile that looks right is the one that looks slightly untidy.
 */
const YARD_GOODS: readonly YardGood[] = [
  { u: 0.24, v: 0.24, size: 0.28, kind: 'crate', stacked: true },
  { u: 0.56, v: 0.18, size: 0.23, kind: 'barrel' },
  { u: 0.24, v: 0.58, size: 0.28, kind: 'logs' },
  { u: 0.8, v: 0.28, size: 0.24, kind: 'crate' },
  { u: 0.56, v: 0.48, size: 0.24, kind: 'sacks' },
  { u: 0.82, v: 0.66, size: 0.25, kind: 'barrel' },
  { u: 0.44, v: 0.8, size: 0.21, kind: 'crate' },
];

/** Sawn deal, still pale. Crates are the newest timber in the settlement. */
const CRATE = 0x8a6b45;
/** Oak, darkened by whatever has been kept in it, under iron hoops. */
const BARREL = 0x6b5334;
const BARREL_HOOP = 0x4e4a44;
/** Coarse linen, the one pale thing on the deck. */
const SACK = 0x9c8f6f;
/** Bark, and the pale round of a fresh cut. */
const LOG_BARK = 0x5a4a34;
const LOG_END = 0xa08a63;

/** A window opening. Dark, because glass was for churches. */
const WINDOW_DARK = 0x2a2620;

/** Straw, for the buildings too cheap to be shingled. */
const THATCH = 0x7d6a42;

/**
 * How far the walls are pulled in from the footprint edge.
 *
 * A building drawn to the exact edge of its plot touches its neighbour's, which
 * reads as two buildings fused together. A couple of pixels of garden fixes it.
 */
const FOOTPRINT_INSET = 3;

/**
 * How large a contact shadow may be asked for, as a share of the plot it is on.
 *
 * **A shadow handed the whole footprint does not stay on it.** `contactShadow`
 * spreads its faintest ring to {@link SHADOW_SPREAD} of what it is given and then
 * slides the whole thing down-right by {@link SUN_OFFSET}, so the full footprint
 * comes out at about one and a half times the plot: over the neighbouring tile,
 * and — on a one-cell building, whose texture is only as wide as its own
 * diamond — straight off the edge of the texture, where it is sliced off square.
 *
 * The building's ground art is the thing a player reads as "this plot is taken",
 * so it is the thing that must be exact. Sizing the shadow to land inside the
 * plot costs nothing: the light comes from the upper left, so the shadow still
 * reaches the plot's down-right edge and falls short of the up-left one, which is
 * where a shadow belongs.
 */
const SHADOW_FIT = 1 / (SHADOW_SPREAD + SUN_OFFSET);

export interface BuildingTextureSpec {
  readonly width: number;
  readonly height: number;
  /** Origin Y, in `0..1`, putting the anchor on the footprint's centre. */
  readonly groundLine: number;
}

/** The rhombus a footprint occupies on screen. */
function baseSize(footprint: { width: number; height: number }) {
  const span = footprint.width + footprint.height;
  return { width: (span * TILE_WIDTH) / 2, height: (span * TILE_HEIGHT) / 2 };
}

/**
 * Texture dimensions and anchor for a building.
 *
 * Exported because the renderer needs the same ground line the texture was
 * drawn with — the two must agree, and deriving both from here is what keeps
 * them agreeing.
 */
export function buildingTextureSpec(id: BuildingId): BuildingTextureSpec {
  const base = baseSize(BUILDINGS[id].footprint);
  const mass = MASS[id];

  // Room for the roof's overhang on both sides. Nothing else needs width: a
  // building's art is contained by its own plot — see `BuildingMass.inset`.
  const width = Math.ceil(base.width + mass.eaves * 2);
  // Everything above the anchor, plus the half-rhombus that falls in front of
  // it. Forgetting that half is exactly what clipped every building's front.
  const above = base.height / 2 + mass.wallHeight + mass.roofHeight + TOP_MARGIN;
  const below = base.height / 2;

  return {
    width,
    height: Math.ceil(above + below),
    groundLine: above / (above + below),
  };
}

/**
 * How many stocked-ness a yard is drawn in, from bare boards to piled high.
 *
 * Five. Enough that a settlement watching its stores go down through a winter
 * sees them go down, and few enough that the whole set is five textures drawn
 * once at load rather than anything happening per frame.
 */
export const YARD_FILL_LEVELS = 5;

/**
 * How much in a store the art calls "piled high".
 *
 * **Deliberately not the store's own capacity.** The founding yard holds two
 * thousand, which is a number the player never sees and which exists so the camp
 * can never be the thing that stops them — tie the picture to it and the
 * settlement's whole first year is drawn as an empty platform. Three hundred
 * goods is a yard that looks stocked, and the settlers arrive with two hundred
 * and nineteen, so the camp starts nearly full and visibly empties as they eat.
 */
const YARD_LOOKS_FULL = 300;

/** Which yard texture a store's contents call for. */
export function yardFillVariant(total: number): number {
  const share = Math.min(1, Math.max(0, total / YARD_LOOKS_FULL));
  return Math.round(share * (YARD_FILL_LEVELS - 1));
}

/**
 * How many textures a building needs.
 *
 * One for almost everything: a house looks like a house whatever is happening
 * inside it. The yard is the exception, because what a yard *is* is what is
 * stacked on it.
 */
export function artVariants(id: BuildingId): number {
  if (MASS[id].yard === true) {
    return YARD_FILL_LEVELS;
  }
  // A house is drawn in one of three constructions — see `houseArt.ts`. Which
  // one a given house gets is the renderer's business; the loader's job is only
  // to have all three ready.
  return id === 'house' ? HOUSE_LOOKS.length : 1;
}

/**
 * Draws one building into `graphics`, sized to its own footprint.
 *
 * The result stands exactly on its plot: the base rhombus is the footprint, the
 * walls rise from it and the roof caps them. Where a building declares an
 * {@link BuildingMass.inset} the built part is smaller than the plot and the rest
 * of the plot is *its ground* — a garden, a yard, a path — which is how a
 * building gets somewhere to stand without ever leaving its own cells.
 */
export function drawBuilding(
  graphics: Phaser.GameObjects.Graphics,
  id: BuildingId,
  palette: BuildingPalette,
  /** Which variant to draw, `0` to `artVariants(id) - 1`. */
  variant = 0,
): void {
  const spec = buildingTextureSpec(id);
  const base = baseSize(BUILDINGS[id].footprint);
  const mass = MASS[id];

  const cx = spec.width / 2;
  const groundY = spec.height * spec.groundLine;

  // The plot, and the smaller thing standing on it. They are the same for most
  // buildings; where they differ, the difference is the building's own ground.
  const plotW = base.width / 2 - FOOTPRINT_INSET;
  const plotH = base.height / 2 - FOOTPRINT_INSET / 2;
  const inset = mass.inset ?? 1;
  const halfW = plotW * inset;
  const halfH = plotH * inset;

  /** The four corners of a rhombus centred on `cx`, at height `y`. */
  const rhombus = (y: number): Rhombus => ({
    back: { x: cx, y: y - halfH },
    right: { x: cx + halfW, y },
    front: { x: cx, y: y + halfH },
    left: { x: cx - halfW, y },
  });

  const ground = rhombus(groundY);

  // A yard is a platform rather than a box, and none of the wall, plinth and
  // roof machinery below applies to it.
  if (mass.yard) {
    drawStorageYard(graphics, {
      palette,
      cx,
      groundY,
      halfW: plotW,
      halfH: plotH,
      inset,
      stocked: variant / Math.max(1, YARD_FILL_LEVELS - 1),
    });
    return;
  }

  // The building's own ground, and the fence round it. The far half of the fence
  // is drawn now and the near half after the building, or a house would stand in
  // front of the rails that are supposed to be in front of it.
  if (mass.ground) {
    drawPlotGround(graphics, { cx, groundY, halfW: plotW, halfH: plotH, kind: mass.ground });
  }
  if (mass.fence) {
    drawFence(graphics, { palette, cx, groundY, halfW: plotW, halfH: plotH, side: 'far' });
  }

  // A house is its own module. It is the building there are most of and the one
  // people actually look at, so it gets three constructions and a level of
  // detail none of the generic machinery below would give it.
  if (id === 'house') {
    const look = HOUSE_LOOKS[Math.min(variant, HOUSE_LOOKS.length - 1)] ?? HOUSE_LOOKS[0]!;
    contactShadow(graphics, { x: cx, y: groundY }, halfW * SHADOW_FIT, halfH * SHADOW_FIT);
    drawHouse(graphics, look, { cx, groundY, halfW, halfH });
    if (mass.fence) {
      drawFence(graphics, { palette, cx, groundY, halfW: plotW, halfH: plotH, side: 'near' });
    }
    const hearth = chimneyOffset(id, variant);
    if (hearth) {
      drawChimney(graphics, cx + hearth.dx, groundY + hearth.dy);
    }
    return;
  }

  const plinthHeight = mass.plinth ?? 0;
  const sill = rhombus(groundY - plinthHeight);
  const top = rhombus(groundY - mass.wallHeight);

  // Planted rather than floating, and softly: see `contactShadow`.
  contactShadow(graphics, { x: cx, y: groundY }, halfW * SHADOW_FIT, halfH * SHADOW_FIT);

  // A stone footing, where the building has one. Rubble rather than dressed
  // masonry: this is a frontier settlement, not a cathedral.
  if (plinthHeight > 0) {
    graphics.fillStyle(STONE_FOOTING, 1);
    polygon(graphics, [sill.left, sill.front, ground.front, ground.left]);
    graphics.fillStyle(shade(STONE_FOOTING, 0.76), 1);
    polygon(graphics, [sill.front, sill.right, ground.right, ground.front]);
    // A couple of larger stones picked out along the lit face.
    graphics.fillStyle(shade(STONE_FOOTING, 1.16), 1);
    for (const t of [0.3, 0.62]) {
      const x = cx - halfW + halfW * t;
      const y = groundY + halfH * (t - 0.5) * 0.9 - plinthHeight * 0.55;
      graphics.fillRect(x, y, 7, 3);
    }
  }

  if (mass.field) {
    drawField(graphics, { palette, cx, groundY, halfW, halfH, kind: mass.field });
    return;
  }

  // Left wall, catching the light.
  graphics.fillStyle(palette.wall, 1);
  polygon(graphics, [top.left, top.front, sill.front, sill.left]);

  // Right wall, in shadow: the key light comes from the upper left throughout.
  graphics.fillStyle(shade(palette.wall, 0.78), 1);
  polygon(graphics, [top.front, top.right, sill.right, sill.front]);

  // Gloom collecting where the walls meet the ground. The single strongest
  // cue that a building is standing in the scene rather than pasted onto it.
  const wallSpan = mass.wallHeight - plinthHeight;
  const baseGloom = Math.max(2.5, wallSpan * 0.16);
  occlude(
    graphics,
    { x: sill.left.x, y: sill.left.y - baseGloom },
    { x: sill.front.x, y: sill.front.y - baseGloom },
    baseGloom,
    0.17,
  );
  occlude(
    graphics,
    { x: sill.front.x, y: sill.front.y - baseGloom },
    { x: sill.right.x, y: sill.right.y - baseGloom },
    baseGloom,
    0.2,
  );

  if (mass.open) {
    // An open yard: show the floor inside the low walls rather than a roof.
    graphics.fillStyle(shade(palette.trim, 0.9), 1);
    polygon(graphics, [top.back, top.right, top.front, top.left]);
    drawStackedGoods(graphics, cx, groundY - mass.wallHeight, halfW);
    return;
  }

  // Timber framing on both walls. Uprights only — a full cruck frame at this
  // size turns into noise, whereas four posts read instantly as a timber
  // building and cost four polygons.
  drawFraming(graphics, {
    palette,
    cx,
    halfW,
    halfH,
    sillY: groundY - plinthHeight,
    topY: groundY - mass.wallHeight,
  });

  drawRoof(graphics, {
    palette,
    top,
    cx,
    apexY: groundY - mass.wallHeight - mass.roofHeight,
    eaves: mass.eaves,
    thatch: mass.thatch === true,
  });

  // The roof casts onto the wall it sits on. Without this the two read as
  // stickers on the same plane, however carefully the roof itself is shaded.
  //
  // Started at the roof's lower edge rather than at the wall top: the eaves
  // oversail, so the wall the shadow actually falls on begins half an eave
  // below where the wall geometry says it does. Kept light — the first pass
  // of this stacked with the fascia below and turned the wall into a band of
  // gloom with a stripe of stone showing.
  const eaveDrop = mass.eaves / 2;
  const eaveGloom = Math.max(2, wallSpan * 0.1);
  occlude(
    graphics,
    { x: top.left.x, y: top.left.y + eaveDrop },
    { x: top.front.x, y: top.front.y + eaveDrop },
    eaveGloom,
    0.17,
  );
  occlude(
    graphics,
    { x: top.front.x, y: top.front.y + eaveDrop },
    { x: top.right.x, y: top.right.y + eaveDrop },
    eaveGloom,
    0.2,
  );

  // The arris where the two walls meet, catching the key light. One bright
  // line is the difference between a folded sheet and a corner.
  graphics.fillStyle(shade(palette.wall, 1.24), 0.9);
  polygon(graphics, [
    { x: top.front.x - 1, y: top.front.y },
    { x: top.front.x + 1, y: top.front.y },
    { x: sill.front.x + 1, y: sill.front.y },
    { x: sill.front.x - 1, y: sill.front.y },
  ]);

  // A door on the left wall, which faces the camera.
  //
  // Framed and set back rather than painted on. A dark quad on a pale wall
  // reads as a hole cut in card; a lighter frame with the opening recessed
  // inside it reads as a doorway, and it is the same four polygons.
  const doorHeight = Math.min(wallSpan - 3, 16);
  if (doorHeight > 6) {
    const doorY = groundY - plinthHeight;
    const jamb = (t: number, lift: number) => ({
      x: cx - halfW * t,
      y: doorY + halfH * t - lift,
    });

    // The frame is the dark oak the rest of the building is framed in; the
    // leaf inside it is lighter boarding. The first pass had these the other
    // way round and the result was a black hole punched in a pale wall.
    graphics.fillStyle(palette.trim, 1);
    polygon(graphics, [
      jamb(0.46, doorHeight + 2),
      jamb(0.12, doorHeight + 2),
      jamb(0.12, 0),
      jamb(0.46, 0),
    ]);

    graphics.fillStyle(shade(palette.trim, 1.95), 1);
    polygon(graphics, [
      jamb(0.42, doorHeight),
      jamb(0.16, doorHeight),
      jamb(0.16, 0),
      jamb(0.42, 0),
    ]);

    // The head of the opening, in shadow, which is what says "set back".
    graphics.fillStyle(0x000000, 0.32);
    polygon(graphics, [
      jamb(0.42, doorHeight),
      jamb(0.16, doorHeight),
      jamb(0.16, doorHeight - 2),
      jamb(0.42, doorHeight - 2),
    ]);
  }

  // Windows on the right wall, small and dark: glass was for churches.
  //
  // Framed rather than punched: a flat dark quad on a flat wall is a hole in
  // a sticker, and the frame plus the shadow it drops inside is what makes it
  // an opening in something with thickness.
  for (let index = 0; index < (mass.windows ?? 0); index += 1) {
    const t = 0.28 + index * 0.34;
    const y = groundY - plinthHeight + halfH * t - wallSpan * 0.62;
    const x = cx + halfW * t;

    graphics.fillStyle(shade(palette.trim, 1.25), 1);
    polygon(graphics, [
      { x: x - 6.5, y: y - 3.5 },
      { x: x + 2, y: y + 0.75 },
      { x: x + 2, y: y + 9.5 },
      { x: x - 6.5, y: y + 6.25 },
    ]);

    graphics.fillStyle(WINDOW_DARK, 1);
    polygon(graphics, [
      { x: x - 5, y: y - 2 },
      { x: x + 1, y: y + 1 },
      { x: x + 1, y: y + 8 },
      { x: x - 5, y: y + 5 },
    ]);

    // The reveal: the wall's own thickness, in shadow along the head of the
    // opening. Sells the recess more cheaply than any amount of frame does.
    graphics.fillStyle(0x000000, 0.35);
    polygon(graphics, [
      { x: x - 5, y: y - 2 },
      { x: x + 1, y: y + 1 },
      { x: x + 1, y: y + 2.6 },
      { x: x - 5, y: y - 0.4 },
    ]);
  }

  if (mass.prop) {
    // On the ground at the front-right of the plot, where nothing else is
    // drawn and where it stays legible when the building is small on screen.
    drawProp(graphics, mass.prop, {
      x: cx + halfW * 0.5,
      y: groundY + halfH * 0.42,
      scale: Math.max(0.75, Math.min(1.4, halfW / 32)),
    });
  }

  // A lean-to over the door, on two posts. Drawn after the wall it leans on and
  // after the door it shelters, and before the near fence, which is nearer still.
  if (mass.porch) {
    drawPorch(graphics, {
      palette,
      cx,
      groundY: groundY - plinthHeight,
      halfW,
      halfH,
      height: Math.min(wallSpan - 2, 18),
    });
  }

  if (mass.fence) {
    drawFence(graphics, { palette, cx, groundY, halfW: plotW, halfH: plotH, side: 'near' });
  }

  const stack = chimneyOffset(id);
  if (stack) {
    drawChimney(graphics, cx + stack.dx, groundY + stack.dy);
  }
}

/**
 * The ground a building keeps around itself, inside its own plot.
 *
 * Two facets meeting on a diagonal, like every other piece of ground in this
 * game — a flat patch beside faceted terrain reads as a sticker laid on it.
 *
 * A garden also gets a path beaten from the plot's near corner to the door,
 * because that is the corner people arrive at and the door is where they are
 * going, and a worn line between the two says a house is lived in more cheaply
 * than any amount of detail on the walls does.
 */
function drawPlotGround(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    cx: number;
    groundY: number;
    halfW: number;
    halfH: number;
    kind: 'worn' | 'garden';
  },
): void {
  const { cx, groundY, halfW, halfH, kind } = options;
  const colour = kind === 'garden' ? GARDEN_GROUND : YARD_APRON;
  drawWornGround(graphics, { cx, groundY, halfW, halfH, colour });

  if (kind !== 'garden') {
    return;
  }

  // The path: from the near corner up the left side, where the door is.
  graphics.fillStyle(GARDEN_PATH, 1);
  polygon(graphics, [
    { x: cx, y: groundY + halfH },
    { x: cx - halfW * 0.5, y: groundY + halfH * 0.5 },
    { x: cx - halfW * 0.44, y: groundY + halfH * 0.26 },
    { x: cx + halfW * 0.1, y: groundY + halfH * 0.86 },
  ]);

  // A few tufts, at fixed places, so the green is not a flat wash.
  graphics.fillStyle(GARDEN_TUFT, 1);
  for (const [u, v] of GARDEN_TUFTS) {
    graphics.fillRect(cx + (u - v) * halfW - 2, groundY + (u + v - 1) * halfH - 1.5, 4, 2.5);
  }
}

/**
 * A low fence round a plot, with the near corner left open for a gate.
 *
 * Drawn in two halves. The far rails belong behind the building and the near
 * ones in front of it, and a fence drawn all at once is a fence a house stands
 * on top of.
 */
function drawFence(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    palette: BuildingPalette;
    cx: number;
    groundY: number;
    halfW: number;
    halfH: number;
    side: 'far' | 'near';
  },
): void {
  const { palette, cx, groundY, halfW, halfH, side } = options;
  const timber = shade(palette.trim, side === 'far' ? 0.86 : 1.06);

  /** A point on the plot's rim: `t` runs 0..1 along an edge. */
  const rim = (edge: 'backLeft' | 'backRight' | 'frontLeft' | 'frontRight', t: number): Point => {
    switch (edge) {
      case 'backLeft':
        return { x: cx - halfW * t, y: groundY - halfH * (1 - t) };
      case 'backRight':
        return { x: cx + halfW * t, y: groundY - halfH * (1 - t) };
      case 'frontLeft':
        return { x: cx - halfW * (1 - t), y: groundY + halfH * t };
      default:
        return { x: cx + halfW * (1 - t), y: groundY + halfH * t };
    }
  };

  const edges =
    side === 'far' ? (['backLeft', 'backRight'] as const) : (['frontLeft', 'frontRight'] as const);

  for (const edge of edges) {
    // The gate: the near corner is `t = 1` on both near edges, so the last post
    // of each is left off and the settlement has a way in.
    const stops = side === 'far' ? FENCE_POSTS : FENCE_POSTS.filter((t) => t < 0.8);

    // A rail first, so the posts stand in front of it.
    const from = rim(edge, stops[0] ?? 0);
    const to = rim(edge, stops.at(-1) ?? 1);
    graphics.fillStyle(shade(timber, 0.82), 1);
    polygon(graphics, [
      { x: from.x, y: from.y - FENCE_HEIGHT * 0.66 },
      { x: to.x, y: to.y - FENCE_HEIGHT * 0.66 },
      { x: to.x, y: to.y - FENCE_HEIGHT * 0.66 + 1.8 },
      { x: from.x, y: from.y - FENCE_HEIGHT * 0.66 + 1.8 },
    ]);

    for (const t of stops) {
      const post = rim(edge, t);
      graphics.fillStyle(timber, 1);
      graphics.fillRect(post.x - 1.4, post.y - FENCE_HEIGHT, 2.8, FENCE_HEIGHT);
      graphics.fillStyle(shade(timber, 1.28), 1);
      graphics.fillRect(post.x - 1.4, post.y - FENCE_HEIGHT, 1, FENCE_HEIGHT);
    }
  }
}

/**
 * A lean-to over the door: two posts, a sloping roof, and the shade it throws.
 *
 * The cheapest possible porch, and the right one — these are houses raised in a
 * hurry out of eight logs and four stone, and a joined and turned porch would be
 * a lie about what the settlement can afford. Two posts and some boards is what
 * people actually build.
 */
function drawPorch(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    palette: BuildingPalette;
    cx: number;
    groundY: number;
    halfW: number;
    halfH: number;
    height: number;
  },
): void {
  const { palette, cx, groundY, halfW, halfH, height } = options;

  /** A point on or beyond the left wall: `v` past 1 steps out into the plot. */
  const at = (u: number, v: number, y: number): Point => ({
    x: cx + (u - v) * halfW,
    y: y + (u + v - 1) * halfH,
  });

  const reach = 1.34;
  const headY = groundY - height;
  const wallY = groundY - height - 7;

  // The posts, standing on the ground out in front of the wall.
  for (const u of [0.1, 0.52]) {
    const foot = at(u, reach, groundY);
    const head = at(u, reach, headY);
    graphics.fillStyle(shade(palette.trim, 1.05), 1);
    graphics.fillRect(head.x - 1.6, head.y, 3.2, foot.y - head.y);
    graphics.fillStyle(shade(palette.trim, 1.35), 1);
    graphics.fillRect(head.x - 1.6, head.y, 1.1, foot.y - head.y);
  }

  // The roof, sloping down away from the wall, and its sawn edge.
  graphics.fillStyle(shade(palette.roof, 1.06), 1);
  polygon(graphics, [
    at(0.02, 1, wallY),
    at(0.6, 1, wallY),
    at(0.6, reach, headY),
    at(0.02, reach, headY),
  ]);
  graphics.fillStyle(shade(palette.roof, 0.7), 1);
  polygon(graphics, [
    at(0.02, reach, headY),
    at(0.6, reach, headY),
    at(0.6, reach, headY + 2.4),
    at(0.02, reach, headY + 2.4),
  ]);
  bevel(graphics, at(0.02, 1, wallY), at(0.6, 1, wallY), shade(palette.roof, 1.3), 1.2);

  // And the shade it throws on the wall behind it, which is what stops the whole
  // thing reading as a plank glued to a flat surface.
  occlude(graphics, at(0.02, 1, wallY), at(0.6, 1, wallY), 4, 0.2);
}

/**
 * The one detail that says what trade a building is.
 *
 * Deliberately tiny and deliberately on the ground. Mass and colour get a
 * building most of the way there and then stop — a Woodcutter and a Tailor are
 * both a brown box with a pitched roof — and detail carved into the walls is
 * the first thing to disappear when the player zooms out to look at the
 * settlement. A silhouette on the plot survives that.
 */
function drawProp(
  graphics: Phaser.GameObjects.Graphics,
  prop: NonNullable<BuildingMass['prop']>,
  at: { x: number; y: number; scale: number },
): void {
  const { x, y, scale: k } = at;

  switch (prop) {
    case 'logpile': {
      // Split logs seen end-on: three below, two above. Pale rounds against
      // dark bark is what makes a woodpile read at any size.
      const r = 2.6 * k;
      graphics.fillStyle(0x4a3a28, 1);
      graphics.fillRect(x - r * 3.4, y - r * 2, r * 6.8, r * 2);
      for (let row = 0; row < 2; row += 1) {
        const count = 3 - row;
        for (let i = 0; i < count; i += 1) {
          const cx2 = x - r * (count - 1) + i * r * 2;
          graphics.fillStyle(0x8a7250, 1);
          graphics.fillCircle(cx2, y - r - row * r * 1.7, r);
          graphics.fillStyle(0xa08a63, 1);
          graphics.fillCircle(cx2, y - r - row * r * 1.7, r * 0.5);
        }
      }
      break;
    }

    case 'forge': {
      // A stone hearth with fire in it. The only warm colour in the settlement
      // palette, and the reason a forge is findable at a glance.
      const w = 7 * k;
      graphics.fillStyle(0x4b4741, 1);
      graphics.fillRect(x - w, y - w * 0.9, w * 2, w * 0.9);
      graphics.fillStyle(0xc4622a, 0.95);
      graphics.fillRect(x - w * 0.55, y - w * 0.7, w * 1.1, w * 0.5);
      // A brighter core, so the fire has depth rather than being a flat patch.
      graphics.fillStyle(0xe8a13c, 1);
      graphics.fillRect(x - w * 0.28, y - w * 0.58, w * 0.56, w * 0.26);
      break;
    }

    case 'racks': {
      // Two uprights and a crossbar with bundles hung off it: herbs drying,
      // or a hunter's game. Same silhouette, and both are correct.
      const h = 8 * k;
      const w = 6 * k;
      graphics.fillStyle(0x5b4a33, 1);
      graphics.fillRect(x - w, y - h, 1.4 * k, h);
      graphics.fillRect(x + w, y - h, 1.4 * k, h);
      graphics.fillRect(x - w, y - h, w * 2 + 1.4 * k, 1.4 * k);
      graphics.fillStyle(0x6d7a4a, 1);
      for (let i = 0; i < 3; i += 1) {
        const bx = x - w * 0.6 + i * w * 0.6;
        graphics.fillRect(bx, y - h + 1.4 * k, 1.8 * k, h * 0.45);
      }
      break;
    }

    case 'cart': {
      // A two-wheeled cart: goods come and go from a trading post, and a cart
      // is the only object in the settlement that means "leaving".
      const w = 7 * k;
      graphics.fillStyle(0x6d5c40, 1);
      graphics.fillRect(x - w, y - w * 0.95, w * 2, w * 0.7);
      graphics.fillStyle(0x3f3527, 1);
      graphics.fillCircle(x - w * 0.6, y - w * 0.2, w * 0.42);
      graphics.fillCircle(x + w * 0.6, y - w * 0.2, w * 0.42);
      graphics.fillStyle(0x8a7250, 1);
      graphics.fillRect(x - w * 0.2, y - w * 1.5, w * 0.9, w * 0.6);
      break;
    }

    case 'spoil': {
      // A heap of cut rock. What a quarry and a mine actually leave behind,
      // and the thing that tells them apart from a shed.
      const r = 3.2 * k;
      for (const [dx, dy, size, tone] of [
        [-1.5, 0, 1.1, 0x7a766c],
        [0.2, -0.35, 1.35, 0x8b877c],
        [1.6, 0.1, 0.95, 0x6b6760],
      ] as const) {
        graphics.fillStyle(tone, 1);
        polygon(graphics, [
          { x: x + dx * r, y: y + dy * r - r * size },
          { x: x + dx * r + r * size, y: y + dy * r },
          { x: x + dx * r, y: y + dy * r + r * size * 0.5 },
          { x: x + dx * r - r * size, y: y + dy * r },
        ]);
      }
      break;
    }
  }
}

/** How far up the roof pitch the stack sits, from apex to eaves. */
const CHIMNEY_ALONG = 0.34;

/**
 * And how far across it, toward the front corner.
 *
 * Nought would put the stack on the hip, which is what made it look like it was
 * hanging in the air beside the roof rather than standing on it.
 */
const CHIMNEY_ACROSS = 0.2;

/** Height of the stack itself, including its cap. */
const CHIMNEY_HEIGHT = 18.5;

/**
 * Where a building's chimney is, relative to its anchor.
 *
 * Exported because the smoke has to come out of the actual stack rather than
 * out of the middle of the roof. The offsets are in texture pixels from the
 * footprint's centre, which is exactly what a sprite's position is, so the
 * renderer can add them without knowing anything about how a building is drawn.
 *
 * `null` for the buildings with no hearth, which is most of them.
 */
export function chimneyOffset(
  id: BuildingId,
  /** Which variant, for buildings drawn more than one way. */
  variant = 0,
): { dx: number; dy: number } | null {
  const mass = MASS[id];
  if (mass.chimney !== true) {
    return null;
  }

  // A house carries its own wall and roof heights per construction, so the roof
  // plane the stack has to sit on is not the one the generic mass describes.
  if (id === 'house') {
    const look = HOUSE_LOOKS[Math.min(variant, HOUSE_LOOKS.length - 1)] ?? HOUSE_LOOKS[0]!;
    const houseHalfW =
      (baseSize(BUILDINGS[id].footprint).width / 2 - FOOTPRINT_INSET) * (mass.inset ?? 1);
    const wallTop = -(look.plinth + look.wallHeight);
    const apex = wallTop - look.roofHeight;
    return onNearPitch({
      apex,
      eaveX: -houseHalfW - look.eaves,
      eaveY: wallTop + look.eaves / 2,
      frontY: wallTop + look.eaves / 2,
      frontX: 0,
    });
  }

  const base = baseSize(BUILDINGS[id].footprint);
  // **The building's half-width, not the plot's.** A house drawn inset is smaller
  // than the ground it stands on, and measuring the roof from the plot put the
  // stack out where the eaves would have been if the house filled its cells —
  // hanging in the air beside the roof, which is exactly how it was reported.
  const halfW = (base.width / 2 - FOOTPRINT_INSET) * (mass.inset ?? 1);

  // Placed *on* the roof plane, by interpolating along the left pitch from the
  // apex to the eaves. Guessing a height instead put the stack below the roof
  // surface, where it read as a post leaning against the gable.
  const apexY = -mass.wallHeight - mass.roofHeight;
  const eaveX = -halfW - mass.eaves;
  const eaveY = -mass.wallHeight + mass.eaves / 2;

  return onNearPitch({ apex: apexY, eaveX, eaveY, frontX: 0, frontY: eaveY });
}

/**
 * A point standing *in* the near-left pitch, rather than on the hip above it.
 *
 * **Reported as "the chimney is flying", and it was.** Interpolating from the
 * apex straight down the left hip puts the stack on the silhouette edge, where
 * half of it overlaps the near pitch and half of it sticks out into the sky over
 * the far one — which reads as a stack hanging beside the roof rather than
 * coming out of it.
 *
 * A weighted point between the apex and the two near corners lands it on the
 * surface, with roof on every side of it.
 */
function onNearPitch(roof: {
  apex: number;
  eaveX: number;
  eaveY: number;
  frontX: number;
  frontY: number;
}): { dx: number; dy: number } {
  const toEave = CHIMNEY_ALONG;
  const toFront = CHIMNEY_ACROSS;
  return {
    dx: roof.eaveX * toEave + roof.frontX * toFront,
    dy: roof.apex * (1 - toEave - toFront) + roof.eaveY * toEave + roof.frontY * toFront,
  };
}

/** The lip of the stack, where smoke actually leaves the building. */
export function chimneyMouth(id: BuildingId): { dx: number; dy: number } | null {
  const stack = chimneyOffset(id);
  return stack ? { dx: stack.dx, dy: stack.dy - CHIMNEY_HEIGHT } : null;
}

/** Four uprights, so a wall reads as a timber frame rather than as a slab. */
function drawFraming(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    palette: BuildingPalette;
    cx: number;
    halfW: number;
    halfH: number;
    sillY: number;
    topY: number;
  },
): void {
  const { palette, cx, halfW, halfH, sillY, topY } = options;
  const timber = shade(palette.trim, 1.18);
  const shaded = shade(palette.trim, 0.86);

  // Left wall: posts run from the sill to the wall head, following the slope.
  graphics.fillStyle(timber, 1);
  for (const t of [0.3, 0.66]) {
    const x = cx - halfW * t;
    const drop = halfH * t;
    polygon(graphics, [
      { x: x - 1.5, y: topY + drop },
      { x: x + 1.5, y: topY + drop },
      { x: x + 1.5, y: sillY + drop },
      { x: x - 1.5, y: sillY + drop },
    ]);
  }

  graphics.fillStyle(shaded, 1);
  for (const t of [0.3, 0.66]) {
    const x = cx + halfW * t;
    const drop = halfH * t;
    polygon(graphics, [
      { x: x - 1.5, y: topY + drop },
      { x: x + 1.5, y: topY + drop },
      { x: x + 1.5, y: sillY + drop },
      { x: x - 1.5, y: sillY + drop },
    ]);
  }

  // A wall plate along the top, tying the posts together.
  graphics.fillStyle(timber, 1);
  polygon(graphics, [
    { x: cx - halfW, y: topY },
    { x: cx, y: topY + halfH },
    { x: cx, y: topY + halfH + 2.5 },
    { x: cx - halfW, y: topY + 2.5 },
  ]);
  graphics.fillStyle(shaded, 1);
  polygon(graphics, [
    { x: cx + halfW, y: topY },
    { x: cx, y: topY + halfH },
    { x: cx, y: topY + halfH + 2.5 },
    { x: cx + halfW, y: topY + 2.5 },
  ]);
}

/** A stone chimney breaking the roofline. Only houses have hearths. */
function drawChimney(graphics: Phaser.GameObjects.Graphics, x: number, y: number): void {
  const width = 7;
  const height = 16;

  graphics.fillStyle(STONE_FOOTING, 1);
  graphics.fillRect(x - width / 2, y - height, width / 2, height);
  graphics.fillStyle(shade(STONE_FOOTING, 0.74), 1);
  graphics.fillRect(x, y - height, width / 2, height);
  // The cap, brightest: it is the one face pointing at the sky.
  graphics.fillStyle(shade(STONE_FOOTING, 1.3), 1);
  graphics.fillRect(x - width / 2 - 1, y - height - 2.5, width + 2, 2.5);
}

/**
 * Worked land: furrows inside a low fence, or a stand of fruit trees.
 *
 * Drawn flat on purpose. A field is not a building, and giving it walls and a
 * roof would put a second row of structures across the settlement's skyline —
 * the one thing the art bible is most insistent about is that buildings
 * dominate and everything else stays subordinate to them.
 */
function drawField(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    palette: BuildingPalette;
    cx: number;
    groundY: number;
    halfW: number;
    halfH: number;
    kind: 'crop' | 'orchard' | 'graves';
  },
): void {
  const { palette, cx, groundY, halfW, halfH, kind } = options;

  // Broken earth, in two facets like the ground it replaced.
  graphics.fillStyle(shade(palette.trim, 1.04), 1);
  polygon(graphics, [
    { x: cx, y: groundY - halfH },
    { x: cx + halfW, y: groundY },
    { x: cx, y: groundY + halfH },
  ]);
  graphics.fillStyle(palette.trim, 1);
  polygon(graphics, [
    { x: cx, y: groundY - halfH },
    { x: cx - halfW, y: groundY },
    { x: cx, y: groundY + halfH },
  ]);

  if (kind === 'graves') {
    // Markers in rows, leaning slightly, each with its own small shadow. Stone
    // rather than timber: a settlement that can spare masonry for its dead is
    // saying something, and it is the reason the building costs stone at all.
    let index = 0;
    for (const [ox, oy] of [
      [-0.5, -0.3],
      [0, -0.52],
      [0.5, -0.3],
      [-0.52, 0.22],
      [0, 0],
      [0.52, 0.22],
      [0, 0.5],
    ] as const) {
      const x = cx + halfW * ox * 0.66;
      const y = groundY + halfH * oy * 0.66;
      // Alternating lean, from the index rather than a random draw: this is
      // drawn once into a texture, and the simulation's streams must never be
      // touched from the renderer.
      const lean = index % 3 === 0 ? -1 : index % 3 === 1 ? 0 : 1;
      index += 1;

      graphics.fillStyle(0x000000, 0.2);
      graphics.fillEllipse(x + 1.5, y + 1, 8, 3);
      graphics.fillStyle(shade(palette.roof, 0.82), 1);
      polygon(graphics, [
        { x: x - 2.4 + lean * 0.8, y: y - 9 },
        { x: x + 2.4 + lean * 0.8, y: y - 9 },
        { x: x + 2.4, y },
        { x: x - 2.4, y },
      ]);
      // A lit top edge, so a marker is a slab rather than a smear.
      graphics.fillStyle(shade(palette.roof, 1.16), 1);
      graphics.fillRect(x - 2.4 + lean * 0.8, y - 9.5, 4.8, 1.4);
    }
  } else if (kind === 'crop') {
    // Furrows running along one axis, in the crop's own colour. Seven of them:
    // enough to read as ploughed, few enough not to shimmer when the camera
    // moves.
    for (let index = 1; index <= 7; index += 1) {
      const t = -1 + (index * 2) / 8;
      const spanX = halfW * t;
      const spanY = halfH * (1 - Math.abs(t));
      graphics.fillStyle(shade(palette.wall, index % 2 === 0 ? 1.1 : 0.94), 1);
      polygon(graphics, [
        { x: cx + spanX, y: groundY - spanY },
        { x: cx + spanX, y: groundY + spanY },
        { x: cx + spanX + 3, y: groundY + spanY - 1.5 },
        { x: cx + spanX + 3, y: groundY - spanY - 1.5 },
      ]);
    }
  } else {
    // Fruit trees in rows: small rounded crowns on short trunks, so an orchard
    // reads as trees the settlement planted rather than as wild wood.
    for (const [ox, oy] of [
      [-0.5, -0.25],
      [0, -0.5],
      [0.5, -0.25],
      [-0.5, 0.25],
      [0, 0],
      [0.5, 0.25],
      [0, 0.5],
    ] as const) {
      const x = cx + halfW * ox * 0.72;
      const y = groundY + halfH * oy * 0.72;
      graphics.fillStyle(0x000000, 0.18);
      graphics.fillEllipse(x, y + 1, 11, 4);
      graphics.fillStyle(0x4a3d2c, 1);
      graphics.fillRect(x - 1.2, y - 9, 2.4, 9);
      graphics.fillStyle(shade(palette.wall, 1.18), 1);
      graphics.fillEllipse(x - 1.5, y - 14, 13, 11);
      graphics.fillStyle(shade(palette.wall, 0.82), 1);
      graphics.fillEllipse(x + 3, y - 12, 8, 8);
    }
  }

  // A low fence on the two back edges only. Across the front it would hide the
  // crop, which is the one thing the player needs to see.
  graphics.lineStyle(2, shade(palette.roof, 1.1), 0.9);
  graphics.beginPath();
  graphics.moveTo(cx - halfW, groundY - 4);
  graphics.lineTo(cx, groundY - halfH - 4);
  graphics.lineTo(cx + halfW, groundY - 4);
  graphics.strokePath();
  graphics.fillStyle(shade(palette.roof, 0.9), 1);
  for (const t of [-0.66, -0.33, 0, 0.33, 0.66]) {
    const x = cx + halfW * t;
    const y = groundY - halfH * (1 - Math.abs(t));
    graphics.fillRect(x - 1, y - 7, 2, 7);
  }
}

/** A hipped roof: one silhouette, then the shaded half. */
function drawRoof(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    palette: BuildingPalette;
    top: Rhombus;
    cx: number;
    apexY: number;
    eaves: number;
    thatch: boolean;
  },
): void {
  const { palette, top, cx, apexY, eaves, thatch } = options;
  const roof = thatch ? THATCH : palette.roof;

  // The eaves oversail the walls on every side.
  const eL = { x: top.left.x - eaves, y: top.left.y + eaves / 2 };
  const eR = { x: top.right.x + eaves, y: top.right.y + eaves / 2 };
  const eF = { x: top.front.x, y: top.front.y + eaves / 2 };
  const eB = { x: top.back.x, y: top.back.y - eaves / 2 };
  const apex = { x: cx, y: apexY };

  // The far pitches first, so their silhouette shows above the ridge without
  // being drawn over the near ones.
  graphics.fillStyle(shade(roof, 0.88), 1);
  polygon(graphics, [apex, eB, eL]);
  polygon(graphics, [apex, eB, eR]);

  // Near-left pitch, catching the light.
  graphics.fillStyle(roof, 1);
  polygon(graphics, [apex, eL, eF]);

  // Near-right pitch, away from it.
  graphics.fillStyle(shade(roof, 0.74), 1);
  polygon(graphics, [apex, eR, eF]);

  // Courses across the near pitches: shingle lines, or the bound bundles of a
  // thatch. Three of them, faint — enough to say what the roof is made of
  // without turning the largest surface on the building into a pattern.
  const courses = thatch ? 3 : 4;
  for (let index = 1; index <= courses; index += 1) {
    const t = index / (courses + 1);
    graphics.fillStyle(shade(roof, thatch ? 0.82 : 1.14), thatch ? 0.7 : 0.55);
    polygon(graphics, [
      { x: apex.x + (eL.x - apex.x) * t, y: apex.y + (eL.y - apex.y) * t },
      { x: apex.x + (eF.x - apex.x) * t, y: apex.y + (eF.y - apex.y) * t },
      { x: apex.x + (eF.x - apex.x) * t, y: apex.y + (eF.y - apex.y) * t + 1.5 },
      { x: apex.x + (eL.x - apex.x) * t, y: apex.y + (eL.y - apex.y) * t + 1.5 },
    ]);
    polygon(graphics, [
      { x: apex.x + (eR.x - apex.x) * t, y: apex.y + (eR.y - apex.y) * t },
      { x: apex.x + (eF.x - apex.x) * t, y: apex.y + (eF.y - apex.y) * t },
      { x: apex.x + (eF.x - apex.x) * t, y: apex.y + (eF.y - apex.y) * t + 1.5 },
      { x: apex.x + (eR.x - apex.x) * t, y: apex.y + (eR.y - apex.y) * t + 1.5 },
    ]);
  }

  // A ridge line, so the two pitches read as separate planes rather than a
  // flat lozenge.
  graphics.fillStyle(shade(roof, 1.12), 1);
  polygon(graphics, [
    { x: apex.x - 1, y: apex.y },
    { x: apex.x + 1, y: apex.y },
    { x: eF.x + 1, y: eF.y },
    { x: eF.x - 1, y: eF.y },
  ]);

  // The fascia: the roof slab seen edge-on where it oversails the wall.
  //
  // Until this existed the roof was a fan of triangles with no thickness, and
  // the eaves ended in a line of zero width — which is the one thing no real
  // roof does. Two or three pixels of dark board along the near edges is
  // enough for the eye to read a slab with a shadow under it.
  const fascia = Math.max(1.5, eaves * 0.26);
  graphics.fillStyle(shade(roof, 0.6), 1);
  polygon(graphics, [eL, eF, { x: eF.x, y: eF.y + fascia }, { x: eL.x, y: eL.y + fascia }]);
  polygon(graphics, [eF, eR, { x: eR.x, y: eR.y + fascia }, { x: eF.x, y: eF.y + fascia }]);

  // And the arris along the top of that board, which is what catches the sun
  // when a roof is looked at from below.
  bevel(graphics, eL, eF, shade(roof, 1.3), 1.2);
}

/** Crates and sacks, so a storage yard reads as holding something. */
/**
 * The storage yard: a plank deck on posts, with the settlement's goods on it.
 *
 * **The most-looked-at object in the game, and it was a brown slab.** The
 * founding camp borrows this art, so it is the first structure every player ever
 * sees — and what they saw was a flat lozenge with three axis-aligned rectangles
 * lying on it, which read as a rug with boxes drawn on rather than as a place
 * anybody had built.
 *
 * What it is now, from the ground up:
 *
 * ```text
 *        ▄▟█▙▄   ▟▙        goods, drawn as isometric solids
 *      ┌─────────────┐     rail, framing the far two sides
 *      ╱═══════════╱       plank deck, board by board
 *      ╲___________╱       the sawn ends of those boards
 *       │ │  │  │ │        posts, standing the deck clear of the damp
 *     ░░░░░░░░░░░░░░░      the path worn round a yard people use
 * ```
 *
 * Four things do the work, and each is worth its polygons:
 *
 * **It stands off the ground.** Timber laid on soil rots, so a real yard is
 * decked on posts — and the strip of shadow under the boards is what makes it a
 * built thing standing in the world rather than a shape lying on it.
 *
 * **It is made of boards.** The deck is filled dark and then each plank is drawn
 * inside that fill, so the line between two boards is a real gap rather than a
 * drawn stripe. Their sawn ends show along the near right edge, which is the
 * detail that says *sawn* rather than *moulded*.
 *
 * **The path is part of the building.** Ground worn bare, reaching a little past
 * the plot, with ruts across it. See {@link BuildingMass.apron}.
 *
 * **The goods are solids, not stickers.** Crates, barrels, sacks and cut timber,
 * every one of them a flat-shaded isometric prism lit from the upper left like
 * everything else in the settlement, each with its own small shadow on the
 * boards, drawn back to front so they overlap the way objects do.
 *
 * Nothing here is per-frame work: the whole thing is drawn once into a texture at
 * load and then used as a sprite, exactly as the flat version was.
 */
function drawStorageYard(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    palette: BuildingPalette;
    cx: number;
    groundY: number;
    /** Half-extents of the whole plot, which nothing drawn here may leave. */
    halfW: number;
    halfH: number;
    /** Share of the plot the deck itself takes; the rest is the path round it. */
    inset: number;
    /** How full it is, `0` for bare boards and `1` for piled high. */
    stocked: number;
  },
): void {
  const { palette, cx, groundY, inset, stocked } = options;
  const plotW = options.halfW;
  const plotH = options.halfH;
  const halfW = plotW * inset;
  const halfH = plotH * inset;

  const deckY = groundY - YARD.stand;
  /** Underside of the deck slab: where the posts start. */
  const slabY = deckY + YARD.slab;

  /**
   * A point on the deck plane, in footprint coordinates.
   *
   * `u` runs from the back corner to the right corner, `v` from the back corner
   * to the left. So `u = 1` traces the near-right edge and `v = 1` the near-left
   * one, which is what lets a plank be a band of constant `v`.
   */
  const at = (u: number, v: number, y: number): Point => ({
    x: cx + (u - v) * halfW,
    y: y + (u + v - 1) * halfH,
  });

  // --- the path worn round it, inside the plot -------------------------------
  //
  // Out to the plot's own edge and not a pixel further. Two facets, meeting on a
  // diagonal, because that is how every other piece of ground in this game is
  // drawn and a flat patch beside faceted terrain reads as a sticker.
  drawWornGround(graphics, { cx, groundY, halfW: plotW, halfH: plotH, colour: YARD_APRON });
  // Ruts and scuffs in the ring between the deck and the plot edge, at fixed
  // angles: this texture is drawn once and has to come out the same on every
  // run, so nothing here may be rolled.
  const ringW = (plotW + halfW) / 2;
  const ringH = (plotH + halfH) / 2;
  graphics.fillStyle(shade(YARD_APRON, 0.82), 1);
  for (const turn of APRON_SCUFFS) {
    const angle = Math.PI * 2 * turn;
    graphics.fillRect(
      cx + Math.cos(angle) * ringW - 3.5,
      groundY + Math.sin(angle) * ringH - 1,
      7,
      2,
    );
  }
  graphics.fillStyle(shade(YARD_APRON, 1.14), 1);
  for (const turn of APRON_STONES) {
    const angle = Math.PI * 2 * turn;
    graphics.fillRect(
      cx + Math.cos(angle) * ringW - 1.5,
      groundY + Math.sin(angle) * ringH - 1,
      3,
      2,
    );
  }

  // Sized from the deck rather than the plot: a raised deck's shadow belongs
  // under the deck, not spread across the path around it.
  contactShadow(graphics, { x: cx, y: groundY }, halfW * SHADOW_FIT, halfH * SHADOW_FIT);

  // --- the dark under the boards, and the posts holding them up -------------
  //
  // Only the two near faces of that space are ever visible, which is the whole
  // reason a deck reads as raised: a gap you can see under.
  graphics.fillStyle(UNDER_DECK, 1);
  polygon(graphics, [at(0, 1, slabY), at(1, 1, slabY), at(1, 1, groundY), at(0, 1, groundY)]);
  graphics.fillStyle(shade(UNDER_DECK, 0.72), 1);
  polygon(graphics, [at(1, 1, slabY), at(1, 0, slabY), at(1, 0, groundY), at(1, 1, groundY)]);

  for (const [u, v] of YARD_POSTS) {
    const head = at(u, v, slabY);
    const foot = at(u, v, groundY);
    graphics.fillStyle(palette.trim, 1);
    graphics.fillRect(head.x - 2.5, head.y, 5, foot.y - head.y + 1.5);
    // A lit edge down the left of each post. Two polygons per post, and it is
    // the difference between a post and a dark slot.
    graphics.fillStyle(shade(palette.trim, 1.3), 1);
    graphics.fillRect(head.x - 2.5, head.y, 1.6, foot.y - head.y + 1.5);
  }

  // --- the sawn ends of the boards, along the two near edges ----------------
  //
  // The planks run along `u`, so the near-right edge shows end grain and the
  // near-left edge shows the long side of the last board. Different things, and
  // drawn as different things.
  graphics.fillStyle(shade(palette.wall, 0.84), 1);
  polygon(graphics, [at(0, 1, deckY), at(1, 1, deckY), at(1, 1, slabY), at(0, 1, slabY)]);
  graphics.fillStyle(shade(palette.wall, 0.6), 1);
  polygon(graphics, [at(1, 1, deckY), at(1, 0, deckY), at(1, 0, slabY), at(1, 1, slabY)]);
  graphics.fillStyle(shade(palette.wall, 0.44), 1);
  for (let i = 1; i < YARD.planks; i += 1) {
    const p = at(1, i / YARD.planks, deckY);
    graphics.fillRect(p.x - 0.5, p.y, 1, YARD.slab);
  }

  // --- the deck itself, board by board --------------------------------------
  //
  // Filled dark first, then each plank drawn inside that fill: the gap between
  // two boards is then a gap, not a line painted on a solid surface.
  graphics.fillStyle(shade(palette.wall, 0.46), 1);
  polygon(graphics, [at(0, 0, deckY), at(1, 0, deckY), at(1, 1, deckY), at(0, 1, deckY)]);

  const gap = 0.008;
  for (let i = 0; i < YARD.planks; i += 1) {
    // Three tones in a repeating run rather than two: two alternating shades
    // read as a stripe pattern, and three read as timber.
    const tone = PLANK_TONES[i % PLANK_TONES.length] ?? 1;
    graphics.fillStyle(shade(palette.wall, tone), 1);
    polygon(graphics, [
      at(0, i / YARD.planks + gap, deckY),
      at(1, i / YARD.planks + gap, deckY),
      at(1, (i + 1) / YARD.planks - gap, deckY),
      at(0, (i + 1) / YARD.planks - gap, deckY),
    ]);
  }

  // Gloom in the far corners, where light does not reach into the frame, and a
  // lit arris along the near-left edge where the deck breaks.
  occlude(graphics, at(0, 0, deckY), at(1, 0, deckY), 3.5, 0.16);
  occlude(graphics, at(0, 0, deckY), at(0, 1, deckY), 3.5, 0.1);
  bevel(graphics, at(0, 1, deckY), at(1, 1, deckY), shade(palette.wall, 1.28), 1.2);

  // --- the way up onto it ---------------------------------------------------
  //
  // Two boards from the path to the deck's near corner. It costs six polygons and
  // it answers a question the eye asks the moment the deck leaves the ground:
  // how does anybody get a barrel up there?
  const rampFoot = at(1, 1, groundY + 1);
  const rampHead = at(1, 1, deckY);
  const rampHalf = halfW * 0.13;
  graphics.fillStyle(shade(palette.wall, 0.88), 1);
  polygon(graphics, [
    { x: rampHead.x - rampHalf, y: rampHead.y },
    { x: rampHead.x + rampHalf, y: rampHead.y },
    { x: rampFoot.x + rampHalf * 1.5, y: rampFoot.y + YARD.stand * 0.5 },
    { x: rampFoot.x - rampHalf * 1.5, y: rampFoot.y + YARD.stand * 0.5 },
  ]);
  graphics.fillStyle(shade(palette.wall, 0.66), 1);
  polygon(graphics, [
    { x: rampHead.x, y: rampHead.y },
    { x: rampHead.x + rampHalf, y: rampHead.y },
    { x: rampFoot.x + rampHalf * 1.5, y: rampFoot.y + YARD.stand * 0.5 },
    { x: rampFoot.x, y: rampFoot.y + YARD.stand * 0.5 },
  ]);
  bevel(
    graphics,
    { x: rampHead.x - rampHalf, y: rampHead.y },
    { x: rampHead.x + rampHalf, y: rampHead.y },
    shade(palette.wall, 1.2),
    1,
  );

  // --- the rail, on the two far sides only ----------------------------------
  //
  // Far sides only, so it frames the goods instead of standing in front of them.
  const railTop = deckY - YARD.post;
  for (const [u, v] of YARD_RAIL_POSTS) {
    const head = at(u, v, railTop);
    graphics.fillStyle(shade(palette.trim, 0.9), 1);
    graphics.fillRect(head.x - 2, head.y, 4, YARD.post);
    graphics.fillStyle(shade(palette.trim, 1.25), 1);
    graphics.fillRect(head.x - 2, head.y, 1.4, YARD.post);
  }
  for (const height of [0, YARD.post * 0.52]) {
    const y = railTop + height;
    graphics.fillStyle(shade(palette.trim, height === 0 ? 1.08 : 0.86), 1);
    polygon(graphics, [at(0, 0, y), at(0, 1, y), at(0, 1, y + 2.4), at(0, 0, y + 2.4)]);
    polygon(graphics, [at(0, 0, y), at(1, 0, y), at(1, 0, y + 2.4), at(0, 0, y + 2.4)]);
  }

  // --- what is stored on it -------------------------------------------------
  //
  // **How much is on the deck is a picture of how much is in the store.** The
  // goods are declared in the order a yard actually fills — the back corner
  // first, because that is where somebody carrying a crate in puts it down — and
  // a level takes the first few of them.
  //
  // Then sorted back to front for drawing, so nearer goods overlap further ones.
  // `u + v` is depth: the deck plane maps it straight onto screen height.
  const carried = Math.round(YARD_GOODS.length * Math.min(1, Math.max(0, stocked)));
  const stock = YARD_GOODS.slice(0, carried).sort((a, b) => a.u + a.v - (b.u + b.v));
  for (const good of stock) {
    const base = at(good.u, good.v, deckY);
    const width = good.size * halfW;
    // Its own shadow on the boards, or it floats.
    graphics.fillStyle(0x000000, 0.16);
    polygon(graphics, [
      { x: base.x + width * 0.12, y: base.y - width * 0.28 },
      { x: base.x + width * 0.68, y: base.y + width * 0.04 },
      { x: base.x + width * 0.12, y: base.y + width * 0.36 },
      { x: base.x - width * 0.44, y: base.y + width * 0.04 },
    ]);

    switch (good.kind) {
      case 'crate':
        isoCrate(graphics, base, width, width * 0.62, CRATE);
        if (good.stacked) {
          isoCrate(
            graphics,
            { x: base.x - width * 0.08, y: base.y - width * 0.62 },
            width * 0.72,
            width * 0.5,
            shade(CRATE, 0.92),
          );
        }
        break;
      case 'barrel':
        isoBarrel(graphics, base, width, width * 0.78);
        break;
      case 'sacks':
        isoSack(graphics, base, width * 0.8, width * 0.6);
        isoSack(
          graphics,
          { x: base.x + width * 0.42, y: base.y + width * 0.1 },
          width * 0.66,
          width * 0.5,
        );
        break;
      case 'logs':
        isoLogStack(graphics, base, width);
        break;
    }
  }
}

/**
 * A patch of ground inside a plot: bare earth, trodden, in two facets.
 *
 * Two facets meeting on a diagonal rather than one flat fill, which is the rule
 * every other piece of ground in this game obeys — a single-colour patch beside
 * faceted terrain reads as a sticker laid on the scene.
 */
function drawWornGround(
  graphics: Phaser.GameObjects.Graphics,
  options: { cx: number; groundY: number; halfW: number; halfH: number; colour: number },
): void {
  const { cx, groundY, halfW, halfH, colour } = options;
  const back = { x: cx, y: groundY - halfH };
  const front = { x: cx, y: groundY + halfH };

  graphics.fillStyle(colour, 1);
  polygon(graphics, [back, { x: cx - halfW, y: groundY }, front]);
  graphics.fillStyle(shade(colour, 0.93), 1);
  polygon(graphics, [back, { x: cx + halfW, y: groundY }, front]);
}

/** A flat-shaded isometric box: three faces, boarded, lit from the upper left. */
function isoCrate(
  graphics: Phaser.GameObjects.Graphics,
  base: Point,
  width: number,
  height: number,
  colour: number,
): void {
  const hw = width / 2;
  const hh = width / 4;
  const topY = base.y - height;

  graphics.fillStyle(shade(colour, 1.16), 1);
  polygon(graphics, [
    { x: base.x, y: topY - hh },
    { x: base.x + hw, y: topY },
    { x: base.x, y: topY + hh },
    { x: base.x - hw, y: topY },
  ]);

  graphics.fillStyle(colour, 1);
  polygon(graphics, [
    { x: base.x - hw, y: topY },
    { x: base.x, y: topY + hh },
    { x: base.x, y: base.y + hh },
    { x: base.x - hw, y: base.y },
  ]);

  graphics.fillStyle(shade(colour, 0.72), 1);
  polygon(graphics, [
    { x: base.x, y: topY + hh },
    { x: base.x + hw, y: topY },
    { x: base.x + hw, y: base.y },
    { x: base.x, y: base.y + hh },
  ]);

  // Two boards per face. A crate with no seams is a die.
  for (const depth of [height * 0.36, height * 0.7]) {
    graphics.fillStyle(shade(colour, 0.6), 1);
    polygon(graphics, [
      { x: base.x - hw, y: topY + depth },
      { x: base.x, y: topY + hh + depth },
      { x: base.x, y: topY + hh + depth + 1.1 },
      { x: base.x - hw, y: topY + depth + 1.1 },
    ]);
    graphics.fillStyle(shade(colour, 0.5), 1);
    polygon(graphics, [
      { x: base.x, y: topY + hh + depth },
      { x: base.x + hw, y: topY + depth },
      { x: base.x + hw, y: topY + depth + 1.1 },
      { x: base.x, y: topY + hh + depth + 1.1 },
    ]);
  }

  // The lit arris along the near-left top edge, and gloom in the inside corner.
  bevel(
    graphics,
    { x: base.x - hw, y: topY },
    { x: base.x, y: topY + hh },
    shade(colour, 1.34),
    1.1,
  );
}

/**
 * A barrel, as a ten-sided prism.
 *
 * Facets rather than an ellipse with a gradient, because the settlement is
 * flat-shaded throughout: each facet takes one tone from how far it turns away
 * from the light, and the eye assembles the curve. Drawn back to front, so the
 * far facets are simply covered rather than needing to be culled.
 */
function isoBarrel(
  graphics: Phaser.GameObjects.Graphics,
  base: Point,
  width: number,
  height: number,
): void {
  const facets = 10;
  const hw = width / 2;
  const hh = width / 4;
  const topY = base.y - height;

  const rim = (index: number, y: number): Point => {
    const angle = (Math.PI * 2 * index) / facets;
    return { x: base.x + Math.cos(angle) * hw, y: y + Math.sin(angle) * hh };
  };

  // Back to front: a facet's screen depth is the sine of its angle.
  const order = Array.from({ length: facets }, (_, index) => index).sort(
    (a, b) =>
      Math.sin((Math.PI * 2 * a) / facets) +
      Math.sin((Math.PI * 2 * (a + 1)) / facets) -
      (Math.sin((Math.PI * 2 * b) / facets) + Math.sin((Math.PI * 2 * (b + 1)) / facets)),
  );

  for (const index of order) {
    const mid = (Math.PI * 2 * (index + 0.5)) / facets;
    // Facing the light is facing up and to the left, which in this projection is
    // negative in both screen axes.
    const towards = (-Math.cos(mid) - Math.sin(mid)) / Math.SQRT2;
    graphics.fillStyle(shade(BARREL, 0.66 + 0.5 * Math.max(0, towards)), 1);
    polygon(graphics, [
      rim(index, topY),
      rim(index + 1, topY),
      rim(index + 1, base.y),
      rim(index, base.y),
    ]);
    // Two iron hoops, following the same facets so they wrap rather than float.
    for (const band of [height * 0.24, height * 0.7]) {
      graphics.fillStyle(shade(BARREL_HOOP, 0.85 + 0.4 * Math.max(0, towards)), 1);
      polygon(graphics, [
        { x: rim(index, topY).x, y: rim(index, topY).y + band },
        { x: rim(index + 1, topY).x, y: rim(index + 1, topY).y + band },
        { x: rim(index + 1, topY).x, y: rim(index + 1, topY).y + band + 1.6 },
        { x: rim(index, topY).x, y: rim(index, topY).y + band + 1.6 },
      ]);
    }
  }

  // The lid, and a board across it.
  graphics.fillStyle(shade(BARREL, 1.24), 1);
  polygon(
    graphics,
    Array.from({ length: facets }, (_, index) => rim(index, topY)),
  );
  graphics.fillStyle(shade(BARREL, 1.05), 1);
  polygon(graphics, [
    { x: base.x - hw * 0.86, y: topY - hh * 0.1 },
    { x: base.x + hw * 0.86, y: topY - hh * 0.1 },
    { x: base.x + hw * 0.86, y: topY + hh * 0.1 },
    { x: base.x - hw * 0.86, y: topY + hh * 0.1 },
  ]);
}

/**
 * Cut timber stacked on the deck: three logs and two on top of them.
 *
 * Lying down rather than stood on end, because that is how a settlement stacks
 * timber and because a lying log gives the eye a cylinder to read — a
 * parallelogram of bark with a pale sawn round at the near end.
 */
function isoLogStack(graphics: Phaser.GameObjects.Graphics, base: Point, width: number): void {
  const span = width * 0.9;
  const rise = span / 2;
  const bore = Math.max(4, width * 0.26);

  const log = (offsetX: number, offsetY: number): void => {
    const nearX = base.x + offsetX;
    const nearY = base.y + offsetY;
    const farX = nearX - span;
    const farY = nearY - rise;

    graphics.fillStyle(LOG_BARK, 1);
    polygon(graphics, [
      { x: farX, y: farY - bore },
      { x: nearX, y: nearY - bore },
      { x: nearX, y: nearY },
      { x: farX, y: farY },
    ]);
    // A lit strip along the top of the barrel of the log.
    graphics.fillStyle(shade(LOG_BARK, 1.3), 1);
    polygon(graphics, [
      { x: farX, y: farY - bore },
      { x: nearX, y: nearY - bore },
      { x: nearX, y: nearY - bore + 1.4 },
      { x: farX, y: farY - bore + 1.4 },
    ]);
    // The sawn end, pale against the bark: the whole reason a woodpile reads.
    graphics.fillStyle(LOG_END, 1);
    polygon(graphics, [
      { x: nearX, y: nearY - bore * 0.96 },
      { x: nearX + bore * 0.34, y: nearY - bore * 0.74 },
      { x: nearX + bore * 0.34, y: nearY - bore * 0.24 },
      { x: nearX, y: nearY - bore * 0.04 },
      { x: nearX - bore * 0.34, y: nearY - bore * 0.24 },
      { x: nearX - bore * 0.34, y: nearY - bore * 0.74 },
    ]);
    // Heartwood, a shade darker than the sapwood round it.
    graphics.fillStyle(shade(LOG_END, 0.82), 1);
    graphics.fillRect(nearX - bore * 0.12, nearY - bore * 0.62, bore * 0.24, bore * 0.26);
  };

  // Two courses of two, cross-stacked. Five rounds at this size turned into a
  // spray of pale dots rather than a woodpile.
  for (let i = 0; i < 2; i += 1) {
    log(i * bore * 1.05, -i * bore * 0.52);
  }
  log(bore * 0.52, -bore * 1.2);
}

/** A sack: a prism that narrows towards a tied throat. */
function isoSack(
  graphics: Phaser.GameObjects.Graphics,
  base: Point,
  width: number,
  height: number,
): void {
  const hw = width / 2;
  const hh = width / 4;
  const topY = base.y - height;
  const neck = hw * 0.42;

  graphics.fillStyle(SACK, 1);
  polygon(graphics, [
    { x: base.x - neck, y: topY },
    { x: base.x, y: topY + neck / 2 },
    { x: base.x, y: base.y + hh },
    { x: base.x - hw, y: base.y },
  ]);
  graphics.fillStyle(shade(SACK, 0.76), 1);
  polygon(graphics, [
    { x: base.x, y: topY + neck / 2 },
    { x: base.x + neck, y: topY },
    { x: base.x + hw, y: base.y },
    { x: base.x, y: base.y + hh },
  ]);
  // The tied throat, and a lit crease down the near edge.
  graphics.fillStyle(shade(SACK, 1.06), 1);
  polygon(graphics, [
    { x: base.x, y: topY - neck / 2 },
    { x: base.x + neck, y: topY },
    { x: base.x, y: topY + neck / 2 },
    { x: base.x - neck, y: topY },
  ]);
  graphics.fillStyle(shade(SACK, 0.6), 1);
  graphics.fillRect(base.x - neck * 0.6, topY + neck * 0.5, neck * 1.2, 1.4);
}

function drawStackedGoods(
  graphics: Phaser.GameObjects.Graphics,
  cx: number,
  y: number,
  halfW: number,
): void {
  const crate = Math.max(6, halfW * 0.16);
  graphics.fillStyle(0x5a4a33, 1);
  graphics.fillRect(cx - crate * 1.6, y - crate * 0.9, crate * 1.4, crate);
  graphics.fillRect(cx + crate * 0.3, y - crate * 0.6, crate * 1.2, crate * 0.8);
  graphics.fillStyle(0x6d5c40, 1);
  graphics.fillRect(cx - crate * 0.5, y - crate * 1.5, crate, crate * 0.9);
}
