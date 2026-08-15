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
import type { TerrainType } from '@/data/terrain';
import { TILE_HEIGHT, TILE_WIDTH } from '@/shared/math/isometric';

/** Placeholder colours, keyed by terrain id. Art, so it lives in the renderer. */
interface TerrainPalette {
  readonly fill: number;
  readonly edge: number;
}

const TERRAIN_COLOURS: Readonly<Record<TerrainType, TerrainPalette>> = {
  grass: { fill: 0x4a5b3a, edge: 0x415031 },
  meadow: { fill: 0x56683f, edge: 0x4a5b37 },
  forest: { fill: 0x35452c, edge: 0x2c3a24 },
  water: { fill: 0x2c3f4a, edge: 0x263742 },
  stone: { fill: 0x5a5750, edge: 0x4c4a44 },
};

/** Placeholder building palettes: aged timber, thatch and dark stone. */
interface BuildingPalette {
  readonly wall: number;
  readonly roof: number;
  readonly trim: number;
}

const BUILDING_COLOURS: Readonly<Record<string, BuildingPalette>> = {
  house: { wall: 0x6b5a44, roof: 0x5a4a35, trim: 0x4a3d2c },
  'storage-yard': { wall: 0x6b573c, roof: 0x574733, trim: 0x453824 },
  'food-storage': { wall: 0x6a6048, roof: 0x565039, trim: 0x45402d },
  'gatherer-hut': { wall: 0x5f6248, roof: 0x4c5039, trim: 0x3d402d },
  woodcutter: { wall: 0x67543f, roof: 0x534431, trim: 0x423628 },
};

const TREE_TRUNK = 0x3d3227;
const TREE_CANOPY = [0x2f4029, 0x35472d, 0x293823];

/** Texture and frame keys, so call sites never pass raw strings around. */
export const TextureKeys = {
  terrainAtlas: 'terrain-atlas',
  treeAtlas: 'tree-atlas',
  selection: 'selection-diamond',
  villager: 'villager',
  villagerRing: 'villager-ring',
  designation: 'designation-mark',
  logPile: 'pile-logs',
  stonePile: 'pile-stone',
  storageYard: 'storage-yard',
  building: (id: string): string => `building-${id}`,
  site: 'construction-site',
  ghostCell: 'ghost-cell',
  /** Frame name within the terrain atlas. */
  terrainFrame: (type: TerrainType): string => type,
  /** Frame name within the tree atlas. */
  treeFrame: (variant: number): string => `tree-${variant}`,
} as const;

/** Tree sprite dimensions, per the art bible. */
const TREE_WIDTH = 64;
const TREE_HEIGHT = 96;

/**
 * Villager sprite height, per the art bible.
 *
 * Deliberately small against a 96px tree: the settlement is the subject, and
 * people are what make it live. Characters must never dominate the frame.
 */
export const VILLAGER_HEIGHT = 48;

/** Resource pile sprite height, per the art bible. */
export const PILE_HEIGHT = 40;
/** Storage yard placeholder: a 3x3 footprint, low and open. */
export const STORAGE_WIDTH = 192;
export const STORAGE_HEIGHT = 96;
const VILLAGER_WIDTH = 32;

/** Cloth and skin tones, kept muted and earthy like everything else. */
const VILLAGER_CLOTH = 0x6b5f4b;
const VILLAGER_CLOAK = 0x4f4638;
const VILLAGER_SKIN = 0xa88a6d;

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

  if (!scene.textures.exists(TextureKeys.villager)) {
    drawVillager(graphics);
    graphics.generateTexture(TextureKeys.villager, VILLAGER_WIDTH, VILLAGER_HEIGHT);
    graphics.clear();
  }

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

  if (!scene.textures.exists(TextureKeys.ghostCell)) {
    drawGhostCell(graphics);
    graphics.generateTexture(TextureKeys.ghostCell, TILE_WIDTH, TILE_HEIGHT);
    graphics.clear();
  }

  for (const [id, colours] of Object.entries(BUILDING_COLOURS)) {
    const key = TextureKeys.building(id);
    if (scene.textures.exists(key)) {
      continue;
    }
    drawBuilding(graphics, colours);
    graphics.generateTexture(key, 128, 128);
    graphics.clear();
  }

  graphics.destroy();
}

