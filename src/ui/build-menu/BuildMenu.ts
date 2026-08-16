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
import type { I18n } from '@/ui/i18n/I18n';
import type { MessageKey } from '@/ui/i18n/messages';

/** Refusal reasons, so the player is told what is wrong rather than just "no". */
const REFUSAL_KEY: Readonly<Record<PlacementRefusal, MessageKey>> = {
  'off-map': 'placement.offMap',
  'blocked-terrain': 'placement.blockedTerrain',
  occupied: 'placement.occupied',
  'trees-in-the-way': 'placement.treesInTheWay',
  'needs-rock-face': 'placement.needsRockFace',
};

export class BuildMenu {
  private readonly context: GameContext;
  private readonly i18n: I18n;
  private renderedLanguageVersion = -1;
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly label: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly confirm: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly buttons = new Map<BuildingId, HTMLButtonElement>();
  private renderedPlacementVersion = -1;

  constructor(root: HTMLElement, context: GameContext, i18n: I18n) {
    this.context = context;
    this.i18n = i18n;
    this.root = root;
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
    if (this.i18n.changeVersion !== this.renderedLanguageVersion) {
      this.renderedLanguageVersion = this.i18n.changeVersion;
      this.relabelButtons();
      this.renderedPlacementVersion = -1;
    }

    if (this.renderedPlacementVersion === this.context.placementVersion) {
      return;
    }
    this.renderedPlacementVersion = this.context.placementVersion;

    const placement = this.context.placement;
    this.panel.hidden = placement === null;
    // Short and narrow screens give the placement bar the whole row; the
    // stylesheet decides where that applies, this just reports the state.
    this.root.classList.toggle('is-placing', placement !== null);

    for (const [id, button] of this.buttons) {
      button.classList.toggle('is-active', placement?.buildingId === id);
    }

    if (!placement) {
      return;
    }

    const definition = buildingDefinition(placement.buildingId);
    const cost = definition.constructionCost
      .map((entry) => `${entry.amount} ${this.i18n.t(`hud.${entry.resource}` as MessageKey)}`)
      .join(', ');

    // The description is shown while placing, not only as a hover title: on a
    // tablet there is no hover, and "which building makes food?" has to be
    // answerable without one.
    this.label.textContent = `${this.i18n.t(`building.${definition.id}` as MessageKey)} — ${cost}`;
    this.label.title = this.i18n.t(`building.${definition.id}.description` as MessageKey);
    this.confirm.disabled = !placement.check.ok;
    this.hint.textContent = placement.check.ok
      ? this.i18n.t(`building.${definition.id}.description` as MessageKey)
      : this.i18n.t(REFUSAL_KEY[placement.check.reason]);
    this.hint.classList.toggle('is-refusal', !placement.check.ok);
  }

  private relabelButtons(): void {
    for (const [id, button] of this.buttons) {
      button.textContent = this.i18n.t(`building.${id}` as MessageKey);
      button.title = this.i18n.t(`building.${id}.description` as MessageKey);
    }
    this.confirm.textContent = this.i18n.t('action.place');
    this.cancel.textContent = this.i18n.t('action.cancel');
  }

  private buildButtons(): void {
    for (const id of BUILDING_IDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'build-button';
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
