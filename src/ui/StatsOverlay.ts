/**
 * A frame-rate readout that survives into the production build.
 *
 * Everything in `src/debug` is stripped from a release, which is right for a
 * tool that can conjure grain and skip winters — and wrong for the one number
 * that can only be measured on the machine somebody actually plays on. The
 * performance work could measure the simulation exactly and could say nothing
 * honest about frame rate, because the only browser available to it rasterises
 * in software. This is how a real device reports back.
 *
 * **Off unless asked for.** It appears only with `?stats` in the URL, so the
 * ordinary player never sees it and the brief's rule that debug tooling must
 * not pollute the production UI still holds: nothing is polluted by a panel
 * nobody can reach by accident.
 *
 * It reports the worst frame as well as the average, because an average hides
 * exactly the stutter a player notices.
 */

import type { GameContext } from '@/game/Game';

/** Frames between DOM writes. Per-frame text updates would measure themselves. */
const REFRESH_INTERVAL_FRAMES = 15;

/**
 * Milliseconds ignored at startup, while textures are built and the JIT warms.
 *
 * Measured in time rather than frames on purpose: a frame count warms up in a
 * second and a half at 60 FPS and never finishes at all on a device slow enough
 * to be worth measuring, which is precisely the device this exists for.
 */
const WARMUP_MS = 2000;

/** `true` when the page was asked for statistics. */
export function statsRequested(search: string): boolean {
  return new URLSearchParams(search).has('stats');
}

export class StatsOverlay {
  private readonly element: HTMLElement;
  private readonly context: GameContext;

  private frames = 0;
  private startedAt = 0;
  private smoothedFps = 0;
  private worstFps = Number.POSITIVE_INFINITY;
  private totalFps = 0;
  private samples = 0;

  constructor(parent: HTMLElement, context: GameContext) {
    this.context = context;
    this.element = document.createElement('pre');
    this.element.className = 'stats-overlay';
    parent.append(this.element);
  }

  public update(): void {
    const stats = this.context.stats();
    this.frames += 1;
    if (this.startedAt === 0) {
      this.startedAt = performance.now();
    }

    // Raw per-frame FPS is too noisy to read; smoothed for display only. The
    // recorded average and worst use the unsmoothed figure, which is the one
    // that describes what the device actually did.
    this.smoothedFps =
      this.smoothedFps === 0 ? stats.fps : this.smoothedFps * 0.9 + stats.fps * 0.1;

    const warm = performance.now() - this.startedAt > WARMUP_MS;
    if (warm && Number.isFinite(stats.fps) && stats.fps > 0) {
      this.worstFps = Math.min(this.worstFps, stats.fps);
      this.totalFps += stats.fps;
      this.samples += 1;
    }

    if (this.frames % REFRESH_INTERVAL_FRAMES !== 0) {
      return;
    }

    const snapshot = this.context.snapshot();
    const average = this.samples === 0 ? 0 : this.totalFps / this.samples;
    const worst = Number.isFinite(this.worstFps) ? this.worstFps : 0;

    this.element.textContent = [
      `fps  ${this.smoothedFps.toFixed(0)}  avg ${average.toFixed(0)}  worst ${worst.toFixed(0)}`,
      `sim  ${stats.simulationMs.toFixed(2)} ms/frame`,
      `pop  ${snapshot.villagerCount}   trees ${snapshot.treeCount}`,
      `view ${window.innerWidth}x${window.innerHeight} @ ${stats.zoom.toFixed(2)}x`,
    ].join('\n');
  }

  public destroy(): void {
    this.element.remove();
  }
}