/** Packs every terrain diamond into one strip, then names each slice a frame. */
function buildTerrainAtlas(scene: Phaser.Scene, graphics: Phaser.GameObjects.Graphics): void {
  if (scene.textures.exists(TextureKeys.terrainAtlas)) {
    return;
  }

  const entries = Object.entries(TERRAIN_COLOURS) as [TerrainType, TerrainPalette][];

  entries.forEach(([, colours], index) => {
    graphics.translateCanvas(index * TILE_WIDTH, 0);
    drawDiamond(graphics, colours.fill, colours.edge);
    graphics.translateCanvas(-index * TILE_WIDTH, 0);
  });
  graphics.generateTexture(TextureKeys.terrainAtlas, entries.length * TILE_WIDTH, TILE_HEIGHT);
  graphics.clear();

  const texture = scene.textures.get(TextureKeys.terrainAtlas);
  entries.forEach(([type], index) => {
    texture.add(TextureKeys.terrainFrame(type), 0, index * TILE_WIDTH, 0, TILE_WIDTH, TILE_HEIGHT);
  });
}

/** Same idea for trees, so a forest is one batch rather than one per variant. */
function buildTreeAtlas(scene: Phaser.Scene, graphics: Phaser.GameObjects.Graphics): void {
  if (scene.textures.exists(TextureKeys.treeAtlas)) {
    return;
  }

  for (let variant = 0; variant < TREE_CANOPY.length; variant += 1) {
    graphics.translateCanvas(variant * TREE_WIDTH, 0);
    drawTree(graphics, variant);
    graphics.translateCanvas(-variant * TREE_WIDTH, 0);
  }
  graphics.generateTexture(TextureKeys.treeAtlas, TREE_CANOPY.length * TREE_WIDTH, TREE_HEIGHT);
  graphics.clear();

  const texture = scene.textures.get(TextureKeys.treeAtlas);
  for (let variant = 0; variant < TREE_CANOPY.length; variant += 1) {
    texture.add(
      TextureKeys.treeFrame(variant),
      0,
      variant * TREE_WIDTH,
      0,
      TREE_WIDTH,
      TREE_HEIGHT,
    );
  }
}

/** A single 2:1 tile diamond, filled and outlined. */
function drawDiamond(graphics: Phaser.GameObjects.Graphics, fill: number, edge: number): void {
  const halfWidth = TILE_WIDTH / 2;
  const halfHeight = TILE_HEIGHT / 2;

  graphics.fillStyle(fill, 1);
  graphics.beginPath();
  graphics.moveTo(halfWidth, 0);
  graphics.lineTo(TILE_WIDTH, halfHeight);
  graphics.lineTo(halfWidth, TILE_HEIGHT);
  graphics.lineTo(0, halfHeight);
  graphics.closePath();
  graphics.fillPath();

  // A hairline edge in a *darker shade of the fill*, never black — the art
  // direction rules out hard outlines. It only exists so tiles stay legible.
  graphics.lineStyle(1, edge, 0.55);
  graphics.strokePath();
}

/**
 * A placeholder conifer.
 *
 * Anchored so the trunk base sits at the bottom centre of the sprite, matching
 * the building and character anchor convention in the art bible.
 */
