/**
 * Draws the marks on things the player has ordered work on.
 *
 * Synced off the job board's version counter rather than diffed every frame:
 * designations change when the player taps, which is thousands of frames apart.
 */

import type Phaser from 'phaser';
import { overlayDepth } from '@/renderer/phaser/sorting';
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
const PLAYER_DESIGNATED: ReadonlySet<JobType> = new Set<JobType>(['chop-tree', 'gather-stone']);

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
        // Raised towards the canopy so the mark reads as being *on* the tree,
        // not lying on the ground in front of it.
        .setY(position.py - 34)
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
