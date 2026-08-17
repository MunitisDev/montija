/**
 * Procedural placeholder artwork.
 *
 * Generates diamond tiles and tree silhouettes at runtime, so the prototype has
 * no art dependencies at all. Everything here is temporary — but it obeys
 * `docs/ART_BIBLE.md` on the things that are expensive to change later:
 * dimensions, anchors and footprints. Swapping in real artwork should be a file
 * change, not a layout rewrite.
 *
 * The palette is muted and earthy by design. Even a placeholder should not read
 * as a bright mobile toy.
 *
 * **Everything is packed into two atlases, one for terrain and one for trees.**
 * That is not premature tidiness: the renderer sorts objects by depth, which
 * interleaves terrain types, and a GPU batch breaks every time the texture
 * changes between adjacent objects. Separate textures would turn ~9k tiles into
 * thousands of draw calls on exactly the low-power tablet GPUs this project
 * targets. One atlas means one batch, whatever the draw order.
 */

import type Phaser from 'phaser';
import { TERRAIN_TYPES, type TerrainType } from '@/data/terrain';
import { TILE_HEIGHT, TILE_WIDTH } from '@/shared/math/isometric';
import { BUILDING_IDS, type BuildingId } from '@/data/buildings';
import { SEASONS, type Season } from '@/simulation/seasons/SeasonClock';
import { drawGroundTile, TERRAIN_VARIANTS } from './groundArt';
import { contactShadow, shade } from './shading';
import { PERSON_COLOURS, VILLAGER_LOOKS, type VillagerLook } from '@/shared/appearance';
import { drawTree, TREE_HEIGHT, TREE_SHAPES, TREE_WIDTH } from './treeArt';
import { BUILDING_COLOURS, buildingTextureSpec, drawBuilding } from './buildingArt';

/** Texture and frame keys, so call sites never pass raw strings around. */
export const TextureKeys = {
  terrainAtlas: 'terrain-atlas',
  treeAtlas: 'tree-atlas',
  selection: 'selection-diamond',
  villagerAtlas: 'villager-atlas',
  villagerRing: 'villager-ring',
  designation: 'designation-mark',
  logPile: 'pile-logs',
  stonePile: 'pile-stone',
  storageYard: 'storage-yard',
  building: (id: string): string => `building-${id}`,
  site: 'construction-site',
  ghostCell: 'ghost-cell',
  road: 'road-tile',
  /** Frame name within the terrain atlas. */
  terrainFrame: (type: TerrainType, season: Season, variant = 0): string =>
    `${type}-${season}-${variant % TERRAIN_VARIANTS}`,
  /** Frame name within the tree atlas. */
  treeFrame: (variant: number, season: Season): string => `tree-${variant % TREE_SHAPES}-${season}`,
  /** Frame name within the villager atlas: one figure in one person's colour. */
  villagerFrame: (look: VillagerLook, colourIndex: number): string =>
    `villager-${look}-${colourIndex % PERSON_COLOURS.length}`,
} as const;

/**
 * Villager sprite height, per the art bible.
 *
 * Deliberately small against a 96px tree: the settlement is the subject, and
 * people are what make it live. Characters must never dominate the frame.
 */
export const VILLAGER_HEIGHT = 48;

/**
 * Where the ground line sits inside a building texture, as a fraction of its
 * height.
 *
 * Exported so the renderer anchors on the drawn base rather than the bottom of
 * the image. Guessing at this offset drew buildings a whole tile away from the
 * footprint they actually occupy.
 */
/**
 * Where a building's anchor sits within its texture.
 *
 * Derived per building rather than shared, because each texture is sized from
 * its own footprint. The renderer must use the same figure the texture was
 * drawn with; taking both from `buildingArt` is what keeps them in step.
 */
export function buildingGroundLine(id: BuildingId): number {
  return buildingTextureSpec(id).groundLine;
}
export const SITE_TEXTURE_HEIGHT = 96;
export const SITE_GROUND_LINE = 86 / SITE_TEXTURE_HEIGHT;

/** Resource pile sprite height, per the art bible. */
export const PILE_HEIGHT = 40;
/** Storage yard placeholder: a 3x3 footprint, low and open. */
export const STORAGE_WIDTH = 192;
export const STORAGE_HEIGHT = 96;
const VILLAGER_WIDTH = 32;

/** Cloth and skin tones, kept muted and earthy like everything else. */
const VILLAGER_SKIN = 0xa88a6d;
/** A child's hair, and an elder's staff: the two things not made of cloth. */
const VILLAGER_HAIR = 0x5a4a38;
const VILLAGER_STAFF = 0x6b5a42;

/**
 * Builds every placeholder texture once, at scene start.
 *
 * Drawing into textures rather than issuing Graphics calls per object is what
 * lets thousands of tiles share a handful of GPU batches.
 */
