/**
 * A building's own art, as a picture the guide can put in an `<img>`.
 *
 * **Asked for, with the reasonable worry that it would be a lot of trouble.** It
 * is not, and the reason is worth recording: the building art never depended on
 * Phaser. Every routine takes a `Graphics` and calls a dozen of its methods, so
 * `CanvasGraphics` forwards those dozen to a 2D context and the same code draws
 * the same building onto a plain canvas. Nothing is redrawn for the guide, no
 * asset is exported, and a change to a roof changes the thumbnail with it — which
 * is the whole point, because a guide illustrated with stale pictures of
 * buildings is worse than a guide with none.
 *
 * Drawn once per building and kept, because the sheet is opened, closed and
 * reopened and twenty-one canvases is twenty-one canvases too many to make twice.
 * The cache is keyed by id and size so a caller asking for a different size gets
 * one rather than the wrong picture scaled.
 *
 * Lives on the renderer's side of the guide — `Guide.ts` calls it, `guideContent`
 * only names which building the picture is of. The content half has to keep
 * running under Node with no DOM, and a canvas is the least portable thing there
 * is.
 */

import { type BuildingId } from '@/data/buildings';
import { CanvasGraphics } from '@/renderer/canvas/CanvasGraphics';
import {
  BUILDING_COLOURS,
  buildingTextureSpec,
  drawBuilding,
} from '@/renderer/phaser/terrain/buildingArt';

/** Data URLs already drawn, keyed by `id@width×height`. */
const cache = new Map<string, string>();

export interface ThumbnailBox {
  readonly width: number;
  readonly height: number;
}

/**
 * The building, drawn to fit a box, as a `data:` URL.
 *
 * Scaled to fit rather than cropped, and **standing on the bottom of the box**:
 * every building in the game is drawn from its ground line, and a row of
 * thumbnails centred in their boxes would have a School floating above a House.
 * The scale is one number for both axes, so nothing is stretched.
 *
 * @returns an empty string where a canvas cannot be had, so a caller can leave
 *   the image out rather than emit a broken one
 */
export function buildingThumbnail(id: BuildingId, box: ThumbnailBox): string {
  const key = `${id}@${box.width}x${box.height}`;
  const drawn = cache.get(key);
  if (drawn !== undefined) {
    return drawn;
  }

  const canvas = document.createElement('canvas');
  // Twice the box, so the picture is sharp on the phones and tablets this game
  // is aimed at. A 1x thumbnail on a 3x screen looks like a thumbnail of a
  // thumbnail.
  const density = 2;
  canvas.width = box.width * density;
  canvas.height = box.height * density;

  const context = canvas.getContext('2d');
  if (!context) {
    cache.set(key, '');
    return '';
  }

  const spec = buildingTextureSpec(id);
  const scale = Math.min(box.width / spec.width, box.height / spec.height) * density;
  context.scale(scale, scale);
  // Centred across, and sitting on the floor of the box.
  context.translate((canvas.width / scale - spec.width) / 2, canvas.height / scale - spec.height);
  context.imageSmoothingEnabled = false;

  drawBuilding(new CanvasGraphics(context) as never, id, BUILDING_COLOURS[id]);

  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
