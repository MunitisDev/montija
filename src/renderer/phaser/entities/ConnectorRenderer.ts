/**
 * Draws the lines the settlement has laid across the map: roads, bridges and
 * ditches.
 *
 * One renderer for all three because they are one problem. Each is a thing that
 * runs from cell to cell, each has to be drawn according to what joins it, and a
 * bridge is quite literally a road laid over water — so the road grid supplies
 * both, and which of the two a cell gets depends only on whether the ground
 * under it is water.
 *
 * Synced off two integers — the road grid's version and the terrain's — so this
 * costs two comparisons a frame until somebody finishes a road, a bridge or a
 * channel. Those happen a handful of times an hour of play; diffing thousands of
 * cells every frame to discover that would be absurd.
 *
 * Everything sits at {@link RenderLayer.Overlay}: painted onto the terrain, under
 * anything with height. A villager walking a road passes over it, and a house
 * built beside one must not have the track drawn across its wall.
 */

import type Phaser from 'phaser';
import { RenderLayer, depthFor, overlayDepth } from '@/renderer/phaser/sorting';
import { connectorMask } from '@/renderer/phaser/terrain/connectors';
import { TextureKeys, type ConnectorKind } from '@/renderer/phaser/terrain/tileTextures';
import { WET_TERRAIN } from '@/data/terrain';
import { gridToScene } from '@/shared/math/isometric';
import type { RoadLineState } from '@/game/Game';
import type { World } from '@/simulation/world/World';

/**
 * The preview's two colours, shared with the building ghost on purpose.
 *
 * A player has already learned from placing buildings that green means "this
 * will happen here" and red means "not here". Teaching them a second palette for
 * the same idea would be a worse road tool, not a prettier one.
 */
const WILL_PAVE_TINT = 0x7fb069;
const CANNOT_PAVE_TINT = 0xc0584a;

/** What is drawn on one cell, and which of the sixteen shapes it takes. */
interface Piece {
  readonly kind: ConnectorKind;
  readonly mask: number;
}

export class ConnectorRenderer {
  private readonly scene: Phaser.Scene;
  /** Keyed by cell index, so a lifted road can be found and destroyed. */
  private readonly tiles = new Map<number, { image: Phaser.GameObjects.Image; piece: Piece }>();
  private renderedRoadVersion = -1;
  private renderedFenceVersion = -1;
  private renderedTerrainVersion = -1;
  /** The run being aimed, as ghost tiles. Empty whenever nothing is drawn. */
  private readonly preview: Phaser.GameObjects.Image[] = [];
  private renderedRoadLineVersion = -1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public sync(world: World): void {
    if (
      this.renderedRoadVersion === world.roads.version &&
      this.renderedFenceVersion === world.fences.version &&
      this.renderedTerrainVersion === world.terrain.version
    ) {
      return;
    }
    this.renderedRoadVersion = world.roads.version;
    this.renderedFenceVersion = world.fences.version;
    this.renderedTerrainVersion = world.terrain.version;

    const wanted = this.survey(world);

    for (const [index, piece] of wanted) {
      const existing = this.tiles.get(index);
      if (existing && existing.piece.kind === piece.kind && existing.piece.mask === piece.mask) {
        continue;
      }
      if (existing) {
        // A neighbour arrived: the same cell, a different shape.
        existing.image.setFrame(TextureKeys.connectorFrame(piece.kind, piece.mask));
        this.tiles.set(index, { image: existing.image, piece });
        continue;
      }

      const gx = index % world.width;
      const gy = (index - gx) / world.width;
      const position = gridToScene({ gx, gy });
      const image = this.scene.add
        .image(
          position.px,
          position.py,
          TextureKeys.connectorAtlas,
          TextureKeys.connectorFrame(piece.kind, piece.mask),
        )
        .setOrigin(0.5, 0.5)
        // **A palisade sorts as a structure, not as an overlay.** The other three
        // are painted on the ground and everything walks over them; a fence
        // stands up, so a villager on the near side of it has to be drawn in
        // front and one on the far side behind.
        .setDepth(
          depthFor(gx, gy, piece.kind === 'fence' ? RenderLayer.Structure : RenderLayer.Overlay),
        );
      this.tiles.set(index, { image, piece });
    }

    for (const [index, tile] of this.tiles) {
      if (!wanted.has(index)) {
        tile.image.destroy();
        this.tiles.delete(index);
      }
    }
  }