export function createPlaceholderTextures(scene: Phaser.Scene): void {
  const graphics = scene.add.graphics();

  buildTerrainAtlas(scene, graphics);
  buildTreeAtlas(scene, graphics);

  if (!scene.textures.exists(TextureKeys.selection)) {
    drawSelectionDiamond(graphics);
    graphics.generateTexture(TextureKeys.selection, TILE_WIDTH, TILE_HEIGHT);
    graphics.clear();
  }

  buildVillagerAtlas(scene, graphics);

  if (!scene.textures.exists(TextureKeys.villagerRing)) {
    drawVillagerRing(graphics);
    graphics.generateTexture(TextureKeys.villagerRing, TILE_WIDTH, TILE_HEIGHT);
    graphics.clear();
  }

  if (!scene.textures.exists(TextureKeys.designation)) {
    drawDesignationMark(graphics);
    graphics.generateTexture(TextureKeys.designation, TILE_WIDTH, TILE_HEIGHT);
    graphics.clear();
  }

  if (!scene.textures.exists(TextureKeys.logPile)) {
    drawLogPile(graphics);
    graphics.generateTexture(TextureKeys.logPile, TILE_WIDTH, PILE_HEIGHT);
    graphics.clear();
  }

  if (!scene.textures.exists(TextureKeys.stonePile)) {
    drawStonePile(graphics);
    graphics.generateTexture(TextureKeys.stonePile, TILE_WIDTH, PILE_HEIGHT);
    graphics.clear();
  }

  if (!scene.textures.exists(TextureKeys.storageYard)) {
    drawStorageYard(graphics);
    graphics.generateTexture(TextureKeys.storageYard, STORAGE_WIDTH, STORAGE_HEIGHT);
    graphics.clear();
  }

  if (!scene.textures.exists(TextureKeys.site)) {
    drawConstructionSite(graphics);
    graphics.generateTexture(TextureKeys.site, 128, 96);
    graphics.clear();
  }

  if (!scene.textures.exists(TextureKeys.road)) {
    drawRoad(graphics);
    graphics.generateTexture(TextureKeys.road, TILE_WIDTH, TILE_HEIGHT);
    graphics.clear();
  }

  if (!scene.textures.exists(TextureKeys.ghostCell)) {
    drawGhostCell(graphics);
    graphics.generateTexture(TextureKeys.ghostCell, TILE_WIDTH, TILE_HEIGHT);
    graphics.clear();
  }

  // Each building is sized from its own footprint, so a 3x3 yard is drawn 3x3
  // rather than sharing the House's texture and standing beside its own plot.
  for (const id of BUILDING_IDS) {
    const key = TextureKeys.building(id);
    if (scene.textures.exists(key)) {
      continue;
    }
    const spec = buildingTextureSpec(id);
    drawBuilding(graphics, id, BUILDING_COLOURS[id]);
    graphics.generateTexture(key, spec.width, spec.height);
    graphics.clear();
  }

  graphics.destroy();
}

/**
 * Packs every ground tile into one image, then names each slice a frame.
 *
 * The grid is **type × variant across, season down**. Four variants per type is
 * what stops nine thousand tiles being the same tile; keeping them in the same
 * atlas is what stops that costing anything, because the depth-sorted display
 * list still shares a single GPU batch however the variants interleave.
 */
function buildTerrainAtlas(scene: Phaser.Scene, graphics: Phaser.GameObjects.Graphics): void {
  if (scene.textures.exists(TextureKeys.terrainAtlas)) {
    return;
  }

  const columns = TERRAIN_TYPES.length * TERRAIN_VARIANTS;

  TERRAIN_TYPES.forEach((type, typeIndex) => {
    for (let variant = 0; variant < TERRAIN_VARIANTS; variant += 1) {
      const column = typeIndex * TERRAIN_VARIANTS + variant;
      SEASONS.forEach((season, row) => {
        graphics.translateCanvas(column * TILE_WIDTH, row * TILE_HEIGHT);
        drawGroundTile(graphics, type, season, variant);
        graphics.translateCanvas(-column * TILE_WIDTH, -row * TILE_HEIGHT);
      });
    }
  });

  graphics.generateTexture(
    TextureKeys.terrainAtlas,
    columns * TILE_WIDTH,
    SEASONS.length * TILE_HEIGHT,
  );
  graphics.clear();

  const texture = scene.textures.get(TextureKeys.terrainAtlas);
  TERRAIN_TYPES.forEach((type, typeIndex) => {
    for (let variant = 0; variant < TERRAIN_VARIANTS; variant += 1) {
      const column = typeIndex * TERRAIN_VARIANTS + variant;
      SEASONS.forEach((season, row) => {
        texture.add(
          TextureKeys.terrainFrame(type, season, variant),
          0,
          column * TILE_WIDTH,
          row * TILE_HEIGHT,
          TILE_WIDTH,
          TILE_HEIGHT,
        );
      });
    }
  });
}

