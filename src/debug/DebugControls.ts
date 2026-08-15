/**
 * Development-only controls: the buttons the brief asks for.
 *
 * > Debug controls: spawn villager, add resource, switch season, advance time,
 * > complete construction.
 *
 * Until now the overlay could only *watch*. Anything that took a simulated year
 * to reach — winter, a famine, a birth — took a real year's worth of watching
 * to see, which made testing the parts of the game that matter most the slowest
 * thing to do.
 *
 * **The DOM is built here rather than in `index.html`.** Markup in the page
 * ships to production whether it is used or not; built in code, and constructed
 * only under `import.meta.env.DEV`, the bundler drops all of it. Debug tooling
 * must never leak into the production UI.
 *
 * These reach past the ordinary command surface on purpose — jumping the
 * calendar and conjuring grain are not things a player may do. That is exactly
 * why they live in `src/debug` and nowhere else.
 */

import { RESOURCE_IDS } from '@/data/resources';
import type { GameContext } from '@/game/Game';
import { TICKS_PER_DAY, TICKS_PER_SEASON } from '@/simulation/seasons/SeasonClock';

/** How much of a resource one press conjures. */
const RESOURCE_STEP = 100;

/** Villagers per press. Enough to see a difference, few enough to aim. */
const VILLAGERS_PER_PRESS = 5;

export class DebugControls {
  private readonly element: HTMLElement;
  private readonly context: GameContext;

  constructor(parent: HTMLElement, context: GameContext) {
    this.context = context;
    this.element = document.createElement('div');
    this.element.className = 'debug-controls';
    this.element.hidden = true;

    this.addButton('+5 villagers', () => this.spawnVillagers());
    for (const resource of RESOURCE_IDS) {
      this.addButton(`+${RESOURCE_STEP} ${resource}`, () => this.addResource(resource));
    }
    this.addButton('+1 day', () => this.skip(TICKS_PER_DAY));
    this.addButton('next season', () => this.nextSeason());
    this.addButton('finish building', () => this.finishConstruction());

    parent.append(this.element);
  }

  public setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }

  /**
   * Puts new villagers on the map.
   *
   * They arrive homeless and unfed like anyone else; this is a way to load the
   * settlement, not a way to cheat past its problems.
   */
  private spawnVillagers(): void {
    const world = this.context.simulation.world;
    this.context.simulation.villagers.spawnNear(world.centreCell, VILLAGERS_PER_PRESS);
  }

  /** Drops goods into the first yard that will take them. */
  private addResource(resource: (typeof RESOURCE_IDS)[number]): void {
    const storages = this.context.simulation.storages;
    const yard = storages.all.find((candidate) => candidate.accepts(resource));
    if (!yard) {
      return;
    }
    yard.inventory.add(resource, RESOURCE_STEP);
    storages.markChanged();
  }

  /**
   * Jumps the calendar forward.
   *
   * The clock is moved rather than the simulation run fast: running a season at
   * speed would take a season's worth of frames, which is the wait this exists
   * to remove. The cost is that nothing happens during the skipped days — no
   * food eaten, nobody aged — so this shows the *view* of a later date rather
   * than a settlement that has lived through it. Good for checking winter looks
   * right; useless for checking whether the settlement survives it, which is
   * what the headless balance tests are for.
   *
   * Both clocks have to move. The SimulationClock owns the authoritative tick
   * and feeds it to the simulation every frame, so advancing the simulation
   * alone is undone on the very next frame — which is exactly what happened the
   * first time this was written, and looked like the button doing nothing.
   */
  private skip(ticks: number): void {
    const simulation = this.context.simulation;
    const clock = this.context.clock;
    const target = clock.tick + ticks;

    clock.restore(target, clock.speed);
    simulation.restoreClock(target, simulation.snapshot().deaths);
  }

  /**
   * Moves to the same point in the next season.
   *
   * A whole season rather than "to the next boundary", so repeated presses walk
   * the year evenly instead of creeping up on a boundary and stalling there.
   */
  private nextSeason(): void {
    this.skip(TICKS_PER_SEASON);
  }

  /** Finishes whatever is under construction, oldest site first. */
  private finishConstruction(): void {
    const world = this.context.simulation.world;
    const site = world.buildings.underConstruction()[0];
    if (!site) {
      return;
    }
    world.buildings.complete(world, site);
  }

  private addButton(label: string, onClick: () => void): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'debug-controls__button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    this.element.append(button);
  }

  public destroy(): void {
    this.element.remove();
  }
}
