/**
 * A drawing board for building art, served by Vite in development only.
 *
 * The building art is ordinary TypeScript that happens to be handed a Phaser
 * `Graphics`, so `CanvasGraphics` — a stand-in that forwards the same handful of
 * calls to a plain 2D canvas — draws the *real* art with no game, no WebGL and
 * no scene, which is what makes it possible to look at three proposals side by
 * side before any of them is wired into anything. The guide's thumbnails use the
 * same stand-in.
 *
 * Not part of the build: nothing in `src/` imports it, and `index.html` is the
 * only entry the production bundle knows about.
 */

import { BUILDING_IDS, type BuildingId } from './src/data/buildings';
import { CanvasGraphics } from './src/renderer/canvas/CanvasGraphics';
import { RESOURCE_IDS } from './src/data/resources';
import { drawPile } from './src/renderer/phaser/terrain/pileArt';
import {
  BUILDING_COLOURS,
  artVariants,
  buildingTextureSpec,
  drawBuilding,
} from './src/renderer/phaser/terrain/buildingArt';

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') ?? 3);

/**
 * The ground heaps, on their own board.
 *
 * One per good, and the whole point is to look at them side by side: each has to
 * answer "what is that" at gameplay zoom, and the only way to know whether two
 * of them read as the same thing is to put them next to each other.
 */
if (params.get('id') === 'piles') {
  const box = { width: 64, height: 40 };
  const canvas = document.getElementById('sheet') as HTMLCanvasElement;
  const gutter = 10;
  canvas.width = (box.width + gutter) * RESOURCE_IDS.length * scale;
  canvas.height = (box.height + 26) * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = false;
  const graphics = new CanvasGraphics(ctx);
  RESOURCE_IDS.forEach((resource, index) => {
    ctx.save();
    ctx.translate((box.width + gutter) * index, 4);
    drawPile(graphics as never, resource, box);
    ctx.restore();
    ctx.fillStyle = '#ddd6c2';
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillText(resource, (box.width + gutter) * index + 6, box.height + 18);
  });
  throw new Error('piles drawn');
}
const wanted = params.get('id') ?? 'house';
const gap = 16;

const canvas = document.getElementById('sheet') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

/** One cell of the board: a building drawn in one of its variants. */
interface Cell {
  readonly id: BuildingId;
  readonly variant: number;
}

const cells: Cell[] =
  wanted === 'all'
    ? BUILDING_IDS.map((id) => ({ id, variant: 0 }))
    : Array.from({ length: artVariants(wanted as BuildingId) }, (_, variant) => ({
        id: wanted as BuildingId,
        variant,
      }));

const columns = wanted === 'all' ? 5 : cells.length;
const cellW = Math.max(...cells.map((c) => buildingTextureSpec(c.id).width)) + gap;
const cellH = Math.max(...cells.map((c) => buildingTextureSpec(c.id).height)) + gap * 3;
const rows = Math.ceil(cells.length / columns);

canvas.width = cellW * columns * scale;
canvas.height = cellH * rows * scale;
ctx.scale(scale, scale);
ctx.imageSmoothingEnabled = false;

const graphics = new CanvasGraphics(ctx);
cells.forEach((cell, index) => {
  const spec = buildingTextureSpec(cell.id);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = cellW * column + (cellW - spec.width) / 2;
  const y = cellH * row + gap + (cellH - gap * 3 - spec.height);

  ctx.save();
  ctx.translate(x, y);
  drawBuilding(graphics as never, cell.id, BUILDING_COLOURS[cell.id], cell.variant);
  ctx.restore();

  ctx.fillStyle = '#ddd6c2';
  ctx.font = '9px system-ui, sans-serif';
  ctx.fillText(
    `${cell.id} \u00b7 ${cell.variant}`,
    cellW * column + gap / 2,
    cellH * (row + 1) - gap,
  );
});