  /**
   * Draws the run of road the player is aiming, cell by cell.
   *
   * Green for the cells that will be paved and red for the ones that cannot be —
   * a run drawn across the river shows both, which is how the player learns that
   * the line they drew is not quite the road they will get.
   *
   * The same ghost tile the building placement uses, and for the same reason: it
   * sits above the terrain, so a run drawn through a wood is not lost behind the
   * trees.
   *
   * Synced off the run's version, so this costs one comparison a frame while
   * nobody is drawing anything.
   */
  public syncRoadLine(line: RoadLineState | null, version: number): void {
    if (this.renderedRoadLineVersion === version) {
      return;
    }
    this.renderedRoadLineVersion = version;

    for (const cell of this.preview) {
      cell.destroy();
    }
    this.preview.length = 0;

    if (!line) {
      return;
    }

    const payable = new Set(line.payable.map((cell) => `${cell.gx},${cell.gy}`));
    for (const cell of line.cells) {
      const position = gridToScene(cell);
      this.preview.push(
        this.scene.add
          .image(position.px, position.py, TextureKeys.ghostCell)
          .setOrigin(0.5, 0.5)
          .setTint(payable.has(`${cell.gx},${cell.gy}`) ? WILL_PAVE_TINT : CANNOT_PAVE_TINT)
          .setAlpha(0.75)
          .setDepth(overlayDepth(cell.gx, cell.gy)),
      );
    }
  }

  /**
   * What every laid cell should look like right now.
   *
   * A road joins other roads; a channel joins the water, which includes the
   * river itself — a ditch that did not visibly run into the river would not
   * read as carrying water at all.
   */
  private survey(world: World): Map<number, Piece> {
    const pieces = new Map<number, Piece>();

    const paved = (gx: number, gy: number): boolean => world.roads.has(gx, gy);
    const wet = (gx: number, gy: number): boolean =>
      world.terrain.contains(gx, gy) && WET_TERRAIN.includes(world.terrain.get(gx, gy));

    // A bridge also meets the bank. Its abutment is not a road — the ground
    // beside a river is usually just ground — and a deck that stopped at the
    // waterline read as a raft moored in midstream rather than as a crossing.
    const shore = (gx: number, gy: number): boolean =>
      paved(gx, gy) ||
      (world.terrain.contains(gx, gy) && !WET_TERRAIN.includes(world.terrain.get(gx, gy)));

    // The stake lines, which join each other and nothing else: a fence running
    // into a house is still a fence, and drawing it as though the wall were part
    // of it would put a stake through somebody's kitchen.
    const fenced = (gx: number, gy: number): boolean => world.fences.has(gx, gy);
    for (const cell of world.fences.all()) {
      pieces.set(cell.gy * world.width + cell.gx, {
        kind: 'fence',
        mask: connectorMask(cell.gx, cell.gy, fenced),
      });
    }

    for (const cell of world.roads.all()) {
      const spannable = WET_TERRAIN.includes(world.terrain.get(cell.gx, cell.gy));
      pieces.set(cell.gy * world.width + cell.gx, {
        kind: spannable ? 'bridge' : 'road',
        mask: connectorMask(cell.gx, cell.gy, spannable ? shore : paved),
      });
    }

    world.terrain.forEach((gx, gy, type) => {
      if (type !== 'ditch' || world.roads.has(gx, gy)) {
        return;
      }
      pieces.set(gy * world.width + gx, { kind: 'ditch', mask: connectorMask(gx, gy, wet) });
    });

    return pieces;
  }

  public destroy(): void {
    for (const tile of this.tiles.values()) {
      tile.image.destroy();
    }
    this.tiles.clear();
    for (const cell of this.preview) {
      cell.destroy();
    }
    this.preview.length = 0;
    this.renderedRoadVersion = -1;
    this.renderedTerrainVersion = -1;
    this.renderedRoadLineVersion = -1;
  }
}
