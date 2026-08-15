/**
 * The build menu and placement controls.
 *
 * Buttons are generated from `data/buildings.ts`, so adding a building never
 * means writing menu code — which is exactly what the brief asks for.
 *
 * The placement interaction is deliberately **frame-and-confirm** rather than
 * tap-to-place: the ghost sits at the centre of the view, the player moves the
 * camera to position it, and a large button commits. Tapping a precise cell is
 * hard on a tablet and impossible under your own thumb, and the brief is
 * explicit that placement must not require precision tapping.
 */

import { BUILDING_IDS, buildingDefinition, type BuildingId } from '@/data/buildings';
import type { PlacementRefusal } from '@/simulation/buildings/BuildingRegistry';
import type { GameContext } from '@/game/Game';

/** Plain-English reasons, so the player is told what is wrong. */
const REFUSAL_TEXT: Readonly<Record<PlacementRefusal, string>> = {
  'off-map': 'beyond the map',
  'blocked-terrain': 'ground will not take it',
  occupied: 'something is already here',
  'trees-in-the-way': 'clear the trees first',
};

export class BuildMenu {
  private readonly context: GameContext;
  private readonly bar: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly label: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly confirm: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly buttons = new Map<BuildingId, HTMLButtonElement>();
  private renderedPlacementVersion = -1;

  constructor(root: HTMLElement, context: GameContext) {
    this.context = context;
    this.bar = requireElement(root, '[data-hud="build-bar"]');
    this.panel = requireElement(root, '[data-hud="placement"]');
    this.label = requireElement(root, '[data-hud="placement-label"]');
    this.hint = requireElement(root, '[data-hud="placement-hint"]');
    this.confirm = requireElement(root, '[data-hud="placement-confirm"]') as HTMLButtonElement;
    this.cancel = requireElement(root, '[data-hud="placement-cancel"]') as HTMLButtonElement;

    this.buildButtons();
    this.confirm.addEventListener('click', () => {
      this.context.confirmPlacement();
      this.update();
    });
    this.cancel.addEventListener('click', () => {
      this.context.cancelPlacement();
      this.update();
    });

    this.update();
  }

  /** Refreshes only when placement actually changed. */
  public update(): void {
    if (this.renderedPlacementVersion === this.context.placementVersion) {
      return;
    }
    this.renderedPlacementVersion = this.context.placementVersion;

    const placement = this.context.placement;
    this.panel.hidden = placement === null;

    for (const [id, button] of this.buttons) {
      button.classList.toggle('is-active', placement?.buildingId === id);
    }

    if (!placement) {
      return;
    }

    const definition = buildingDefinition(placement.buildingId);
    const cost = definition.constructionCost
      .map((entry) => `${entry.amount} ${entry.resource}`)
      .join(', ');

    this.label.textContent = `${definition.name} — ${cost}`;
    this.confirm.disabled = !placement.check.ok;
    this.hint.textContent = placement.check.ok ? '' : REFUSAL_TEXT[placement.check.reason];
  }

  private buildButtons(): void {
    for (const id of BUILDING_IDS) {
      const definition = buildingDefinition(id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'build-button';
      button.textContent = definition.name;
      button.title = definition.description;
      button.dataset['building'] = id;

      button.addEventListener('click', () => {
        // Tapping the active building again backs out, so the menu is its own
        // escape hatch and the player is never stuck in placement mode.
        if (this.context.placement?.buildingId === id) {
          this.context.cancelPlacement();
        } else {
          this.context.beginPlacement(id);
        }
        this.update();
      });

      this.buttons.set(id, button);
      this.bar.append(button);
    }
  }
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Build menu is missing a required element: ${selector}`);
  }
  return element;
}
