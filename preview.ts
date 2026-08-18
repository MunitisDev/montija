/**
 * A drawing board for building art, served by Vite in development only.
 *
 * The building art is ordinary TypeScript that happens to be handed a Phaser
 * `Graphics`, so a stand-in that forwards the same handful of calls to a plain
 * 2D canvas draws the *real* art with no game, no WebGL and no scene — which is
 * what makes it possible to look at three proposals side by side before any of
 * them is wired into anything.
 *
 * Not part of the build: nothing in `src/` imports it, and `index.html` is the
 * only entry the production bundle knows about.
 */

import { BUILDING_IDS, type BuildingId } from './src/data/buildings';
import {
  BUILDING_COLOURS,
  artVariants,
  buildingTextureSpec,
  drawBuilding,
} from './src/renderer/phaser/terrain/buildingArt';

/** Enough of Phaser's `Graphics` for the building art, onto a 2D context. */
class CanvasGraphics {
  private readonly ctx: CanvasRenderingContext2D;
  private path: { x: number; y: number }[] = [];

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  public fillStyle(colour: number, alpha = 1): void {
    this.ctx.fillStyle = `rgba(${(colour >> 16) & 0xff}, ${(colour >> 8) & 0xff}, ${colour & 0xff}, ${alpha})`;
  }

  public lineStyle(width: number, colour: number, alpha = 1): void {
    this.ctx.lineWidth = width;
    this.ctx.strokeStyle = `rgba(${(colour >> 16) & 0xff}, ${(colour >> 8) & 0xff}, ${colour & 0xff}, ${alpha})`;
  }

  public beginPath(): void {
    this.path = [];
  }

  public moveTo(x: number, y: number): void {
    this.path = [{ x, y }];
  }

  public lineTo(x: number, y: number): void {
    this.path.push({ x, y });
  }

  public closePath(): void {}

  public fillPath(): void {
    this.trace();
    this.ctx.fill();
  }

  public strokePath(): void {
    this.trace();
    this.ctx.stroke();
  }

  public fillRect(x: number, y: number, width: number, height: number): void {
    this.ctx.fillRect(x, y, width, height);
  }

  public fillCircle(x: number, y: number, radius: number): void {
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  public fillEllipse(x: number, y: number, width: number, height: number): void {
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private trace(): void {
    this.ctx.beginPath();
    const [first, ...rest] = this.path;
    if (!first) {
      return;
    }
    this.ctx.moveTo(first.x, first.y);
    for (const point of rest) {
      this.ctx.lineTo(point.x, point.y);
    }
    this.ctx.closePath();
  }
}

const params = new URLSearchParams(location.search);
const wanted = (params.get('id') ?? 'house') as BuildingId;
const scale = Number(params.get('scale') ?? 3);
const id: BuildingId = BUILDING_IDS.includes(wanted) ? wanted : 'house';
const variants = artVariants(id);
const spec = buildingTextureSpec(id);
const gap = 16;

const canvas = document.getElementById('sheet') as HTMLCanvasElement;
canvas.width = (spec.width + gap) * variants * scale;
canvas.height = (spec.height + gap * 3) * scale;
const ctx = canvas.getContext('2d')!;
ctx.scale(scale, scale);
ctx.imageSmoothingEnabled = false;

const graphics = new CanvasGraphics(ctx);
for (let variant = 0; variant < variants; variant += 1) {
  ctx.save();
  ctx.translate((spec.width + gap) * variant + gap / 2, gap);
  drawBuilding(graphics as never, id, BUILDING_COLOURS[id], variant);
  ctx.restore();

  ctx.fillStyle = '#ddd6c2';
  ctx.font = '9px system-ui, sans-serif';
  ctx.fillText(`${id} · ${variant}`, (spec.width + gap) * variant + gap / 2, spec.height + gap * 2);
}
