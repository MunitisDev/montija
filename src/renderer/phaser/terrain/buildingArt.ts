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
import { drawFeature, type FeatureKind } from './buildingFeatures';
import { CRATE, isoBarrel, isoCrate, isoLogStack, isoSack } from './isoProps';
import {
  STRUCTURE_CHIMNEY_HEIGHT,
  drawStructure,
  structureChimneyBase,
  type RoofCover,
  type RoofForm,
  type StructureLook,
  type WallBuild,
} from './structureArt';
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
  /** Height of the timber wall, above any stone base. */
  readonly wallHeight: number;
  /** Height of the ridge above the wall top. `0` leaves the building open. */
  readonly roofHeight: number;
  /** How far the roof oversails the walls, in pixels. */
  readonly eaves: number;
  /** Set for buildings that are a yard rather than a hall: no roof, low walls. */
  readonly open?: boolean;
  /** A stone footing under the walls, in pixels. Damp-proofing, and weight. */
  readonly plinth?: number;
  /** Which way the roof is framed. See {@link RoofForm}. */
  readonly form?: RoofForm;
  /** What the walls are built of. See {@link WallBuild}. */
  readonly build?: WallBuild;
  /** And what the roof is covered with. See {@link RoofCover}. */
  readonly cover?: RoofCover;
  /** An open lean-to work bay along the near-left wall, this many pixels deep. */
  readonly aisle?: number;
  /** Set when the building has a hearth, and so a chimney and smoke. */
  readonly chimney?: boolean;
  /** How many window openings each visible wall carries. */
  readonly windows?: number;
  /** Set to leave the near-left wall blank — a store with no door in that face. */
  readonly noDoor?: boolean;
  /** Set for worked land rather than a structure: furrows, or fruit trees. */
  readonly field?: 'crop' | 'orchard' | 'graves';
  /**
   * Set for the well, which is neither a structure nor a field.
   *
   * A hole in the ground with a wall round it: no walls to raise, no roof to
   * cover and no crop to fence. It gets its own branch rather than borrowing the
   * field's, because a field's rails round a well would read as a pen.
   */
  readonly wellhead?: true;
  /**
   * What the building keeps on its plot, and where.
   *
   * Mass and colour get a building most of the way to being recognisable, and
   * then stop: a Woodcutter and a Tailor are both a timber box under a pitched
   * roof. The feature is the bit that says which trade this is without a label.
   * `u` and `v` are plot coordinates running -1 to 1 from the back corner to the
   * front one along each grid axis, so a feature is placed by where it stands on
   * the *plot* rather than by a pixel offset that would be wrong at another
   * footprint size. See {@link plotPoint}.
   */
  readonly feature?: { readonly kind: FeatureKind; readonly u: number; readonly v: number };
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
   * garden, and the tempting way to get either is to draw past the plot edge.
   * That was tried on the yard and it is wrong — the footprint is what blocks
   * navigation, validates placement and gets saved, so art that oversails it
   * promises the player ground they cannot build on and cannot walk through.
   *
   * So the building shrinks instead and the ground around it is drawn *inside*
   * the plot. That ring is where the work bay reaches out to and where the trade
   * leaves its tools, and both read as making the building larger rather than
   * smaller, because there is somewhere for it to sit.
   */
  readonly inset?: number;
  /**
   * Ground drawn on the rest of the plot, where the building is inset.
   *
   * `worn` is the bare earth of a place people cross all day; `garden` is kept
   * ground — a bit of green, and a path beaten from the gate to the door.
   */
  readonly ground?: 'worn' | 'garden';
  /** A low fence round the plot's edge, with the near corner left open. */
  readonly fence?: boolean;
  /** A lean-to over the door, on two posts. */
  readonly porch?: boolean;
}

/** Room above a building's ridge for a stack standing on it, and its cap. */
const CHIMNEY_CLEARANCE = 22;

/** How much of its plot a building covers. The rest is its own ground. */
const PLOT_FILL = 0.66;

/**
 * How every building in the settlement is put together.
 *
 * **Two neighbours must not read as the same object.** Before this table every
 * building was a box under a pyramid in a different brown, which at gameplay
 * zoom is one silhouette repeated fifteen times. Four things are varied here and
 * each of them is legible from across the map: which way the ridge runs, what
 * the walls are built of, what the roof is covered with, and what the trade
 * leaves lying on its own ground.
 *
 * Roof heights are large on purpose. A pitch only reads as a pitch once the
 * ridge clears the *back* corner of its own rhombus, and for a 2x2 building that
 * corner is already 32px above the centre.
 */