/** Same idea for trees, so a mixed wood is one batch rather than one per shape. */
function buildTreeAtlas(scene: Phaser.Scene, graphics: Phaser.GameObjects.Graphics): void {
  if (scene.textures.exists(TextureKeys.treeAtlas)) {
    return;
  }

  for (let variant = 0; variant < TREE_SHAPES; variant += 1) {
    SEASONS.forEach((season, row) => {
      graphics.translateCanvas(variant * TREE_WIDTH, row * TREE_HEIGHT);
      drawTree(graphics, variant, season);
      graphics.translateCanvas(-variant * TREE_WIDTH, -row * TREE_HEIGHT);
    });
  }
  graphics.generateTexture(
    TextureKeys.treeAtlas,
    TREE_SHAPES * TREE_WIDTH,
    SEASONS.length * TREE_HEIGHT,
  );
  graphics.clear();

  const texture = scene.textures.get(TextureKeys.treeAtlas);
  for (let variant = 0; variant < TREE_SHAPES; variant += 1) {
    SEASONS.forEach((season, row) => {
      texture.add(
        TextureKeys.treeFrame(variant, season),
        0,
        variant * TREE_WIDTH,
        row * TREE_HEIGHT,
        TREE_WIDTH,
        TREE_HEIGHT,
      );
    });
  }
}

/** The ring drawn under a tapped tile. */
function drawSelectionDiamond(graphics: Phaser.GameObjects.Graphics): void {
  const halfWidth = TILE_WIDTH / 2;
  const halfHeight = TILE_HEIGHT / 2;

  graphics.lineStyle(2, 0xd8cba8, 0.95);
  graphics.beginPath();
  graphics.moveTo(halfWidth, 1);
  graphics.lineTo(TILE_WIDTH - 1, halfHeight);
  graphics.lineTo(halfWidth, TILE_HEIGHT - 1);
  graphics.lineTo(1, halfHeight);
  graphics.closePath();
  graphics.strokePath();
}

/**
 * A villager: a faceted figure, no face, and never a cone.
 *
 * Anchored at the feet by the renderer. Four readability constraints drive every
 * one of these shapes, all learned from looking at them in the world: the
 * silhouette must be clearly humanoid at small size; it must not resemble a
 * conifer, since trees share the scene and a pointed hood reads as a sapling; it
 * must have a lit and a shaded side like everything else, or a person standing
 * beside a faceted building looks like a sticker on it; and **the four kinds must
 * differ in outline**, not in detail, because at this size detail is a smudge.
 *
 * Deliberately not chibi — the art direction rules out cartoon proportions — and
 * deliberately small against a 96px tree. The settlement is the subject.
 *
 * @param look which figure. See `shared/appearance.ts` for who gets which.
 * @param cloth the person's own colour, worn as the tunic. Their outer garment
 *   is the same colour darkened, so a villager reads as one person dressed
 *   rather than two halves painted.
 */
function drawVillager(
  graphics: Phaser.GameObjects.Graphics,
  look: VillagerLook,
  cloth: number,
): void {
  const cx = VILLAGER_WIDTH / 2;
  const feet = VILLAGER_HEIGHT;
  const cloak = shade(cloth, 0.62);

  // Cast the way everything else casts: down and to the right, with a
  // penumbra. A villager is small, so the rhombus is small — but a scene where
  // only the buildings have soft shadows looks worse than one where nothing
  // does. See `shading.ts`.
  contactShadow(graphics, { x: cx, y: feet - 2 }, look === 'child' ? 7 : 9, 3.5);

  if (look === 'child') {
    drawChild(graphics, cx, feet, cloth, cloak);
    return;
  }
  if (look === 'woman') {
    drawWoman(graphics, cx, feet, cloth, cloak);
    return;
  }
  drawGrownFigure(graphics, cx, feet, cloth, cloak, look === 'elder');
}

/**
 * A grown man, and — stooped, shorter and leaning on a staff — an elder.
 *
 * One function for both because they are the same figure at two ages, and
 * writing them apart would let them drift into two unrelated people.
 */
