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
import { RenderLayer, depthFor } from '@/renderer/phaser/sorting';
import { connectorMask } from '@/renderer/phaser/terrain/connectors';
import { TextureKeys, type ConnectorKind } from '@/renderer/phaser/terrain/tileTextures';
import { WET_TERRAIN } from '@/data/terrain';
import { gridToScene } from '@/shared/math/isometric';
import type { World } from '@/simulation/world/World';

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
  private renderedTerrainVersion = -1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public sync(world: World): void {
    if (
      this.renderedRoadVersion === world.roads.version &&
      this.renderedTerrainVersion === world.terrain.version
    ) {
      return;
    }
    this.renderedRoadVersion = world.roads.version;
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
        .setDepth(depthFor(gx, gy, RenderLayer.Overlay));
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
    this.renderedRoadVersion = -1;
    this.renderedTerrainVersion = -1;
  }
}