function drawTree(graphics: Phaser.GameObjects.Graphics, variant: number): void {
  const centreX = TREE_WIDTH / 2;
  const canopy = TREE_CANOPY[variant] ?? TREE_CANOPY[0] ?? 0x2f4029;

  // Trunk.
  graphics.fillStyle(TREE_TRUNK, 1);
  graphics.fillRect(centreX - 3, TREE_HEIGHT - 26, 6, 22);

  // Three stacked tiers, widest at the bottom.
  graphics.fillStyle(canopy, 1);
  const tiers = [
    { y: TREE_HEIGHT - 20, halfWidth: 22, height: 26 },
    { y: TREE_HEIGHT - 38, halfWidth: 18, height: 24 },
    { y: TREE_HEIGHT - 56, halfWidth: 13, height: 22 },
  ];
  for (const tier of tiers) {
    graphics.beginPath();
    graphics.moveTo(centreX, tier.y - tier.height);
    graphics.lineTo(centreX + tier.halfWidth, tier.y);
    graphics.lineTo(centreX - tier.halfWidth, tier.y);
    graphics.closePath();
    graphics.fillPath();
  }

  // Key light from the upper left, per the art bible: a lighter left face.
  graphics.fillStyle(0xffffff, 0.06);
  graphics.beginPath();
  graphics.moveTo(centreX, TREE_HEIGHT - 78);
  graphics.lineTo(centreX, TREE_HEIGHT - 20);
  graphics.lineTo(centreX - 22, TREE_HEIGHT - 20);
  graphics.closePath();
  graphics.fillPath();
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
 * A placeholder villager: a hooded figure, no face, adult proportions.
 *
 * Anchored at the feet by the renderer. Two readability constraints drive the
 * shape, both learned from looking at it in the world: the silhouette must be
 * clearly humanoid at small size, and it must not resemble a conifer, since
 * trees share the scene and a pointed hood reads as a sapling. Hence rounded
 * head and hood, and shoulders wider than the head.
 *
 * Deliberately not a chibi — the art direction rules out cartoon proportions.
 */
function drawVillager(graphics: Phaser.GameObjects.Graphics): void {
  const centreX = VILLAGER_WIDTH / 2;
  const feet = VILLAGER_HEIGHT;

  // Soft contact shadow, so the figure sits on the ground rather than floats.
  graphics.fillStyle(0x000000, 0.22);
  graphics.fillEllipse(centreX, feet - 2, 18, 7);

  // Legs, set apart so the gap reads at a glance.
  graphics.fillStyle(VILLAGER_CLOAK, 1);
  graphics.fillRect(centreX - 6, feet - 17, 4, 15);
  graphics.fillRect(centreX + 2, feet - 17, 4, 15);

  // Body: shoulders wider than the head, tapering to the waist. The shoulder
  // line is what makes the shape read as a person rather than a cone.
  graphics.fillStyle(VILLAGER_CLOTH, 1);
  graphics.beginPath();
  graphics.moveTo(centreX - 9, feet - 33);
  graphics.lineTo(centreX + 9, feet - 33);
  graphics.lineTo(centreX + 7, feet - 15);
  graphics.lineTo(centreX - 7, feet - 15);
  graphics.closePath();
  graphics.fillPath();

  // Arms, hanging close to the body.
  graphics.fillStyle(VILLAGER_CLOAK, 1);
  graphics.fillRect(centreX - 11, feet - 32, 3, 13);
  graphics.fillRect(centreX + 8, feet - 32, 3, 13);

  // Rounded hood behind the head — never a point.
  graphics.fillStyle(VILLAGER_CLOAK, 1);
  graphics.fillCircle(centreX, feet - 38, 6.5);
  graphics.fillRect(centreX - 6.5, feet - 38, 13, 6);

  // Face opening.
  graphics.fillStyle(VILLAGER_SKIN, 1);
  graphics.fillCircle(centreX, feet - 38, 4);

  // Key light from the upper left.
  graphics.fillStyle(0xffffff, 0.07);
  graphics.fillRect(centreX - 9, feet - 33, 5, 18);
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

/** A stack of cut logs, seen end-on. */
function drawLogPile(graphics: Phaser.GameObjects.Graphics): void {
  const cx = TILE_WIDTH / 2;
  const base = PILE_HEIGHT;

  graphics.fillStyle(0x000000, 0.22);
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
      graphics.fillStyle(bark, 1);
      graphics.fillEllipse(cx + x, row.y, 9, 8);
      graphics.fillStyle(cut, 1);
      graphics.fillEllipse(cx + x, row.y, 5, 4.5);
    }
  }
}

/** A heap of quarried stone. */
function drawStonePile(graphics: Phaser.GameObjects.Graphics): void {
  const cx = TILE_WIDTH / 2;
  const base = PILE_HEIGHT;

  graphics.fillStyle(0x000000, 0.22);
  graphics.fillEllipse(cx, base - 3, 32, 12);

  const blocks = [
    { x: -11, y: base - 8, w: 13, h: 10, c: 0x5a5750 },
    { x: 2, y: base - 8, w: 14, h: 11, c: 0x646159 },
    { x: -5, y: base - 17, w: 13, h: 10, c: 0x6d6a61 },
    { x: 5, y: base - 20, w: 10, h: 8, c: 0x5f5c55 },
  ];
  for (const b of blocks) {
    graphics.fillStyle(b.c, 1);
    graphics.fillRect(cx + b.x, b.y - b.h, b.w, b.h);
    // Key light from the upper left.
    graphics.fillStyle(0xffffff, 0.07);
    graphics.fillRect(cx + b.x, b.y - b.h, 4, b.h);
  }
}

/**
 * The founding storage yard: a low fenced platform stacked with goods.
 *
 * Open rather than enclosed, so it reads as a stockpile rather than a building
 * — construction proper arrives in Phase 6.
 */