function drawGrownFigure(
  graphics: Phaser.GameObjects.Graphics,
  cx: number,
  feet: number,
  cloth: number,
  cloak: number,
  old: boolean,
): void {
  // An elder stands shorter and leans forward. Both are posture rather than
  // detail, which is the only thing that survives at this size.
  const drop = old ? 4 : 0;
  const lean = old ? 1.6 : 0;

  // Boots, darker than the leggings above them.
  graphics.fillStyle(shade(cloak, 0.7), 1);
  graphics.fillRect(cx - 6.5, feet - 6, 5, 5);
  graphics.fillRect(cx + 1.5, feet - 6, 5, 5);

  // Legs, set apart so the gap reads at a glance. Lit on the left.
  graphics.fillStyle(shade(cloak, 1.1), 1);
  graphics.fillRect(cx - 6, feet - 17, 4, 12);
  graphics.fillStyle(shade(cloak, 0.86), 1);
  graphics.fillRect(cx + 2, feet - 17, 4, 12);

  // Body: shoulders wider than the head, tapering to the waist. The shoulder
  // line is what makes the shape read as a person rather than a cone. Split
  // down the middle so the torso has two planes.
  graphics.fillStyle(shade(cloth, 1.14), 1);
  polygonAt(graphics, [
    [cx - 9 + lean, feet - 33 + drop],
    [cx + lean, feet - 33 + drop],
    [cx, feet - 15],
    [cx - 7, feet - 15],
  ]);
  graphics.fillStyle(shade(cloth, 0.86), 1);
  polygonAt(graphics, [
    [cx + lean, feet - 33 + drop],
    [cx + 9 + lean, feet - 33 + drop],
    [cx + 7, feet - 15],
    [cx, feet - 15],
  ]);

  // A belt, which is most of what stops the torso reading as a sack.
  graphics.fillStyle(shade(cloak, 0.72), 1);
  graphics.fillRect(cx - 7.5, feet - 20, 15, 2.5);

  // Arms, hanging close to the body.
  graphics.fillStyle(shade(cloak, 1.06), 1);
  graphics.fillRect(cx - 11 + lean, feet - 32 + drop, 3, 13);
  graphics.fillStyle(shade(cloak, 0.82), 1);
  graphics.fillRect(cx + 8 + lean, feet - 32 + drop, 3, 13);

  // A staff: the one prop, and the fastest way to read "old" in a silhouette.
  if (old) {
    graphics.fillStyle(shade(VILLAGER_STAFF, 0.9), 1);
    graphics.fillRect(cx + 11, feet - 34, 2, 33);
  }

  // Rounded hood behind the head — never a point.
  graphics.fillStyle(shade(cloak, 1.04), 1);
  graphics.fillCircle(cx + lean, feet - 38 + drop, 6.5);
  graphics.fillRect(cx - 6.5 + lean, feet - 38 + drop, 13, 6);
  // The hood's shaded right side.
  graphics.fillStyle(shade(cloak, 0.82), 1);
  polygonAt(graphics, [
    [cx + 1 + lean, feet - 44.5 + drop],
    [cx + 6.5 + lean, feet - 38 + drop],
    [cx + 6.5 + lean, feet - 32 + drop],
    [cx + 1 + lean, feet - 32 + drop],
  ]);

  // Face opening, in shadow inside the hood.
  graphics.fillStyle(shade(VILLAGER_SKIN, old ? 0.78 : 0.86), 1);
  graphics.fillCircle(cx - 0.5 + lean, feet - 37.5 + drop, 3.6);
}

/**
 * A woman: narrower at the shoulder, and a skirt to the ankle.
 *
 * The skirt is the whole difference and it is deliberately the *outline* — a
 * figure that widens towards the ground rather than splitting into two legs.
 * Anything smaller than that (a different colour, a longer hood) is invisible
 * three tiles away, which is where the player usually is.
 */
function drawWoman(
  graphics: Phaser.GameObjects.Graphics,
  cx: number,
  feet: number,
  cloth: number,
  cloak: number,
): void {
  graphics.fillStyle(shade(cloak, 0.7), 1);
  graphics.fillRect(cx - 4, feet - 4, 3.5, 3.5);
  graphics.fillRect(cx + 0.5, feet - 4, 3.5, 3.5);

  // The skirt, in two planes like everything else.
  graphics.fillStyle(shade(cloak, 1.08), 1);
  polygonAt(graphics, [
    [cx - 6, feet - 21],
    [cx, feet - 21],
    [cx, feet - 3],
    [cx - 8.5, feet - 3],
  ]);
  graphics.fillStyle(shade(cloak, 0.84), 1);
  polygonAt(graphics, [
    [cx, feet - 21],
    [cx + 6, feet - 21],
    [cx + 8.5, feet - 3],
    [cx, feet - 3],
  ]);

  // Bodice: narrower shoulders than a man's, and a waist.
  graphics.fillStyle(shade(cloth, 1.14), 1);
  polygonAt(graphics, [
    [cx - 7, feet - 32],
    [cx, feet - 32],
    [cx, feet - 20],
    [cx - 5, feet - 20],
  ]);
  graphics.fillStyle(shade(cloth, 0.86), 1);
  polygonAt(graphics, [
    [cx, feet - 32],
    [cx + 7, feet - 32],
    [cx + 5, feet - 20],
    [cx, feet - 20],
  ]);

  graphics.fillStyle(shade(cloak, 0.72), 1);
  graphics.fillRect(cx - 5.5, feet - 22, 11, 2.5);

  graphics.fillStyle(shade(cloak, 1.06), 1);
  graphics.fillRect(cx - 9, feet - 31, 2.5, 12);
  graphics.fillStyle(shade(cloak, 0.82), 1);
  graphics.fillRect(cx + 6.5, feet - 31, 2.5, 12);

  // A kerchief rather than a hood: it sits closer to the head and falls behind
  // the shoulder, so the head reads smaller than a hooded one at a glance.
  graphics.fillStyle(shade(cloak, 1.04), 1);
  graphics.fillCircle(cx, feet - 37, 5.8);
  polygonAt(graphics, [
    [cx - 5.8, feet - 37],
    [cx + 5.8, feet - 37],
    [cx + 4, feet - 29],
    [cx - 4, feet - 29],
  ]);
  graphics.fillStyle(shade(cloak, 0.82), 1);
  polygonAt(graphics, [
    [cx + 0.5, feet - 42.8],
    [cx + 5.8, feet - 37],
    [cx + 4, feet - 29],
    [cx + 0.5, feet - 29],
  ]);

  graphics.fillStyle(shade(VILLAGER_SKIN, 0.9), 1);
  graphics.fillCircle(cx - 0.5, feet - 36.5, 3.2);
}

