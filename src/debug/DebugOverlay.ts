/**
 * Development-only diagnostics overlay.
 *
 * Toggled with the on-screen button (no keyboard requirement) and excluded from
 * production builds: `bootstrap` only constructs it under `import.meta.env.DEV`,
 * so the bundler drops it entirely from a release build. Debug tooling must
 * never leak into the production UI.
 *
 * Phases 3-5 add villager, job and path-request counters here.
 */

import type { GameContext } from '@/game/Game';

/** Frames between DOM writes; per-frame text updates are pure overhead. */
const REFRESH_INTERVAL_FRAMES = 10;

export class DebugOverlay {
  private readonly element: HTMLElement;
  private readonly context: GameContext;
  private frameCounter = 0;
  private smoothedFps = 0;

  constructor(element: HTMLElement, context: GameContext) {
    this.element = element;
    this.context = context;
    this.element.hidden = false;
  }

  public update(): void {
    const stats = this.context.stats();

    // Raw per-frame FPS is too noisy to read; smooth it for display only.
    this.smoothedFps =
      this.smoothedFps === 0 ? stats.fps : this.smoothedFps * 0.9 + stats.fps * 0.1;

    this.frameCounter += 1;
    if (this.frameCounter % REFRESH_INTERVAL_FRAMES !== 0) {
      return;
    }

    const snapshot = this.context.snapshot();
    const world = this.context.simulation.world;
    const selection = this.context.selection;

    const lines = [
      `fps          ${this.smoothedFps.toFixed(0)}`,
      `tick         ${stats.tick}`,
      `speed        ${stats.speed}x`,
      `ticks/frame  ${stats.ticksLastFrame}`,
      `sim time     ${stats.simulationMs.toFixed(2)} ms`,
      `dropped      ${stats.droppedTicks}`,
      `zoom         ${stats.zoom.toFixed(2)}`,
      `camera       ${stats.cameraX.toFixed(0)}, ${stats.cameraY.toFixed(0)}`,
      `map          ${world.width} x ${world.height}`,
      `tiles        ${world.width * world.height}`,
      `trees        ${snapshot.treeCount}`,
      `villagers    ${snapshot.villagerCount} (${snapshot.walkingCount} walk, ${snapshot.workingCount} work)`,
      `jobs open    ${snapshot.jobsAvailable}`,
      `jobs taken   ${snapshot.jobsAssigned}`,
      `jobs done    ${snapshot.jobsCompleted}`,
      `piles        ${snapshot.pileCount}`,
      `buildings    ${snapshot.buildingCount} (${snapshot.sitesUnderConstruction} building)`,
      `housing      ${snapshot.housingCapacity}`,
      `season       ${snapshot.season} y${snapshot.year} d${snapshot.dayOfSeason} ${snapshot.temperature}°`,
      `last day     ate ${snapshot.lastDay.foodEaten}, burned ${snapshot.lastDay.firewoodBurned}`,
      `shortfall    ${snapshot.lastDay.foodShortfall} food, ${snapshot.lastDay.firewoodShortfall} wood`,
      `deaths       ${snapshot.deaths}  (min health ${snapshot.lowestHealth})`,
      `logs         ${snapshot.stored.logs} stored, ${snapshot.loose.logs} loose`,
      `stone        ${snapshot.stored.stone} stored, ${snapshot.loose.stone} loose`,
      `path reqs    ${snapshot.pathRequests} (${snapshot.pathFailures} failed)`,
      `selected     ${selection ? `${selection.cell.gx},${selection.cell.gy} ${selection.terrain}` : '-'}`,
      `seed         ${this.context.simulation.worldSeed}`,
    ];

    this.element.textContent = lines.join('\n');
  }

  /** Whether the overlay is on screen, so the controls can follow it. */
  public get isVisible(): boolean {
    return !this.element.hidden;
  }

  public toggle(): void {
    this.element.hidden = !this.element.hidden;
  }
}