function drawStorageYard(graphics: Phaser.GameObjects.Graphics): void {
  const cx = STORAGE_WIDTH / 2;
  const baseY = STORAGE_HEIGHT - 8;
  const halfW = 88;
  const halfH = 44;

  // The isometric footprint: a 3x3 diamond of trodden earth.
  graphics.fillStyle(0x4a3f30, 1);
  graphics.beginPath();
  graphics.moveTo(cx, baseY - halfH);
  graphics.lineTo(cx + halfW, baseY);
  graphics.lineTo(cx, baseY + halfH);
  graphics.lineTo(cx - halfW, baseY);
  graphics.closePath();
  graphics.fillPath();
  graphics.lineStyle(2, 0x3a3126, 0.8);
  graphics.strokePath();

  // Corner posts.
  graphics.fillStyle(0x4f4132, 1);
  for (const [px, py] of [
    [cx, baseY - halfH],
    [cx + halfW, baseY],
    [cx, baseY + halfH],
    [cx - halfW, baseY],
  ] as const) {
    graphics.fillRect(px - 2.5, py - 16, 5, 16);
  }

  // A few crates and sacks, so the yard reads as holding something.
  graphics.fillStyle(0x6b573c, 1);
  graphics.fillRect(cx - 34, baseY - 26, 22, 18);
  graphics.fillRect(cx - 8, baseY - 30, 24, 22);
  graphics.fillStyle(0x7a6748, 1);
  graphics.fillRect(cx + 18, baseY - 24, 20, 16);
  graphics.fillStyle(0xffffff, 0.06);
  graphics.fillRect(cx - 34, baseY - 26, 6, 18);
  graphics.fillRect(cx - 8, baseY - 30, 6, 22);
}

/**
 * A placeholder building: walls, a pitched roof, a door.
 *
 * Anchored at the bottom centre of its footprint by the renderer, per the art
 * bible, so the roof is free to overhang upward.
 */
function drawBuilding(graphics: Phaser.GameObjects.Graphics, palette: BuildingPalette): void {
  const cx = 64;
  const base = 118;

  graphics.fillStyle(0x000000, 0.25);
  graphics.fillEllipse(cx, base - 2, 92, 26);

  // Walls: an isometric box.
  graphics.fillStyle(palette.wall, 1);
  graphics.beginPath();
  graphics.moveTo(cx - 44, base - 44);
  graphics.lineTo(cx, base - 66);
  graphics.lineTo(cx + 44, base - 44);
  graphics.lineTo(cx + 44, base - 12);
  graphics.lineTo(cx, base + 10);
  graphics.lineTo(cx - 44, base - 12);
  graphics.closePath();
  graphics.fillPath();

  // Right face in shadow: key light comes from the upper left.
  graphics.fillStyle(0x000000, 0.16);
  graphics.beginPath();
  graphics.moveTo(cx, base - 66 + 22);
  graphics.lineTo(cx + 44, base - 44);
  graphics.lineTo(cx + 44, base - 12);
  graphics.lineTo(cx, base + 10);
  graphics.closePath();
  graphics.fillPath();

  // Pitched roof.
  graphics.fillStyle(palette.roof, 1);
  graphics.beginPath();
  graphics.moveTo(cx - 50, base - 46);
  graphics.lineTo(cx, base - 86);
  graphics.lineTo(cx + 50, base - 46);
  graphics.lineTo(cx, base - 62);
  graphics.closePath();
  graphics.fillPath();

  // Door.
  graphics.fillStyle(palette.trim, 1);
  graphics.fillRect(cx - 8, base - 30, 14, 26);
}

/** A half-built frame: posts and a partial floor. */
function drawConstructionSite(graphics: Phaser.GameObjects.Graphics): void {
  const cx = 64;
  const base = 86;

  graphics.fillStyle(0x4a3f30, 0.85);
  graphics.beginPath();
  graphics.moveTo(cx, base - 24);
  graphics.lineTo(cx + 48, base);
  graphics.lineTo(cx, base + 24);
  graphics.lineTo(cx - 48, base);
  graphics.closePath();
  graphics.fillPath();

  graphics.fillStyle(0x7a6647, 1);
  for (const [px, py] of [
    [cx, base - 24],
    [cx + 48, base],
    [cx, base + 24],
    [cx - 48, base],
  ] as const) {
    graphics.fillRect(px - 3, py - 30, 6, 30);
  }

  // A cross-beam, so it reads as a frame rather than four posts.
  graphics.lineStyle(4, 0x7a6647, 1);
  graphics.beginPath();
  graphics.moveTo(cx - 48, base - 26);
  graphics.lineTo(cx, base - 50);
  graphics.lineTo(cx + 48, base - 26);
  graphics.strokePath();
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