/**
 * A child: shorter, with a head too big for the body.
 *
 * Two thirds the height of an adult and bare-headed. The proportion is the
 * point — a child drawn as a small adult reads as an adult standing further
 * away, which on an isometric map is exactly the wrong thing to say.
 */
function drawChild(
  graphics: Phaser.GameObjects.Graphics,
  cx: number,
  feet: number,
  cloth: number,
  cloak: number,
): void {
  graphics.fillStyle(shade(cloak, 0.7), 1);
  graphics.fillRect(cx - 4.5, feet - 4, 3.5, 3.5);
  graphics.fillRect(cx + 1, feet - 4, 3.5, 3.5);

  graphics.fillStyle(shade(cloak, 1.1), 1);
  graphics.fillRect(cx - 4, feet - 12, 3, 8);
  graphics.fillStyle(shade(cloak, 0.86), 1);
  graphics.fillRect(cx + 1, feet - 12, 3, 8);

  // A short tunic, straight from the shoulder — no belt at this size.
  graphics.fillStyle(shade(cloth, 1.14), 1);
  polygonAt(graphics, [
    [cx - 6, feet - 23],
    [cx, feet - 23],
    [cx, feet - 11],
    [cx - 5, feet - 11],
  ]);
  graphics.fillStyle(shade(cloth, 0.86), 1);
  polygonAt(graphics, [
    [cx, feet - 23],
    [cx + 6, feet - 23],
    [cx + 5, feet - 11],
    [cx, feet - 11],
  ]);

  graphics.fillStyle(shade(cloak, 1.06), 1);
  graphics.fillRect(cx - 7.5, feet - 22, 2, 9);
  graphics.fillStyle(shade(cloak, 0.82), 1);
  graphics.fillRect(cx + 5.5, feet - 22, 2, 9);

  // Bare head, and a big one: half again the head of an adult on a body two
  // thirds the height.
  graphics.fillStyle(shade(VILLAGER_HAIR, 1.02), 1);
  graphics.fillCircle(cx, feet - 28, 5.4);
  graphics.fillStyle(shade(VILLAGER_HAIR, 0.8), 1);
  polygonAt(graphics, [
    [cx + 0.5, feet - 33.4],
    [cx + 5.4, feet - 28],
    [cx + 3, feet - 23.4],
    [cx + 0.5, feet - 23.4],
  ]);
  graphics.fillStyle(VILLAGER_SKIN, 1);
  graphics.fillCircle(cx - 0.5, feet - 27.5, 3.4);
}

/**
 * Every figure in every colour, in one texture.
 *
 * Twenty-four small frames drawn once at load, rather than one sprite tinted at
 * draw time: the season tint already owns `setTint`, and a second tint on top of
 * it would wash the whole settlement the same shade of whatever it was standing
 * in. One batch for every villager on screen, however many kinds are walking
 * about.
 */
function buildVillagerAtlas(scene: Phaser.Scene, graphics: Phaser.GameObjects.Graphics): void {
  if (scene.textures.exists(TextureKeys.villagerAtlas)) {
    return;
  }

  VILLAGER_LOOKS.forEach((look, row) => {
    PERSON_COLOURS.forEach((colour, column) => {
      graphics.translateCanvas(column * VILLAGER_WIDTH, row * VILLAGER_HEIGHT);
      drawVillager(graphics, look, colour);
      graphics.translateCanvas(-column * VILLAGER_WIDTH, -row * VILLAGER_HEIGHT);
    });
  });
  graphics.generateTexture(
    TextureKeys.villagerAtlas,
    PERSON_COLOURS.length * VILLAGER_WIDTH,
    VILLAGER_LOOKS.length * VILLAGER_HEIGHT,
  );
  graphics.clear();

  const texture = scene.textures.get(TextureKeys.villagerAtlas);
  VILLAGER_LOOKS.forEach((look, row) => {
    PERSON_COLOURS.forEach((_colour, column) => {
      texture.add(
        TextureKeys.villagerFrame(look, column),
        0,
        column * VILLAGER_WIDTH,
        row * VILLAGER_HEIGHT,
        VILLAGER_WIDTH,
        VILLAGER_HEIGHT,
      );
    });
  });
}

/** Fills a polygon from pixel points. */
function polygonAt(
  graphics: Phaser.GameObjects.Graphics,
  points: readonly (readonly [number, number])[],
): void {
  const [first, ...rest] = points;
  if (!first) {
    return;
  }
  graphics.beginPath();
  graphics.moveTo(first[0], first[1]);
  for (const point of rest) {
    graphics.lineTo(point[0], point[1]);
  }
  graphics.closePath();
  graphics.fillPath();
}

