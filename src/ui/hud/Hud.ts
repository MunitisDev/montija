/**
 * The HUD.
 *
 * Deliberately plain DOM: the overlay is HTML/CSS so it can use safe-area
 * insets, scale text properly on tablets and stay accessible, while the world
 * itself stays entirely inside the WebGL canvas.
 *
 * Status: the speed controls are fully wired. The resource and season readouts
 * are placeholders showing `--` until Phases 5-8 give them real values — they
 * are laid out now so the layout work is done, not to imply working economy.
 */

import type { GameContext } from '@/game/Game';
import { SIMULATION_SPEEDS, type SimulationSpeed } from '@/simulation/SimulationClock';

/** Elements the HUD binds to, looked up once. */
interface HudElements {
  readonly root: HTMLElement;
  readonly population: HTMLElement;
  readonly food: HTMLElement;
  readonly logs: HTMLElement;
  readonly firewood: HTMLElement;
  readonly stone: HTMLElement;
  readonly season: HTMLElement;
  readonly temperature: HTMLElement;
  readonly speedButtons: readonly HTMLButtonElement[];
}

export class Hud {
  private readonly context: GameContext;
  private readonly elements: HudElements;
  private lastRenderedSpeed: SimulationSpeed | null = null;
  private lastRenderedPopulation = -1;

  constructor(root: HTMLElement, context: GameContext) {
    this.context = context;
    this.elements = collectElements(root);
    this.bindSpeedButtons();
    this.update();
  }

  /**
   * Refreshes the readouts.
   *
   * Called once per animation frame but writes to the DOM only when a value
   * actually changed — layout thrash next to a WebGL canvas is expensive.
   */
  public update(): void {
    const snapshot = this.context.snapshot();
    const speed = this.context.clock.speed;

    if (snapshot.villagerCount !== this.lastRenderedPopulation) {
      this.elements.population.textContent = String(snapshot.villagerCount);
      this.lastRenderedPopulation = snapshot.villagerCount;
    }

    if (speed !== this.lastRenderedSpeed) {
      this.renderSpeed(speed);
      this.lastRenderedSpeed = speed;
    }
  }

  private renderSpeed(speed: SimulationSpeed): void {
    for (const button of this.elements.speedButtons) {
      const buttonSpeed = Number(button.dataset['speed']);
      const active = buttonSpeed === speed;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  private bindSpeedButtons(): void {
    for (const button of this.elements.speedButtons) {
      button.addEventListener('click', () => {
        const speed = Number(button.dataset['speed']);
        if (isSimulationSpeed(speed)) {
          this.context.clock.setSpeed(speed);
          this.update();
        }
      });
    }
  }
}

function collectElements(root: HTMLElement): HudElements {
  return {
    root,
    population: requireElement(root, '[data-hud="population"]'),
    food: requireElement(root, '[data-hud="food"]'),
    logs: requireElement(root, '[data-hud="logs"]'),
    firewood: requireElement(root, '[data-hud="firewood"]'),
    stone: requireElement(root, '[data-hud="stone"]'),
    season: requireElement(root, '[data-hud="season"]'),
    temperature: requireElement(root, '[data-hud="temperature"]'),
    speedButtons: Array.from(root.querySelectorAll<HTMLButtonElement>('[data-speed]')),
  };
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`HUD is missing a required element: ${selector}`);
  }
  return element;
}

function isSimulationSpeed(value: number): value is SimulationSpeed {
  return (SIMULATION_SPEEDS as readonly number[]).includes(value);
}
