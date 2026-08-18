/**
 * Draws the marks on things the player has ordered work on.
 *
 * Synced off the job board's version counter rather than diffed every frame:
 * designations change when the player taps, which is thousands of frames apart.
 */

import type Phaser from 'phaser';
import { overlayDepth } from '@/renderer/phaser/sorting';
import { ROCK_PEAK_LIFT } from '@/renderer/phaser/terrain/groundArt';
import { TextureKeys } from '@/renderer/phaser/terrain/tileTextures';
import { gridToScene } from '@/shared/math/isometric';
import type { JobType } from '@/simulation/jobs/Job';
import type { JobManager } from '@/simulation/jobs/JobManager';

/**
 * Job types that represent an order the player gave.
 *
 * Hauling is deliberately absent: the settlement generates those itself, and
 * marking them painted crosses over every log pile and storage yard, which read
 * as designations the player had made.
 */
const PLAYER_DESIGNATED: ReadonlySet<JobType> = new Set<JobType>([
  'chop-tree',
  'gather-stone',
  'pave-road',
  'dig-ditch',
]);

/**
 * How far above the cell each mark is lifted, in pixels.
 *
 * **Each lift is the height of the thing it marks**, and getting that wrong is
 * what a player sees. A tree is a 34-pixel sprite standing on its cell, so its
 * mark has to sit up in the canopy to read as being *on* it. A stone deposit is
 * not: it is drawn into the ground tile itself as a few low boulders, the
 * tallest of which rises about ten pixels above the middle of the diamond. It
 * borrowed the tree's lift and the cross floated in mid-air well clear of the
 * rock — marking, to the eye, whatever stood behind it. A road order is a mark
 * on the ground and belongs flat on it.
 */
export const MARK_LIFT: Readonly<Partial<Record<JobType, number>>> = {
  'chop-tree': 34,
  'gather-stone': ROCK_PEAK_LIFT,
  'pave-road': 0,
  // A channel is cut into the ground, so its mark lies on it like a road's.
  'dig-ditch': 0,
};

export class DesignationRenderer {
  private readonly scene: Phaser.Scene;
  private readonly marks = new Map<number, Phaser.GameObjects.Image>();
  private renderedVersion = -1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public sync(jobs: JobManager): void {
    if (this.renderedVersion === jobs.version) {
      return;
    }
    this.renderedVersion = jobs.version;

    const live = new Set<number>();
    for (const job of jobs.all) {
      if (!PLAYER_DESIGNATED.has(job.type)) {
        continue;
      }
      live.add(job.id);
      if (this.marks.has(job.id)) {
        continue;
      }

      const position = gridToScene(job.target);
      const mark = this.scene.add
        .image(position.px, position.py, TextureKeys.designation)
        .setOrigin(0.5, 0.5)
        .setY(position.py - (MARK_LIFT[job.type] ?? 0))
        // Above every world object: an order the player just gave must not be
        // hidden by whatever tree happens to stand in front of it.
        .setDepth(overlayDepth(job.target.gx, job.target.gy));
      this.marks.set(job.id, mark);
    }

    for (const [id, mark] of this.marks) {
      if (!live.has(id)) {
        mark.destroy();
        this.marks.delete(id);
      }
    }
  }

  public destroy(): void {
    for (const mark of this.marks.values()) {
      mark.destroy();
    }
    this.marks.clear();
    this.renderedVersion = -1;
  }
}