/** The ring drawn under a selected villager. */
function drawVillagerRing(graphics: Phaser.GameObjects.Graphics): void {
  graphics.lineStyle(2, 0xc9a227, 0.9);
  graphics.strokeEllipse(TILE_WIDTH / 2, TILE_HEIGHT / 2, 26, 13);
}

/**
 * The mark painted on a tree ordered to be felled.
 *
 * A cut notch rather than a modern icon: the mood is medieval, and a floating
 * axe glyph would read as mobile-game chrome. Warm ochre so it stands out
 * against the greens without breaking the muted palette.
 */
function drawDesignationMark(graphics: Phaser.GameObjects.Graphics): void {
  const cx = TILE_WIDTH / 2;
  const cy = TILE_HEIGHT / 2;

  // A dark backing stroke first, so the mark stays legible against both the
  // pale grass and the dark canopy it may sit on.
  graphics.lineStyle(6, 0x1a1c14, 0.55);
  strokeCross(graphics, cx, cy);
  graphics.lineStyle(3.5, 0xd8a92c, 1);
  strokeCross(graphics, cx, cy);
}

function strokeCross(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
  graphics.beginPath();
  graphics.moveTo(cx - 11, cy - 11);
  graphics.lineTo(cx + 11, cy + 11);
  graphics.moveTo(cx + 11, cy - 11);
  graphics.lineTo(cx - 11, cy + 11);
  graphics.strokePath();
}

/** A stack of cut logs, seen end-on, with sawn faces catching the light. */
function drawLogPile(graphics: Phaser.GameObjects.Graphics): void {
  const cx = TILE_WIDTH / 2;
  const base = PILE_HEIGHT;

  graphics.fillStyle(0x000000, 0.24);
  graphics.fillEllipse(cx, base - 3, 34, 12);

  const bark = 0x4a3b2a;
  const cut = 0x8a7150;
  const rows = [
    { y: base - 9, xs: [-12, -4, 4, 12] },
    { y: base - 17, xs: [-8, 0, 8] },
    { y: base - 25, xs: [-4, 4] },
  ];
  for (const row of rows) {
    for (const x of row.xs) {
      // Bark ring, lit above and shaded below.
      graphics.fillStyle(shade(bark, 1.08), 1);
      graphics.fillEllipse(cx + x, row.y, 9.5, 8.5);
      graphics.fillStyle(shade(bark, 0.78), 1);
      graphics.fillEllipse(cx + x, row.y + 1.2, 9.5, 6);
      // The sawn face, which is the pale thing the eye actually picks out.
      graphics.fillStyle(cut, 1);
      graphics.fillEllipse(cx + x, row.y, 5, 4.5);
      graphics.fillStyle(shade(cut, 0.82), 1);
      graphics.fillEllipse(cx + x, row.y + 1, 5, 2.6);
      // Two growth rings. Small, but they read as wood rather than as beads.
      graphics.fillStyle(shade(cut, 1.16), 1);
      graphics.fillEllipse(cx + x, row.y - 0.4, 2, 1.8);
    }
  }
}

/** A heap of quarried stone: blocks with a top, a lit face and a shaded one. */
function drawStonePile(graphics: Phaser.GameObjects.Graphics): void {
  const cx = TILE_WIDTH / 2;
  const base = PILE_HEIGHT;

  graphics.fillStyle(0x000000, 0.24);
  graphics.fillEllipse(cx, base - 3, 32, 12);

  const blocks = [
    { x: -11, y: base - 7, w: 13, h: 9, c: 0x5a5750 },
    { x: 2, y: base - 7, w: 14, h: 10, c: 0x646159 },
    { x: -5, y: base - 16, w: 12, h: 9, c: 0x6d6a61 },
    { x: 5, y: base - 19, w: 10, h: 7, c: 0x5f5c55 },
  ];
  for (const b of blocks) {
    const top = b.y - b.h;
    // Top face, brightest: the light comes from above and to the left.
    graphics.fillStyle(shade(b.c, 1.3), 1);
    polygonAt(graphics, [
      [cx + b.x, top],
      [cx + b.x + b.w * 0.5, top - 3.5],
      [cx + b.x + b.w, top],
      [cx + b.x + b.w * 0.5, top + 3.5],
    ]);
    // Left face.
    graphics.fillStyle(shade(b.c, 1.02), 1);
    polygonAt(graphics, [
      [cx + b.x, top],
      [cx + b.x + b.w * 0.5, top + 3.5],
      [cx + b.x + b.w * 0.5, b.y + 3.5],
      [cx + b.x, b.y],
    ]);
    // Right face, away from the key light.
    graphics.fillStyle(shade(b.c, 0.74), 1);
    polygonAt(graphics, [
      [cx + b.x + b.w, top],
      [cx + b.x + b.w * 0.5, top + 3.5],
      [cx + b.x + b.w * 0.5, b.y + 3.5],
      [cx + b.x + b.w, b.y],
    ]);
  }
}