const MASS: Readonly<Record<BuildingId, BuildingMass>> = {
  // A bridge, while it is being built: a course of timbers just clear of the
  // water and nothing above them. Once it is finished the road art draws it, so
  // this is only ever seen as a half-built crossing.
  bridge: { wallHeight: 4, roofHeight: 0, eaves: 0, open: true },

  // The only building people live in, and the only one with a hearth — so the
  // only one with smoke coming out of it, which is most of what makes a
  // settlement look inhabited rather than built. It gets the cross gable, the
  // richest roof in the game, because it is the building there are most of.
  house: {
    wallHeight: 25,
    roofHeight: 34,
    eaves: 6,
    plinth: 8,
    form: 'cross',
    build: 'boarded',
    cover: 'thatch',
    chimney: true,
    windows: 2,
    inset: PLOT_FILL,
    ground: 'garden',
  },

  // **A deck, not a box.** It was a low flat slab with three rectangles on it —
  // the least built-looking thing in the settlement, and the first thing every
  // player sees, since the founding camp borrows this art. It is now a plank
  // floor standing clear of the ground on posts, framed with a rail, with a
  // trodden path worn round it and goods stacked on the boards.
  //
  // `wallHeight` here is not a wall: nothing about a yard is a wall. It is the
  // headroom the tallest thing on the deck needs. See `drawStorageYard`.
  'storage-yard': {
    wallHeight: 30,
    roofHeight: 0,
    eaves: 0,
    inset: 0.7,
    open: true,
    yard: true,
  },

  // A granary: shut tight, because its whole purpose is keeping weather out. No
  // windows for the same reason, no door in the near wall, and a deep stone
  // footing to keep damp off grain. The sacks on staddle stones outside are what
  // say *food* rather than *goods*.
  'food-storage': {
    wallHeight: 22,
    roofHeight: 21,
    eaves: 7,
    plinth: 8,
    form: 'gable',
    build: 'boarded',
    cover: 'shingle',
    windows: 0,
    noDoor: true,
    feature: { kind: 'granary', u: 0.2, v: 0.86 },
    inset: PLOT_FILL,
    ground: 'worn',
  },

  // A forager's shelter: log walls, deep thatch, one window. The baskets and the
  // drying frame outside are the whole identity — the hut itself is the
  // cheapest thing anyone in the settlement builds.
  'gatherer-hut': {
    wallHeight: 18,
    roofHeight: 20,
    eaves: 7,
    form: 'gable-left',
    build: 'log',
    cover: 'thatch',
    windows: 1,
    feature: { kind: 'baskets', u: 0.86, v: 0.1 },
    inset: PLOT_FILL,
    ground: 'worn',
  },

  // **Where the settlement's timber comes from.** A cutters' hut at the edge of
  // the wood: log walls, a plain shingle roof, and a whole trunk up on trestles
  // outside with the saw still in it. Nothing like the Woodcutter's split-wood
  // pile — one of them fells trees and the other splits what is brought in, and
  // the player has to be able to see which is which without tapping either.
  feller: {
    wallHeight: 18,
    roofHeight: 20,
    eaves: 7,
    form: 'gable-left',
    build: 'log',
    cover: 'shingle',
    windows: 1,
    feature: { kind: 'trestle', u: 0.84, v: 0.14 },
    inset: PLOT_FILL,
    ground: 'worn',
  },

  // A workshop, with the work happening in an open bay along the near wall and
  // the split logs stacked under it.
  woodcutter: {
    wallHeight: 22,
    roofHeight: 21,
    eaves: 6,
    plinth: 4,
    form: 'gable',
    build: 'boarded',
    cover: 'shingle',
    aisle: 15,
    windows: 1,
    feature: { kind: 'logpile', u: 0.86, v: 0.15 },
    inset: PLOT_FILL,
    ground: 'worn',
  },

  // A quarry is a shed over a hole, and most of what the player should read is
  // *cut rock*: stone walls, a slate roof, dressed blocks lying on the ground.
  quarry: {
    wallHeight: 16,
    roofHeight: 16,
    eaves: 5,
    plinth: 6,
    form: 'gable',
    build: 'stone',
    cover: 'slate',
    aisle: 13,
    windows: 0,
    feature: { kind: 'blocks', u: 0.84, v: 0.1 },
    inset: PLOT_FILL,
    ground: 'worn',
  },

  // A mine is a mouth in the hillside. The timbered adit outside is doing the
  // work here; the building behind it is only the winding house.
  mine: {
    wallHeight: 16,
    roofHeight: 17,
    eaves: 5,
    plinth: 8,
    form: 'gable-left',
    build: 'stone',
    cover: 'slate',
    windows: 0,
    noDoor: true,
    feature: { kind: 'adit', u: 0.2, v: 0.84 },
    inset: PLOT_FILL,
    ground: 'worn',
  },

  // A forge: half-timbered, stone-footed against the fire, the darkest roof in
  // the settlement, and the only warm colour anywhere in it — the fire in the
  // hearth mouth under the open bay.
  blacksmith: {
    wallHeight: 21,
    roofHeight: 20,
    eaves: 6,
    plinth: 6,
    form: 'gable',
    build: 'framed',
    cover: 'slate',
    aisle: 15,
    chimney: true,
    windows: 1,
    feature: { kind: 'forge', u: 0.82, v: 0.18 },
    inset: PLOT_FILL,
    ground: 'worn',
  },

  // A big open-fronted shed: goods come and go, so it reads as a place things
  // pass through rather than a place people live. A cart stands in the yard.
  'trading-post': {
    wallHeight: 19,
    roofHeight: 22,
    eaves: 9,
    plinth: 5,
    form: 'gable',
    build: 'framed',
    cover: 'shingle',
    aisle: 20,
    windows: 1,
    feature: { kind: 'cart', u: 0.84, v: 0.05 },
    inset: PLOT_FILL,
    ground: 'worn',
  },

  // A small log hut with a hearth kept in: herbs are dried over a slow fire.
  // The racks outside are the trade.
  herbalist: {
    wallHeight: 16,
    roofHeight: 18,
    eaves: 7,
    form: 'gable-left',
    build: 'log',
    cover: 'thatch',
    chimney: true,
    windows: 1,
    feature: { kind: 'racks', u: 0.84, v: 0.12 },
    inset: PLOT_FILL,
    ground: 'worn',
  },

  // Half-timbered and kept clean, which is the point of the building, with a
  // physic garden along one side and a bench to sit a patient on.
  healer: {
    wallHeight: 21,
    roofHeight: 32,
    eaves: 6,
    plinth: 7,
    form: 'cross',
    build: 'framed',
    cover: 'shingle',
    chimney: true,
    windows: 2,
    feature: { kind: 'physic', u: 0.84, v: 0.1 },
    inset: PLOT_FILL,
    ground: 'garden',
  },

  // A shed on a bank: boarded, low, one window, with the drying frame and the
  // creel outside doing all the work of saying *river*. Deliberately the least
  // built-looking hut in the settlement after the gatherer's — it is a jetty
  // with a roof behind it.
  'fishing-hut': {
    wallHeight: 16,
    roofHeight: 17,
    eaves: 7,
    form: 'gable',
    build: 'boarded',
    cover: 'thatch',
    windows: 1,
    feature: { kind: 'nets', u: 0.84, v: 0.14 },
    inset: PLOT_FILL,
    ground: 'worn',
  },

  // A cabin out at the treeline, with a hide stretched in its frame and antlers
  // on a post — the two things in the settlement that could be nothing else.
  hunter: {
    wallHeight: 17,
    roofHeight: 19,
    eaves: 7,
    form: 'gable-left',
    build: 'log',
    cover: 'thatch',
    windows: 1,
    feature: { kind: 'hides', u: 0.84, v: 0.1 },
    inset: PLOT_FILL,
    ground: 'worn',
  },

  // A workshop with good light: two windows a face, which nothing else has, and
  // cloth on a line outside where the dye vat is.
  tailor: {
    wallHeight: 20,
    roofHeight: 20,
    eaves: 6,
    plinth: 4,
    form: 'gable',
    build: 'framed',
    cover: 'shingle',
    aisle: 13,
    windows: 2,
    feature: { kind: 'cloth', u: 0.84, v: 0.12 },
    inset: PLOT_FILL,
    ground: 'worn',
  },

  // Not buildings at all: broken ground inside a low fence. Drawn flat so the
  // settlement's skyline stays buildings, and a field reads as worked land.
  'crop-field': { wallHeight: 4, roofHeight: 0, eaves: 0, field: 'crop' },
  orchard: { wallHeight: 4, roofHeight: 0, eaves: 0, field: 'orchard' },
  // Low walls round a piece of ground, and markers standing in it. Drawn as a
  // field for the same reason: a cemetery is worked ground, not a structure.
  cemetery: { wallHeight: 5, roofHeight: 0, eaves: 0, field: 'graves' },

  // **A hole in the ground with a wall round it**, which is what a well is. No
  // roof and no walls to draw: worn earth where the buckets are set down, a low
  // stone kerb, and the frame over it. Drawn as a field for the same reason the
  // cemetery is — it is a piece of worked ground, not a structure — and it wants
  // to sit *low* between the houses rather than compete with them.
  well: { wallHeight: 6, roofHeight: 0, eaves: 0, wellhead: true, ground: 'worn' },

  // The one building meant to outlast the people who raised it: stone the whole
  // way up, under the heaviest roof in the settlement, and taller than anything
  // else. Its silhouette should read as reaching upwards from across the map.
  temple: {
    wallHeight: 30,
    roofHeight: 44,
    eaves: 6,
    plinth: 11,
    // **A long steep hall, where the school is a cross.** The two were the same
    // building in two greys until this: same footprint, same cross gable, same
    // pale walls. One ridge running the length of it, pitched far steeper than
    // anything else in the settlement, is a different shape from across the map.
    form: 'gable-left',
    build: 'stone',
    cover: 'slate',
    windows: 2,
    feature: { kind: 'bell', u: 0.8, v: 0.05 },
    inset: 0.68,
    ground: 'garden',
  },

  // Half-timbered, deep-plinthed and full of windows, because a room people
  // read in needs light. The bell outside is the settlement calling them in.
  school: {
    wallHeight: 29,
    roofHeight: 46,
    eaves: 7,
    plinth: 9,
    form: 'cross',
    build: 'framed',
    cover: 'slate',
    chimney: true,
    windows: 2,
    feature: { kind: 'bell', u: 0.78, v: 0.12 },
    inset: 0.68,
    ground: 'garden',
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
  // Boarded timber under ochre thatch, framed in oak. Chosen by eye against the
  // grass and the trees rather than derived from anything.
  house: { wall: 0x8a6f4c, roof: 0x9a8654, trim: 0x5d4830 },
  // Open yards keep their timber: no roof to contrast against, and they should
  // read as structures rather than as dwellings.
  'storage-yard': { wall: 0x8a7350, roof: 0x574733, trim: 0x4a3826 },
  // A granary. Daub like a house, but its roof is ochre thatch-board rather
  // than tile — cheaper building, cheaper roof.
  'food-storage': { wall: 0x9c9179, roof: 0x6d5a3a, trim: 0x3f382a },
  // Thatched, so the roof colour is barely used; the walls carry the identity.
  'gatherer-hut': { wall: 0x8d8a6c, roof: 0x4c5039, trim: 0x3b4030 },
  // A workshop: timber walls, dark shingles. Still a clear gap between them.
  // Bark-brown log walls under weathered shingle: the roughest building the
  // settlement raises, and the first one it needs.
  feller: { wall: 0x74603f, roof: 0x574734, trim: 0x3a2f22 },
  woodcutter: { wall: 0x86714f, roof: 0x4a3b2a, trim: 0x362c20 },
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
  // Timber that has spent its life wet: grey-green, the coolest walls on dry
  // land, so a fishing hut reads as belonging to the river rather than the wood.
  'fishing-hut': { wall: 0x7f877a, roof: 0x6a6b4c, trim: 0x3b4034 },
  hunter: { wall: 0x8a7454, roof: 0x7a6942, trim: 0x3c3327 },
  // A workshop with good light, and the palest walls of the working buildings.
  tailor: { wall: 0xa08c84, roof: 0x584740, trim: 0x342c29 },
  // Worked ground rather than buildings — the trim colour is the soil and the
  // wall colour is what is growing in it.
  // The field's green is the *leaf* green of a vegetable bed, kept well clear of
  // the orchard's darker crowns — the two plots are the pair most likely to be
  // mistaken for one another, so their greens are chosen against each other.
  'crop-field': { wall: 0x87924a, roof: 0x6a5f38, trim: 0x574a2c },
  orchard: { wall: 0x4a5a33, roof: 0x44502f, trim: 0x475339 },
  // Dressed stone, paler and greyer than anything around it, under slate. The
  // settlement's one monument should be legible from across the map.
  // Turned earth and grey markers, kept deliberately quiet — but not black. At
  // `0x45483c` the sward read as a hole cut in the meadow rather than as ground
  // that had been let go.
  cemetery: { wall: 0x5d6350, roof: 0x9a978c, trim: 0x565c48 },
  // Wet stone and dark water: the only cold, damp thing the settlement builds.
  // `wall` is the kerb, `roof` the timber frame, `trim` the trodden ground.
  well: { wall: 0x8d8b83, roof: 0x6b5a3f, trim: 0x6a6047 },
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
 * The masonry an improved building shows for itself.
 *
 * **A house with a stone hearth has to be legible from the camera**, or the
 * player has no way of knowing which of their eight cottages they have already
 * paid for. Everything about the drawing is fixed by the texture box — the
 * silhouette cannot grow — so the difference is carried in the *colour of the
 * stone*: dressed and pale where the plain house's footing is field stone. It
 * reads on the chimney, which is the part of a house the eye finds first.
 */
const IMPROVED_STONE = 0x9d9789;

/**
 * What an improvement changes about how a building is put together.
 *
 * **A pale chimney was not enough.** The first attempt at a stone hearth carried
 * the whole difference in the colour of one stack, and at the zoom a settlement
 * is actually played at that is a few pixels: a player with eight cottages had
 * no way of telling which four they had already paid for. A house that has been
 * given a hearth has had its walls taken down to the footing and rebuilt in
 * stone under slate, so that is what it is drawn as — a different *material*,
 * which the eye reads at any distance, rather than a different shade.
 *
 * Nothing in here may make a building taller. The texture box is measured from
 * the plain mass in {@link buildingTextureSpec}, so a higher wall or a steeper
 * roof would be quietly cropped; material and colour are free.
 */
interface ImprovedLook {
  readonly build?: WallBuild;
  readonly cover?: RoofCover;
  readonly wall?: number;
  readonly roof?: number;
  readonly timber?: number;
}

const IMPROVED: Partial<Readonly<Record<BuildingId, ImprovedLook>>> = {
  // Rubble stone, laid pale and cold against the timber cottages beside it,
  // under grey slate where the plain house has ochre thatch. The two read
  // differently in silhouette even in snow, which is when it matters most.
  house: { build: 'stone', cover: 'slate', wall: 0x9c968a, roof: 0x5d6064, timber: 0x4b4640 },
};

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
 * Stones showing through a worked plot's bare earth, in plot coordinates.
 *
 * Fixed rather than seeded: the art is generated once at startup and a plot's
 * ground has to be the same in every settlement, or two Woodcutters side by side
 * would have different dirt and the eye would look for a reason.
 */
const PLOT_STONES: readonly (readonly [number, number])[] = [
  [0.26, 0.9],
  [0.86, 0.42],
  [0.7, 0.82],
  [0.14, 0.62],
  [0.9, 0.16],
];

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
/** Oak, darkened by whatever has been kept in it, under iron hoops. */
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
  //
  // The stack stands on top of the ridge, so a building with a hearth needs the
  // room for it or the smoke comes out of a chimney the texture has cut off.
  const above =
    base.height / 2 +
    (mass.plinth ?? 0) +
    mass.wallHeight +
    mass.roofHeight +
    (mass.chimney === true ? CHIMNEY_CLEARANCE : 0) +
    TOP_MARGIN;
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
  // A building that can be improved is drawn twice: as built, and with the
  // masonry that improvement buys. See {@link IMPROVED_STONE}.
  return BUILDINGS[id].upgrade ? 2 : 1;
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
/**
 * A point on a building's plot, in plot coordinates.
 *
 * `u` and `v` run from -1 at the back corner to 1 at the front one along the two
 * grid axes, so `(1, 1)` is the corner nearest the camera and `(-1, 1)` the left
 * one. Features are placed this way rather than in pixels because the same
 * `(0.84, 0.1)` means "out beside the near-right wall" on a 2x2 plot and on a
 * 3x3 one, and a pixel offset would only be right on one of them.
 */
function plotPoint(
  cx: number,
  groundY: number,
  halfW: number,
  halfH: number,
  u: number,
  v: number,
): Point {
  return { x: cx + ((u - v) * halfW) / 2, y: groundY + ((u + v) * halfH) / 2 };
}

/** The look one building is built to, assembled from its mass and its palette. */
function lookFor(id: BuildingId, palette: BuildingPalette, variant = 0): StructureLook {
  const mass = MASS[id];
  // Only ever for a building that *has* an improvement, and only for its second
  // variant. See {@link IMPROVED} and {@link artVariants}.
  const better = variant > 0 ? IMPROVED[id] : undefined;
  return {
    wallHeight: mass.wallHeight,
    roofHeight: mass.roofHeight,
    eaves: mass.eaves,
    plinth: mass.plinth ?? 0,
    wall: better?.wall ?? palette.wall,
    roof: better?.roof ?? palette.roof,
    timber: better?.timber ?? palette.trim,
    stone: variant > 0 ? IMPROVED_STONE : STONE_FOOTING,
    form: mass.form ?? 'gable',
    build: better?.build ?? mass.build ?? 'framed',
    cover: better?.cover ?? mass.cover ?? 'shingle',
    windows: mass.windows ?? 1,
    door: mass.noDoor !== true,
    chimney: mass.chimney === true,
    aisle: mass.aisle ?? 0,
  };
}

/**
 * Draws one building into its texture.
 *
 * The order is the order a building is put up in, and it matters: the ground it
 * stands on, the contact shadow, the structure itself, then whatever the trade
 * leaves lying on the ring of plot around it — which is drawn last because it is
 * nearest the camera.
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
  // is drawn now and the near half after the building, or a building would stand
  // in front of the rails that are supposed to be in front of it.
  if (mass.ground) {
    drawPlotGround(graphics, { cx, groundY, halfW: plotW, halfH: plotH, kind: mass.ground });
  }
  if (mass.fence) {
    drawFence(graphics, { palette, cx, groundY, halfW: plotW, halfH: plotH, side: 'far' });
  }

  // Planted rather than floating, and softly: see `contactShadow`.
  contactShadow(graphics, { x: cx, y: groundY }, halfW * SHADOW_FIT, halfH * SHADOW_FIT);

  if (mass.wellhead) {
    drawWellhead(graphics, { palette, cx, groundY, halfW: plotW, halfH: plotH });
    return;
  }

  if (mass.field) {
    drawField(graphics, { palette, cx, groundY, halfW, halfH, kind: mass.field });
    return;
  }

  if (mass.open) {
    // An open pen: low walls with the floor showing inside them rather than a
    // roof. Only the half-built bridge uses this now.
    const sill = rhombus(groundY - (mass.plinth ?? 0));
    const top = rhombus(groundY - mass.wallHeight);
    graphics.fillStyle(palette.wall, 1);
    polygon(graphics, [top.left, top.front, sill.front, sill.left]);
    graphics.fillStyle(shade(palette.wall, 0.78), 1);
    polygon(graphics, [top.front, top.right, sill.right, sill.front]);
    graphics.fillStyle(shade(palette.trim, 0.9), 1);
    polygon(graphics, [top.back, top.right, top.front, top.left]);
    drawStackedGoods(graphics, cx, groundY - mass.wallHeight, halfW);
    return;
  }

  drawStructure(graphics, lookFor(id, palette, variant), { cx, groundY, halfW, halfH });

  // What the trade leaves on its own ground. Last, because it stands between the
  // building and the camera — and inside the plot, always: see `BuildingMass`.
  if (mass.feature) {
    drawFeature(graphics, mass.feature.kind, {
      ...plotPoint(cx, groundY, plotW, plotH, mass.feature.u, mass.feature.v),
      // Scaled off the plot, so a 3x3 building's tools are not the same size as
      // a 2x2 one's and dwarfed by the building behind them.
      scale: Math.max(0.7, Math.min(1.35, plotW / 66)),
    });
  }

  if (mass.fence) {
    drawFence(graphics, { palette, cx, groundY, halfW: plotW, halfH: plotH, side: 'near' });
  }

  void ground;
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
    // Bare earth, and a flat wash of it is the one thing on a plot that can
    // still read as a sticker. A trodden line from the near corner to the door
    // and a few stones showing through are enough to make it ground.
    graphics.fillStyle(shade(colour, 1.1), 1);
    polygon(graphics, [
      { x: cx, y: groundY + halfH },
      { x: cx - halfW * 0.52, y: groundY + halfH * 0.48 },
      { x: cx - halfW * 0.46, y: groundY + halfH * 0.24 },
      { x: cx + halfW * 0.08, y: groundY + halfH * 0.84 },
    ]);
    graphics.fillStyle(shade(colour, 0.86), 1);
    for (const [u, v] of PLOT_STONES) {
      graphics.fillRect(cx + (u - v) * halfW - 2, groundY + (u + v - 1) * halfH - 1, 4, 2);
    }
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
 * Where a building's chimney is, relative to its anchor.
 *
 * Exported because the smoke has to come out of the actual stack rather than out
 * of the middle of the roof. The offsets are in texture pixels from the
 * footprint's centre, which is exactly what a sprite's position is, so the
 * renderer can add them without knowing anything about how a building is drawn.
 *
 * Asked of the structure itself rather than worked out here: the stack stands on
 * whichever ridge that building actually has, and the two would drift apart the
 * moment a roof form changed. Guessing it separately is what once had the
 * chimney hanging in the air beside the house.
 *
 * `null` for the buildings with no hearth, which is most of them.
 */
export function chimneyOffset(id: BuildingId): { dx: number; dy: number } | null {
  const mass = MASS[id];
  if (mass.chimney !== true) {
    return null;
  }

  // The building's half-extents, not the plot's: a building drawn inset is
  // smaller than the ground it stands on, and measuring the roof from the plot
  // puts the stack out where the eaves would have been if it filled its cells.
  const base = baseSize(BUILDINGS[id].footprint);
  const inset = mass.inset ?? 1;
  const stack = structureChimneyBase(lookFor(id, BUILDING_COLOURS[id]), {
    cx: 0,
    groundY: 0,
    halfW: (base.width / 2 - FOOTPRINT_INSET) * inset,
    halfH: (base.height / 2 - FOOTPRINT_INSET / 2) * inset,
  });
  return { dx: stack.x, dy: stack.y };
}

/** The lip of the stack, where smoke actually leaves the building. */
export function chimneyMouth(id: BuildingId): { dx: number; dy: number } | null {
  const stack = chimneyOffset(id);
  if (!stack) {
    return null;
  }
  return { dx: stack.dx, dy: stack.dy - STRUCTURE_CHIMNEY_HEIGHT };
}

/**
 * The well: worn ground, a stone kerb and the frame over it.
 *
 * Everything here is small on purpose. A well stands *between* the houses and
 * has to read as a thing people walk to rather than as a building of its own, so
 * the tallest part of it is shorter than a cottage door.
 *
 * The mouth is the darkest thing in the settlement, which is the whole trick:
 * without it the kerb reads as a stone table.
 */
function drawWellhead(
  graphics: Phaser.GameObjects.Graphics,
  options: {
    palette: BuildingPalette;
    cx: number;
    groundY: number;
    halfW: number;
    halfH: number;
  },
): void {
  const { palette, cx, groundY, halfW } = options;

  // Sized off the plot but kept small: a well is a thing people walk to, not a
  // building of its own, and its frame has to stay under a cottage door.
  const radius = Math.max(9, halfW * 0.3);
  const kerbHeight = 6;
  const lip = groundY - kerbHeight;

  graphics.fillStyle(0x000000, 0.2);
  graphics.fillEllipse(cx + 1.5, groundY + 1.5, radius * 2.5, radius * 1.25);

  // The kerb's near face, dropped from the lip to the ground.
  graphics.fillStyle(shade(palette.wall, 0.62), 1);
  graphics.fillRect(cx - radius, lip, radius * 2, kerbHeight);
  graphics.fillEllipse(cx, groundY, radius * 2, radius);

  // The coping, and the mouth cut into it. The mouth is the darkest thing in the
  // settlement, which is the whole trick — without it the kerb reads as a table.
  graphics.fillStyle(palette.wall, 1);
  graphics.fillEllipse(cx, lip, radius * 2, radius);
  graphics.fillStyle(shade(palette.wall, 1.16), 1);
  graphics.fillEllipse(cx - radius * 0.14, lip - 0.6, radius * 1.5, radius * 0.75);
  graphics.fillStyle(0x14181a, 1);
  graphics.fillEllipse(cx, lip, radius * 1.35, radius * 0.68);
  // Water, well down the shaft: a sliver of sky caught on it.
  graphics.fillStyle(0x2c4148, 1);
  graphics.fillEllipse(cx, lip + 1.4, radius * 0.9, radius * 0.42);

  // Two posts and a beam over the mouth, with a bucket on its rope. The frame is
  // what makes it a well rather than a cistern at any zoom.
  const postHeight = 15;
  graphics.fillStyle(shade(palette.roof, 0.85), 1);
  for (const side of [-1, 1] as const) {
    graphics.fillRect(cx + side * radius * 0.78 - 1.2, lip - postHeight, 2.4, postHeight + 2);
  }
  graphics.fillStyle(palette.roof, 1);
  graphics.fillRect(cx - radius * 0.78 - 1.2, lip - postHeight - 2.4, radius * 1.56 + 2.4, 2.6);
  // The rope and the bucket, hanging just inside the mouth.
  graphics.fillStyle(shade(palette.roof, 0.6), 1);
  graphics.fillRect(cx - 0.5, lip - postHeight, 1, 5.5);
  graphics.fillStyle(shade(palette.roof, 1.2), 1);
  graphics.fillRect(cx - 2.4, lip - postHeight + 5, 4.8, 4);
  graphics.fillStyle(shade(palette.roof, 0.75), 1);
  graphics.fillRect(cx - 2.4, lip - postHeight + 5, 4.8, 1.1);
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

  // Broken earth, in two facets like the ground it replaced. The two are pulled
  // well apart: at a few per cent difference a field reads as one flat sticker.
  graphics.fillStyle(shade(palette.trim, 1.14), 1);
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
    // Markers in rows, leaning slightly, each on its own mound. Stone rather
    // than timber: a settlement that can spare masonry for its dead is saying
    // something, and it is the reason the building costs stone at all.
    //
    // Two faces and a rounded head, not a pale rectangle. The first version was
    // a flat slab in the roof colour and read as a row of fence pickets.
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
      const height = 9 + (index % 2) * 2;
      index += 1;

      // The mound: turned earth that has settled back, darker than the grass.
      graphics.fillStyle(shade(palette.trim, 0.82), 1);
      graphics.fillEllipse(x + 0.5, y + 1, 12, 4.6);
      graphics.fillStyle(0x000000, 0.18);
      graphics.fillEllipse(x + 2.5, y + 1.4, 7, 2.6);

      const head = y - height;
      const tilt = lean * 0.9;
      graphics.fillStyle(shade(palette.roof, 0.9), 1);
      polygon(graphics, [
        { x: x - 2.6 + tilt, y: head + 1.4 },
        { x: x + 0.4 + tilt, y: head + 2.4 },
        { x: x + 0.4, y },
        { x: x - 2.6, y: y - 1 },
      ]);
      graphics.fillStyle(shade(palette.roof, 0.66), 1);
      polygon(graphics, [
        { x: x + 0.4 + tilt, y: head + 2.4 },
        { x: x + 2.6 + tilt, y: head + 1.4 },
        { x: x + 2.6, y: y - 1 },
        { x: x + 0.4, y },
      ]);
      // The head, cut round the way a marker was.
      graphics.fillStyle(shade(palette.roof, 1.1), 1);
      polygon(graphics, [
        { x: x - 2.6 + tilt, y: head + 1.4 },
        { x: x - 1.4 + tilt, y: head - 0.6 },
        { x: x + 1.4 + tilt, y: head - 0.6 },
        { x: x + 2.6 + tilt, y: head + 1.4 },
        { x: x + 0.4 + tilt, y: head + 2.4 },
      ]);
    }
  } else if (kind === 'crop') {
    // **Beds of vegetables, not just ploughing.** Furrows alone read as "some
    // kind of worked ground", and the player had a field and an orchard that
    // looked like two versions of each other. Two things fix it: the ground is
    // *banded* rather than striped, so it reads as dug from any distance, and
    // there is a crop standing in it — rows of leaf clumps, with one bed turned
    // over and bare, which is what a garden looks like halfway through a season.
    //
    // Eight bands, with a boundary at the middle: the rhombus narrows towards
    // each end, and a band straddling the widest point would cut the corner off
    // its own plot.
    const BANDS = 8;
    const edge = (t: number) => ({
      x: cx + halfW * t,
      half: halfH * (1 - Math.abs(t)),
    });
    for (let band = 0; band < BANDS; band += 1) {
      const from = edge(-1 + (band * 2) / BANDS);
      const to = edge(-1 + ((band + 1) * 2) / BANDS);
      // Turned earth, in two tones. Wide enough apart to read as ridge and
      // furrow rather than as a texture.
      graphics.fillStyle(shade(palette.trim, band % 2 === 0 ? 1.24 : 0.96), 1);
      polygon(graphics, [
        { x: from.x, y: groundY - from.half },
        { x: to.x, y: groundY - to.half },
        { x: to.x, y: groundY + to.half },
        { x: from.x, y: groundY + from.half },
      ]);

      // One bed left bare: dug over and waiting, so the field reads as tended
      // rather than as a printed pattern.
      if (band === 2) {
        continue;
      }

      // Cabbage-shaped clumps down the middle of the ridge, two tones with the
      // light one on the upper left like everything else in the settlement — a
      // flat green blob at this size reads as a coin.
      const x = (from.x + to.x) / 2;
      const half = (from.half + to.half) / 2;
      for (const along of [-0.66, -0.22, 0.22, 0.66] as const) {
        const y = groundY + half * along;
        graphics.fillStyle(shade(palette.trim, 0.72), 1);
        graphics.fillEllipse(x + 0.6, y + 2, 8.6, 3.6);
        graphics.fillStyle(shade(palette.wall, band % 2 === 0 ? 1.04 : 0.88), 1);
        graphics.fillEllipse(x, y, 8.4, 6);
        graphics.fillStyle(shade(palette.wall, 1.26), 1);
        graphics.fillEllipse(x - 1.8, y - 1.5, 4, 3);
      }
    }
  } else {
    // **Fruit trees, with fruit on them.** An orchard has to be tellable from
    // the field beside it *and* from the wild wood behind it: the rows are what
    // say planted, and the fruit is what says orchard rather than coppice. The
    // grass between the rows is left alone — an orchard is not ploughed, and
    // that is half of what separates the two plots at a glance.
    const FRUIT = 0xb8452b;
    let index = 0;
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
      index += 1;

      graphics.fillStyle(0x000000, 0.18);
      graphics.fillEllipse(x, y + 1, 12, 4.4);
      // A short trunk that forks, which is how a tree kept low for picking
      // grows and the quickest way to say *pruned*.
      graphics.fillStyle(0x4a3d2c, 1);
      graphics.fillRect(x - 1.3, y - 9, 2.6, 9);
      graphics.fillRect(x - 3.4, y - 11, 2, 4);
      graphics.fillRect(x + 1.6, y - 11, 2, 4);

      graphics.fillStyle(shade(palette.wall, 1.22), 1);
      graphics.fillEllipse(x - 1.5, y - 15, 14, 12);
      graphics.fillStyle(shade(palette.wall, 0.78), 1);
      graphics.fillEllipse(x + 3.2, y - 12.5, 8.5, 8.5);

      // Fruit, in the crown and under it. Positioned off the row's index rather
      // than rolled: this is drawn once into a texture, and the renderer must
      // never touch a simulation stream.
      graphics.fillStyle(FRUIT, 1);
      for (const [fx, fy] of [
        [-4.6, -17],
        [0.4, -19.4],
        [3.6, -15.6],
        [-2.4, -12.4],
      ] as const) {
        graphics.fillCircle(x + fx + (index % 2) * 0.8, y + fy + (index % 3) * 0.6, 1.5);
      }
      graphics.fillStyle(shade(FRUIT, 1.35), 1);
      graphics.fillCircle(x + 0.8, y - 19.6, 0.7);
    }
  }

  // A low fence on the two back edges only. Across the front it would hide the
  // crop, which is the one thing the player needs to see.
  graphics.lineStyle(2, shade(palette.roof, 0.7), 0.85);
  graphics.beginPath();
  graphics.moveTo(cx - halfW, groundY - 4);
  graphics.lineTo(cx, groundY - halfH - 4);
  graphics.lineTo(cx + halfW, groundY - 4);
  graphics.strokePath();
  graphics.fillStyle(shade(palette.roof, 0.62), 1);
  for (const t of [-0.66, -0.33, 0, 0.33, 0.66]) {
    const x = cx + halfW * t;
    const y = groundY - halfH * (1 - Math.abs(t));
    graphics.fillRect(x - 1, y - 7, 2, 7);
  }
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

/**
 * Where a building's roof is, relative to its anchor, and how wide.
 *
 * Exported for the flames. A building alight burns *on its roof*, and the roof
 * is not a thing the renderer can see: it is buried in the same mass table the
 * texture was drawn from. Asking here is what stops a fire drawn beside the
 * house it is supposedly consuming — the same reason {@link chimneyOffset}
 * exists, and the same failure it was written to prevent.
 *
 * `dy` is the height of the ridge above the footprint's centre, negative because
 * up is negative on screen; `halfWidth` is the built part's half-extent, so
 * flames spread across the roof rather than across the garden.
 */
export function roofSpan(id: BuildingId): { dy: number; halfWidth: number } {
  const mass = MASS[id];
  const base = baseSize(BUILDINGS[id].footprint);
  const inset = mass.inset ?? 1;
  return {
    // Two thirds up the pitch rather than at the ridge: fire comes through a
    // roof where the roof is, and a tongue starting at the apex reads as a flag.
    dy: -((mass.plinth ?? 0) + mass.wallHeight + mass.roofHeight * 0.62),
    halfWidth: (base.width / 2 - FOOTPRINT_INSET) * inset,
  };
}
