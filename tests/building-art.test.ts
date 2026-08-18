/**
 * Where a building's art is allowed to be: on its own plot, and nowhere else.
 *
 * **Reported from play, and the report was right.** The storage yard had grown a
 * path of worn earth around itself that reached past the plot it stands on. It
 * looked good and it was a lie: the footprint is what blocks navigation, what
 * validates placement and what gets saved, so art that oversails it promises the
 * player ground they cannot build on and cannot walk through — and two yards
 * raised side by side had their paths drawn over each other.
 *
 * The fix was to shrink the building and draw the ground *inside* the plot, which
 * reads better anyway. This file is what stops it coming back, for every building
 * rather than the one that was caught.
 *
 * Tested by **recording the drawing rather than rendering it**: `drawBuilding`
 * talks to a handful of methods on a Phaser `Graphics`, so a stand-in that writes
 * down every coordinate it is handed measures the art exactly, headless, with no
 * canvas and no WebGL. That is the same reason the simulation is testable — the
 * drawing code is ordinary TypeScript that happens to be handed a graphics
 * object.
 */

import { describe, expect, it } from 'vitest';

import { BUILDING_IDS, buildingDefinition } from '@/data/buildings';
import { TILE_HEIGHT, TILE_WIDTH } from '@/shared/math/isometric';
import {
  BUILDING_COLOURS,
  artVariants,
  buildingTextureSpec,
  drawBuilding,
} from '@/renderer/phaser/terrain/buildingArt';

/**
 * A `Graphics` that draws nothing and remembers everywhere it was asked to.
 *
 * Every point the building art touches passes through one of these, so the
 * bounds it collects are the true extent of the drawing.
 */
class Recorder {
  public minX = Infinity;
  public maxX = -Infinity;
  public minY = Infinity;
  public maxY = -Infinity;

  public fillStyle(): void {}
  public lineStyle(): void {}
  public beginPath(): void {}
  public closePath(): void {}
  public fillPath(): void {}
  public strokePath(): void {}

  public moveTo(x: number, y: number): void {
    this.see(x, y);
  }

  public lineTo(x: number, y: number): void {
    this.see(x, y);
  }

  public fillRect(x: number, y: number, width: number, height: number): void {
    this.see(x, y);
    this.see(x + width, y + height);
  }

  public fillCircle(x: number, y: number, radius: number): void {
    this.see(x - radius, y - radius);
    this.see(x + radius, y + radius);
  }

  public fillEllipse(x: number, y: number, width: number, height: number): void {
    this.see(x - width / 2, y - height / 2);
    this.see(x + width / 2, y + height / 2);
  }

  private see(x: number, y: number): void {
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
  }
}

interface Drawn {
  readonly bounds: Recorder;
  /** The footprint's centre within the texture, and its half-diagonals. */
  readonly cx: number;
  readonly groundY: number;
  readonly halfW: number;
  readonly halfH: number;
  readonly width: number;
  readonly height: number;
}

function draw(id: (typeof BUILDING_IDS)[number], variant = 0): Drawn {
  const bounds = new Recorder();
  drawBuilding(
    bounds as unknown as Parameters<typeof drawBuilding>[0],
    id,
    BUILDING_COLOURS[id],
    variant,
  );

  const spec = buildingTextureSpec(id);
  const { footprint } = buildingDefinition(id);
  const span = footprint.width + footprint.height;
  return {
    bounds,
    cx: spec.width / 2,
    groundY: spec.height * spec.groundLine,
    halfW: (span * TILE_WIDTH) / 4,
    halfH: (span * TILE_HEIGHT) / 4,
    width: spec.width,
    height: spec.height,
  };
}

/** A pixel of slack: seams and bevels are drawn a fraction past their edge. */
const SLACK = 2;

/**
 * Every offender, rather than the first.
 *
 * A loop of bare `expect`s stops at the first building that fails, which hides
 * how much is wrong: the run that found this defect reported the Bridge and said
 * nothing about the four other buildings breaking the same rule.
 */
function offenders(check: (art: Drawn) => string | null): string[] {
  // **Every variant, not only the first.** A building drawn several ways — a
  // yard's stocked-ness, a house's construction — has a texture per variant, and
  // any one of them can be the one that oversails.
  return BUILDING_IDS.flatMap((id) =>
    Array.from({ length: artVariants(id) }, (_, variant) => {
      const complaint = check(draw(id, variant));
      return complaint === null ? null : `${id}/${variant}: ${complaint}`;
    }),
  ).filter((entry): entry is string => entry !== null);
}

describe('every building stays on its own plot', () => {
  it('draws nothing in front of the footprint', () => {
    // **The one the yard broke.** Ground drawn past the near corner lands on the
    // tile in front, which belongs to somebody else — or to nobody, and is
    // walkable. This is the assertion that failed when the path oversailed.
    expect(
      offenders((art) => {
        const limit = art.groundY + art.halfH + SLACK;
        return art.bounds.maxY <= limit
          ? null
          : `reaches ${(art.bounds.maxY - limit).toFixed(1)}px past its near corner`;
      }),
    ).toEqual([]);
  });

  it('draws nothing to either side of the footprint but eaves', () => {
    // A roof may oversail, and only by the overhang the building declares — that
    // is what `eaves` is and what the texture is widened for. Anything else
    // reaching sideways lands on a neighbour's plot.
    expect(
      offenders((art) => {
        const reach = (art.width - art.halfW * 2) / 2 + SLACK;
        const left = art.cx - art.halfW - reach;
        const right = art.cx + art.halfW + reach;
        if (art.bounds.minX < left) {
          return `reaches ${(left - art.bounds.minX).toFixed(1)}px left of its plot`;
        }
        return art.bounds.maxX <= right
          ? null
          : `reaches ${(art.bounds.maxX - right).toFixed(1)}px right of its plot`;
      }),
    ).toEqual([]);
  });

  it('keeps everything it draws inside its own texture', () => {
    // Not the same claim, and worth its own line: art that leaves the texture is
    // silently clipped, which is how every building in the game was once drawn
    // with its front corner sliced off. The Bridge's shadow was being sliced
    // square when this was written.
    expect(
      offenders((art) => {
        if (art.bounds.minX < -SLACK || art.bounds.minY < -SLACK) {
          return 'clipped at the top or left';
        }
        if (art.bounds.maxX > art.width + SLACK) {
          return `clipped ${(art.bounds.maxX - art.width).toFixed(1)}px on the right`;
        }
        return art.bounds.maxY <= art.height + SLACK
          ? null
          : `clipped ${(art.bounds.maxY - art.height).toFixed(1)}px at the bottom`;
      }),
    ).toEqual([]);
  });

  it('actually draws something for every building', () => {
    // Guards the guard: a recorder that saw nothing would pass every test above.
    expect(
      offenders((art) =>
        art.bounds.maxX - art.bounds.minX > 8 && art.bounds.maxY - art.bounds.minY > 8
          ? null
          : 'drew nothing',
      ),
    ).toEqual([]);
  });
});
