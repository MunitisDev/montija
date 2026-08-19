/**
 * Enough of Phaser's `Graphics` to draw the game's own art onto a plain canvas.
 *
 * **The building art was always Phaser-agnostic and nothing took advantage of
 * it.** Every drawing routine in `renderer/phaser/terrain` takes a `Graphics`
 * and calls a dozen of its methods; none of them touches a scene, a texture or
 * WebGL. Forwarding those dozen calls to a 2D context therefore draws the *real*
 * building — not a copy of it, not an approximation, the same code — anywhere a
 * `<canvas>` can be had.
 *
 * That buys two things. The drawing board (`preview.ts`) can show every building
 * side by side with no game running, and the guide can put a **thumbnail** beside
 * each building's entry without the HUD having to ask the renderer for a texture
 * or the two of them having to share a scene. One drawing, two surfaces.
 *
 * Deliberately not a Phaser type. The art's parameter is structurally typed
 * against Phaser's `Graphics`, which has a hundred methods this does not, so
 * callers pass this through `as never` — the honest admission that it is a
 * stand-in for the handful of calls the art actually makes, checked by the art
 * failing to draw rather than by the compiler.
 */

export class CanvasGraphics {
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