/**
 * The founding storage yard: a low fenced platform stacked with goods.
 *
 * Open rather than enclosed, so it reads as a stockpile rather than a building.
 * It is the first thing a new player sees and the thing they will look at most,
 * so it earns more detail than anything else at this size: a planked floor, a
 * rail between the posts, and goods with real faces on them.
 */
function drawStorageYard(graphics: Phaser.GameObjects.Graphics): void {
  const cx = STORAGE_WIDTH / 2;
  const baseY = STORAGE_HEIGHT - 8;
  const halfW = 88;
  const halfH = 44;

  // The isometric footprint: a 3x3 diamond of trodden earth, split into two
  // facets like the ground it stands on.
  graphics.fillStyle(0x473d2f, 1);
  polygonAt(graphics, [
    [cx, baseY - halfH],
    [cx + halfW, baseY],
    [cx, baseY + halfH],
  ]);
  graphics.fillStyle(0x3f3628, 1);
  polygonAt(graphics, [
    [cx, baseY - halfH],
    [cx - halfW, baseY],
    [cx, baseY + halfH],
  ]);

  // Planking, running along one axis. Faint, so it suggests a floor without
  // turning into a grid the eye has to read.
  graphics.lineStyle(1, 0x3a3126, 0.45);
  for (let t = -0.7; t <= 0.7; t += 0.35) {
    graphics.beginPath();
    graphics.moveTo(cx + halfW * t, baseY - halfH * (1 - Math.abs(t)));
    graphics.lineTo(cx + halfW * t, baseY + halfH * (1 - Math.abs(t)));
    graphics.strokePath();
  }

  const corners: readonly (readonly [number, number])[] = [
    [cx, baseY - halfH],
    [cx + halfW, baseY],
    [cx, baseY + halfH],
    [cx - halfW, baseY],
  ];

  // A rail between the posts, along the two back edges only — a fence across
  // the front would hide the goods the yard exists to show.
  graphics.lineStyle(2.5, 0x5a4a36, 0.9);
  graphics.beginPath();
  graphics.moveTo(cx - halfW, baseY - 9);
  graphics.lineTo(cx, baseY - halfH - 9);
  graphics.lineTo(cx + halfW, baseY - 9);
  graphics.strokePath();

  // Corner posts, each with a lit and a shaded side.
  for (const [px, py] of corners) {
    graphics.fillStyle(0x5a4b39, 1);
    graphics.fillRect(px - 2.5, py - 16, 2.5, 16);
    graphics.fillStyle(0x453927, 1);
    graphics.fillRect(px, py - 16, 2.5, 16);
  }

  // Crates and sacks, drawn as boxes rather than rectangles.
  crate(graphics, cx - 46, baseY - 6, 28, 22, 0x6b573c);
  crate(graphics, cx - 14, baseY - 4, 32, 28, 0x74603f);
  crate(graphics, cx + 22, baseY - 2, 26, 19, 0x7a6748);
  // A sack leaning on the stack, so the yard is not all right angles.
  graphics.fillStyle(0x8a7a5a, 1);
  polygonAt(graphics, [
    [cx + 4, baseY - 4],
    [cx + 12, baseY - 24],
    [cx + 20, baseY - 4],
  ]);
  graphics.fillStyle(0x6f6248, 1);
  polygonAt(graphics, [
    [cx + 12, baseY - 24],
    [cx + 20, baseY - 4],
    [cx + 15, baseY - 4],
  ]);
}

/** A box standing on the ground: top, lit face, shaded face. */
function crate(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  groundY: number,
  width: number,
  height: number,
  colour: number,
): void {
  const top = groundY - height;
  const depth = width * 0.28;

  graphics.fillStyle(shade(colour, 1.26), 1);
  polygonAt(graphics, [
    [x, top],
    [x + width * 0.5, top - depth * 0.5],
    [x + width, top],
    [x + width * 0.5, top + depth * 0.5],
  ]);
  graphics.fillStyle(shade(colour, 1.02), 1);
  polygonAt(graphics, [
    [x, top],
    [x + width * 0.5, top + depth * 0.5],
    [x + width * 0.5, groundY + depth * 0.5],
    [x, groundY],
  ]);
  graphics.fillStyle(shade(colour, 0.76), 1);
  polygonAt(graphics, [
    [x + width, top],
    [x + width * 0.5, top + depth * 0.5],
    [x + width * 0.5, groundY + depth * 0.5],
    [x + width, groundY],
  ]);
}

/**
 * A half-built frame: posts, a partial floor, and the materials to finish it.
 *
 * The sawhorse and the stacked timber are the point. A construction site with
 * nothing lying around it reads as a ruin; a site with work in progress reads
 * as something somebody is coming back to.
 */
