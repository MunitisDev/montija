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

const TREE_TRUNK = 0x3d3227;
const TREE_CANOPY = [0x2f4029, 0x35472d, 0x293823];

/** Texture and frame keys, so call sites never pass raw strings around. */
export const TextureKeys = {
  terrainAtlas: 'terrain-atlas',
  treeAtlas: 'tree-atlas',
  selection: 'selection-diamond',
  /** Frame name within the terrain atlas. */
  terrainFrame: (type: TerrainType): string => type,
  /** Frame name within the tree atlas. */
  treeFrame: (variant: number): string => `tree-${variant}`,
} as const;

/** Tree sprite dimensions, per the art bible. */
const TREE_WIDTH = 64;
const TREE_HEIGHT = 96;

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
