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
import { bevel, contactShadow, occlude, polygon, shade, type Point } from './shading';

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
  readonly field?: 'crop' | 'orchard';
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
  // The only building people live in, and the only one with a hearth — so it is
  // the only one with smoke coming out of it, which is most of what makes a
  // settlement look inhabited rather than built.
  house: { wallHeight: 24, roofHeight: 48, eaves: 6, plinth: 5, chimney: true, windows: 2 },
  // An open yard. Low walls, no roof, so the player can see it is a place for
  // things rather than a place for people.
  'storage-yard': { wallHeight: 13, roofHeight: 0, eaves: 0, open: true },
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
  school: { wall: 0xb6b1a1, roof: 0x60594a, trim: 0x413c33 },
};

/** Breathing room above the roof, so nothing touches the texture edge. */
const TOP_MARGIN = 4;

/** Rubble footing and chimney stone. Cold and grey against the warm timber. */
const STONE_FOOTING = 0x6a675e;

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

  // Room for the roof's overhang on both sides.
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
 * Draws one building into `graphics`, sized to its own footprint.
 *
 * The result is an isometric box standing exactly on its plot: the base rhombus
 * is the footprint, the walls rise from it, and the roof caps them.
 */
export function drawBuilding(
  graphics: Phaser.GameObjects.Graphics,
  id: BuildingId,
  palette: BuildingPalette,
): void {
  const spec = buildingTextureSpec(id);
  const base = baseSize(BUILDINGS[id].footprint);
  const mass = MASS[id];

  const cx = spec.width / 2;
  const groundY = spec.height * spec.groundLine;

  const halfW = base.width / 2 - FOOTPRINT_INSET;
  const halfH = base.height / 2 - FOOTPRINT_INSET / 2;

  /** The four corners of a rhombus centred on `cx`, at height `y`. */
  const rhombus = (y: number): Rhombus => ({
    back: { x: cx, y: y - halfH },
    right: { x: cx + halfW, y },
    front: { x: cx, y: y + halfH },
    left: { x: cx - halfW, y },
  });

  const ground = rhombus(groundY);
  const plinthHeight = mass.plinth ?? 0;
  const sill = rhombus(groundY - plinthHeight);
  const top = rhombus(groundY - mass.wallHeight);

  // Planted rather than floating, and softly: see `contactShadow`.
  contactShadow(graphics, { x: cx, y: groundY }, halfW + 2, halfH + 1);

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

  const stack = chimneyOffset(id);
  if (stack) {
    drawChimney(graphics, cx + stack.dx, groundY + stack.dy);
  }
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
export function chimneyOffset(id: BuildingId): { dx: number; dy: number } | null {
  const mass = MASS[id];
  if (mass.chimney !== true) {
    return null;
  }

  const base = baseSize(BUILDINGS[id].footprint);
  const halfW = base.width / 2 - FOOTPRINT_INSET;

  // Placed *on* the roof plane, by interpolating along the left pitch from the
  // apex to the eaves. Guessing a height instead put the stack below the roof
  // surface, where it read as a post leaning against the gable.
  const apexY = -mass.wallHeight - mass.roofHeight;
  const eaveX = -halfW - mass.eaves;
  const eaveY = -mass.wallHeight + mass.eaves / 2;

  return {
    dx: eaveX * CHIMNEY_ALONG,
    dy: apexY + (eaveY - apexY) * CHIMNEY_ALONG,
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
    kind: 'crop' | 'orchard';
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

  if (kind === 'crop') {
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