function drawConstructionSite(graphics: Phaser.GameObjects.Graphics): void {
  const cx = 64;
  const base = 86;

  // The plot, in two facets.
  graphics.fillStyle(0x4f4434, 0.9);
  polygonAt(graphics, [
    [cx, base - 24],
    [cx + 48, base],
    [cx, base + 24],
  ]);
  graphics.fillStyle(0x443a2c, 0.9);
  polygonAt(graphics, [
    [cx, base - 24],
    [cx - 48, base],
    [cx, base + 24],
  ]);

  // Corner posts, lit and shaded.
  for (const [px, py] of [
    [cx, base - 24],
    [cx + 48, base],
    [cx, base + 24],
    [cx - 48, base],
  ] as const) {
    graphics.fillStyle(0x86714f, 1);
    graphics.fillRect(px - 3, py - 30, 3, 30);
    graphics.fillStyle(0x6a5940, 1);
    graphics.fillRect(px, py - 30, 3, 30);
  }

  // Cross-beams, so it reads as a frame rather than four posts.
  graphics.lineStyle(4, 0x7a6647, 1);
  graphics.beginPath();
  graphics.moveTo(cx - 48, base - 26);
  graphics.lineTo(cx, base - 50);
  graphics.lineTo(cx + 48, base - 26);
  graphics.strokePath();

  // A tie-beam across the middle, at wall height.
  graphics.lineStyle(3, 0x6d5b3f, 1);
  graphics.beginPath();
  graphics.moveTo(cx - 46, base - 12);
  graphics.lineTo(cx + 46, base - 12);
  graphics.strokePath();

  // Timber stacked on the plot, waiting to be used.
  graphics.fillStyle(0x7d6845, 1);
  graphics.fillRect(cx - 26, base + 2, 30, 3.5);
  graphics.fillStyle(0x6a5738, 1);
  graphics.fillRect(cx - 24, base + 6, 30, 3.5);

  // A sawhorse, which is the single clearest sign of work rather than ruin.
  graphics.lineStyle(2, 0x6a5738, 1);
  graphics.beginPath();
  graphics.moveTo(cx + 14, base + 12);
  graphics.lineTo(cx + 20, base + 2);
  graphics.lineTo(cx + 26, base + 12);
  graphics.moveTo(cx + 13, base + 3);
  graphics.lineTo(cx + 28, base + 3);
  graphics.strokePath();
}

/**
 * A stretch of beaten track, painted onto the ground.
 *
 * Deliberately smaller than the tile it sits on and slightly ragged at the
 * edges: a road here is trodden earth rather than a paved surface, and a
 * diamond filling the cell exactly would read as a floor tile and make the grid
 * — which the brief wants hidden — the most obvious thing on screen. Adjacent
 * road cells still overlap enough to read as one continuous line.
 */
function drawRoad(graphics: Phaser.GameObjects.Graphics): void {
  const cx = TILE_WIDTH / 2;
  const cy = TILE_HEIGHT / 2;
  const halfWidth = TILE_WIDTH / 2 - 1;
  const halfHeight = TILE_HEIGHT / 2 - 1;

  // Three passes: a damp margin, the trodden bed, and a lit crown down the
  // middle where the traffic has worn it smooth.
  const passes = [
    { inset: 0.98, colour: 0x4a4034, alpha: 0.75 },
    { inset: 0.72, colour: 0x6a5a45, alpha: 0.9 },
  ];
  for (const pass of passes) {
    graphics.fillStyle(pass.colour, pass.alpha);
    polygonAt(graphics, [
      [cx, cy - halfHeight * pass.inset],
      [cx + halfWidth * pass.inset, cy],
      [cx, cy + halfHeight * pass.inset],
      [cx - halfWidth * pass.inset, cy],
    ]);
  }

  graphics.fillStyle(0x7b6a51, 0.75);
  polygonAt(graphics, [
    [cx, cy - halfHeight * 0.44],
    [cx + halfWidth * 0.44, cy],
    [cx, cy + halfHeight * 0.2],
    [cx - halfWidth * 0.44, cy],
  ]);

  // A fixed scatter of grit, so a long road is not a flat band of one colour.
  // Fixed rather than random: every road cell shares this one texture, and a
  // per-draw scatter would only ever be generated once anyway.
  graphics.fillStyle(0x877357, 0.7);
  for (const [gx, gy] of [
    [-10, -2],
    [-2, 3],
    [6, -3],
    [11, 2],
    [1, -5],
    [-6, 5],
  ] as const) {
    graphics.fillRect(cx + gx, cy + gy, 2, 1);
  }
}

/** One cell of the placement ghost. Tinted green or red by the renderer. */
function drawGhostCell(graphics: Phaser.GameObjects.Graphics): void {
  const halfWidth = TILE_WIDTH / 2;
  const halfHeight = TILE_HEIGHT / 2;

  graphics.fillStyle(0xffffff, 0.3);
  graphics.beginPath();
  graphics.moveTo(halfWidth, 1);
  graphics.lineTo(TILE_WIDTH - 1, halfHeight);
  graphics.lineTo(halfWidth, TILE_HEIGHT - 1);
  graphics.lineTo(1, halfHeight);
  graphics.closePath();
  graphics.fillPath();
  graphics.lineStyle(2, 0xffffff, 0.9);
  graphics.strokePath();
}
