/**
 * The HUD.
 *
 * Deliberately plain DOM: the overlay is HTML/CSS so it can use safe-area
 * insets, scale text properly on tablets and stay accessible, while the world
 * itself stays entirely inside the WebGL canvas.
 *
 * Status: speed controls, the tile panel and the resource readouts are wired.
 * Everything it shows is now live.
 *
 * The resource numbers are a **cached summary** of what the storage yards hold,
 * never the authority. A small `+n` marks units still lying in the field.
 */

import { RESOURCE_IDS, type ResourceId } from '@/data/resources';
import { TERRAIN, type TerrainType } from '@/data/terrain';
import type { GameContext } from '@/game/Game';
import { SIMULATION_SPEEDS, type SimulationSpeed } from '@/simulation/SimulationClock';

/** Elements the HUD binds to, looked up once. */
interface HudElements {
  readonly population: HTMLElement;
  readonly resources: Readonly<Record<ResourceId, HTMLElement>>;
  readonly selection: HTMLElement;
  readonly selectionTerrain: HTMLElement;
  readonly selectionCell: HTMLElement;
  readonly selectionFlags: HTMLElement;
  readonly selectionAction: HTMLButtonElement;
  readonly season: HTMLElement;
  readonly temperature: HTMLElement;
  readonly speedButtons: readonly HTMLButtonElement[];
  readonly saveButton: HTMLButtonElement;
  readonly loadButton: HTMLButtonElement;
  readonly saveStatus: HTMLElement;
}

export class Hud {
  private readonly context: GameContext;
  private readonly elements: HudElements;
  private lastRenderedSpeed: SimulationSpeed | null = null;
  private lastRenderedPopulation = -1;
  private lastRenderedSelection = -1;
  /** Stored totals last written to the DOM, so unchanged values are skipped. */
  private readonly lastRenderedTotals = new Map<ResourceId, number>();
  /** Loose totals last written, tracked apart from stored ones. */
  private readonly lastRenderedLoose = new Map<ResourceId, number>();
  private lastRenderedSaveVersion = -1;
  private lastRenderedSeason = '';
  private lastRenderedTemperature = Number.NaN;

