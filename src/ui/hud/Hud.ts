/**
 * The HUD.
 *
 * Deliberately plain DOM: the overlay is HTML/CSS so it can use safe-area
 * insets, scale text properly on tablets and stay accessible, while the world
 * itself stays entirely inside the WebGL canvas.
 *
 * Status: speed controls and the tile panel are fully wired. The resource and
 * season readouts are placeholders showing `--` until Phases 5-8 give them real
 * values — they are laid out now so the layout work is done, not to imply a
 * working economy.
 */

import { TERRAIN, type TerrainType } from '@/data/terrain';
import type { GameContext } from '@/game/Game';
import { SIMULATION_SPEEDS, type SimulationSpeed } from '@/simulation/SimulationClock';

/** Elements the HUD binds to, looked up once. */
interface HudElements {
  readonly population: HTMLElement;
  readonly selection: HTMLElement;
  readonly selectionTerrain: HTMLElement;
  readonly selectionCell: HTMLElement;
  readonly selectionFlags: HTMLElement;
  readonly speedButtons: readonly HTMLButtonElement[];
}

export class Hud {
  private readonly context: GameContext;
  private readonly elements: HudElements;
  private lastRenderedSpeed: SimulationSpeed | null = null;
  private lastRenderedPopulation = -1;
  private lastRenderedSelection = -1;

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

    if (this.context.selectionVersion !== this.lastRenderedSelection) {
      this.renderSelection();
      this.lastRenderedSelection = this.context.selectionVersion;
    }
  }

  private renderSelection(): void {
    const selection = this.context.selection;
    if (!selection) {
      this.elements.selection.hidden = true;
      return;
    }

    this.elements.selection.hidden = false;
    this.elements.selectionTerrain.textContent = terrainName(selection.terrain);
    this.elements.selectionCell.textContent = `${selection.cell.gx}, ${selection.cell.gy}`;

    const flags: string[] = [];
    if (!selection.walkable) {
      flags.push('impassable');
    }
    if (!selection.buildable) {
      flags.push('cannot build');
    }
    this.elements.selectionFlags.textContent = flags.join(' · ');
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

function terrainName(type: TerrainType): string {
  return TERRAIN[type].name;
}

function collectElements(root: HTMLElement): HudElements {
  return {
    population: requireElement(root, '[data-hud="population"]'),
    selection: requireElement(root, '[data-hud="selection"]'),
    selectionTerrain: requireElement(root, '[data-hud="selection-terrain"]'),
    selectionCell: requireElement(root, '[data-hud="selection-cell"]'),
    selectionFlags: requireElement(root, '[data-hud="selection-flags"]'),
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