  constructor(root: HTMLElement, context: GameContext) {
    this.context = context;
    this.elements = collectElements(root);
    this.bindSpeedButtons();
    this.bindSelectionAction();
    this.bindSessionButtons();
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

    // The HUD shows what the yards physically hold. Resources still lying on
    // the ground are excluded on purpose: felling a tree must not move the
    // counter until somebody has actually carried the logs in.
    for (const resource of RESOURCE_IDS) {
      const stored = snapshot.stored[resource];
      const loose = snapshot.loose[resource];
      const element = this.elements.resources[resource];

      if (this.lastRenderedTotals.get(resource) !== stored) {
        element.textContent = String(stored);
        this.lastRenderedTotals.set(resource, stored);
      }

      // Tracked separately: the amount lying in the field changes on its own,
      // and tying it to the stored total left a stale "+n" on screen after the
      // last load had already been carried in.
      if (this.lastRenderedLoose.get(resource) !== loose) {
        element.dataset['loose'] = loose > 0 ? `+${loose}` : '';
        this.lastRenderedLoose.set(resource, loose);
      }
    }

    const seasonLabel = `${capitalise(snapshot.season)} · Y${snapshot.year} d${snapshot.dayOfSeason}`;
    if (seasonLabel !== this.lastRenderedSeason) {
      this.elements.season.textContent = seasonLabel;
      this.lastRenderedSeason = seasonLabel;
    }

    if (snapshot.temperature !== this.lastRenderedTemperature) {
      this.elements.temperature.textContent = `${snapshot.temperature.toFixed(0)}°`;
      // Below freezing the settlement burns firewood, so the colour is a
      // warning rather than decoration.
      this.elements.temperature.classList.toggle('is-freezing', snapshot.temperature < 2);
      this.lastRenderedTemperature = snapshot.temperature;
    }

    if (speed !== this.lastRenderedSpeed) {
      this.renderSpeed(speed);
      this.lastRenderedSpeed = speed;
    }

    if (this.context.saveVersion !== this.lastRenderedSaveVersion) {
      this.elements.saveStatus.textContent = this.context.saveStatus;
      this.lastRenderedSaveVersion = this.context.saveVersion;
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

    // The action depends only on there being a tree, never on which info line
    // is showing. Tying the two together made a tree with someone standing
    // beside it impossible to designate.
    const actionable = selection.treeId !== null || selection.isStoneDeposit;
    this.renderSelectionAction(actionable, selection.designated, selection.treeId !== null);

    // A tapped villager is what the player meant; the tile is the fallback.
    if (selection.villager) {
      const villager = selection.villager;
      this.elements.selectionTerrain.textContent = villager.name;
      this.elements.selectionCell.textContent = `age ${villager.age}`;
      this.elements.selectionFlags.textContent = villager.activity;
      return;
    }

    if (selection.treeId !== null) {
      this.elements.selectionTerrain.textContent = 'Tree';
      this.elements.selectionCell.textContent = `${selection.cell.gx}, ${selection.cell.gy}`;
      this.elements.selectionFlags.textContent = selection.designated ? 'marked for felling' : '';
      return;
    }

    if (selection.isStoneDeposit) {
      this.elements.selectionTerrain.textContent = 'Stone deposit';
      this.elements.selectionCell.textContent = `${selection.cell.gx}, ${selection.cell.gy}`;
      this.elements.selectionFlags.textContent = selection.designated ? 'marked for mining' : '';
      return;
    }

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

  private bindSelectionAction(): void {
    this.elements.selectionAction.addEventListener('click', () => {
      const selection = this.context.selection;
      if (!selection || (selection.treeId === null && !selection.isStoneDeposit)) {
        return;
      }

      if (selection.designated) {
        this.context.cancelSelectedDesignation();
      } else {
        this.context.designateSelectedTree();
      }
      this.update();
    });
  }

  private renderSelectionAction(actionable: boolean, designated: boolean, isTree: boolean): void {
    this.elements.selectionAction.hidden = !actionable;
    if (!actionable) {
      return;
    }
    const verb = isTree ? 'Fell' : 'Mine';
    this.elements.selectionAction.textContent = designated ? 'Cancel' : verb;
    this.elements.selectionAction.classList.toggle('is-cancel', designated);
  }

  private renderSpeed(speed: SimulationSpeed): void {
    for (const button of this.elements.speedButtons) {
      const buttonSpeed = Number(button.dataset['speed']);
      const active = buttonSpeed === speed;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  private bindSessionButtons(): void {
    // Both are async and both disable themselves while running, so an
    // impatient double-tap cannot start two writes at once.
    this.elements.saveButton.addEventListener('click', () => {
      void this.runSession(this.elements.saveButton, () => this.context.save());
    });
    this.elements.loadButton.addEventListener('click', () => {
      void this.runSession(this.elements.loadButton, () => this.context.load());
    });
  }

  private async runSession(button: HTMLButtonElement, action: () => Promise<boolean>) {
    button.disabled = true;
    try {
      await action();
    } finally {
      button.disabled = false;
      this.update();
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

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function terrainName(type: TerrainType): string {
  return TERRAIN[type].name;
}

function collectElements(root: HTMLElement): HudElements {
  return {
    population: requireElement(root, '[data-hud="population"]'),
    resources: {
      food: requireElement(root, '[data-hud="food"]'),
      logs: requireElement(root, '[data-hud="logs"]'),
      firewood: requireElement(root, '[data-hud="firewood"]'),
      stone: requireElement(root, '[data-hud="stone"]'),
    },
    selection: requireElement(root, '[data-hud="selection"]'),
    selectionTerrain: requireElement(root, '[data-hud="selection-terrain"]'),
    selectionCell: requireElement(root, '[data-hud="selection-cell"]'),
    selectionFlags: requireElement(root, '[data-hud="selection-flags"]'),
    selectionAction: requireElement(root, '[data-hud="selection-action"]') as HTMLButtonElement,
    season: requireElement(root, '[data-hud="season"]'),
    temperature: requireElement(root, '[data-hud="temperature"]'),
    speedButtons: Array.from(root.querySelectorAll<HTMLButtonElement>('[data-speed]')),
    saveButton: requireElement(root, '[data-hud="save"]') as HTMLButtonElement,
    loadButton: requireElement(root, '[data-hud="load"]') as HTMLButtonElement,
    saveStatus: requireElement(root, '[data-hud="save-status"]'),
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
