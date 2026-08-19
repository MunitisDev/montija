/**
 * The build menu and placement controls.
 *
 * Buttons are generated from `data/buildings.ts`, so adding a building never
 * means writing menu code — which is exactly what the brief asks for.
 *
 * **Two levels, because seventeen buttons in a strip is not a menu.** The bar
 * carries five categories; tapping one opens a grid of that category's
 * buildings above it. Finding a House used to mean swiping a horizontal
 * scroller past sixteen other things, and the strip only gets longer as the
 * game grows. Five groups of two to four fit on every screen this project
 * targets without scrolling at all, and they keep fitting.
 *
 * What the menu *contains* lives in `buildMenuModel.ts` and is tested
 * headlessly; this file decides only how it looks and what a tap does.
 *
 * The placement interaction is deliberately **frame-and-confirm** rather than
 * tap-to-place: the ghost sits at the centre of the view, the player moves the
 * camera to position it, and a large button commits. Tapping a precise cell is
 * hard on a tablet and impossible under your own thumb, and the brief is
 * explicit that placement must not require precision tapping.
 */

import { buildingDefinition, type BuildingCategory } from '@/data/buildings';
import type { PlacementRefusal } from '@/simulation/buildings/BuildingRegistry';
import type { GameContext } from '@/game/Game';
import type { I18n } from '@/ui/i18n/I18n';
import type { MessageKey } from '@/ui/i18n/messages';
import { buildMenuGroups, type BuildGroup, type BuildOption } from './buildMenuModel';

/** Refusal reasons, so the player is told what is wrong rather than just "no". */
const REFUSAL_KEY: Readonly<Record<PlacementRefusal, MessageKey>> = {
  'off-map': 'placement.offMap',
  'blocked-terrain': 'placement.blockedTerrain',
  occupied: 'placement.occupied',
  'trees-in-the-way': 'placement.treesInTheWay',
  'needs-rock-face': 'placement.needsRockFace',
  'needs-water': 'placement.needsWater',
  'needs-water-nearby': 'placement.needsWaterNearby',
  unreachable: 'placement.unreachable',
  'would-seal': 'placement.wouldSeal',
};

export class BuildMenu {
  private readonly context: GameContext;
  private readonly i18n: I18n;
  private renderedLanguageVersion = -1;
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly buildPanel: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly label: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly confirm: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly categoryButtons = new Map<BuildingCategory, HTMLButtonElement>();
  private renderedPlacementVersion = -1;
  /** The open category, or `null` when the grid is shut. */
  private openCategory: BuildingCategory | null = null;
  /** Stores the grid was last drawn against, so "none of this" stays true. */
  private renderedStores = '';

  constructor(root: HTMLElement, context: GameContext, i18n: I18n) {
    this.context = context;
    this.i18n = i18n;
    this.root = root;
    this.bar = requireElement(root, '[data-hud="build-bar"]');
    this.buildPanel = requireElement(root, '[data-hud="build-panel"]');
    this.panel = requireElement(root, '[data-hud="placement"]');
    this.label = requireElement(root, '[data-hud="placement-label"]');
    this.hint = requireElement(root, '[data-hud="placement-hint"]');
    this.confirm = requireElement(root, '[data-hud="placement-confirm"]') as HTMLButtonElement;
    this.cancel = requireElement(root, '[data-hud="placement-cancel"]') as HTMLButtonElement;

    this.buildCategoryButtons();

    // A tap on the world puts the grid away, the same way the stores drawer
    // behaves. Captured on the document rather than through a backdrop, because
    // a backdrop over the settlement would eat the pan the player is about to
    // make while lining a building up.
    document.addEventListener('pointerdown', (event) => {
      if (this.openCategory === null) {
        return;
      }
      const target = event.target;
      if (
        target instanceof Node &&
        (this.buildPanel.contains(target) || this.bar.contains(target))
      ) {
        return;
      }
      this.setOpenCategory(null);
    });

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
      this.renderedStores = '';
      this.renderGrid();
    }

    // The grid marks a cost the settlement has none of, so it has to follow the
    // stores — but only while it is open, and only when they actually moved.
    if (this.openCategory !== null) {
      const stores = this.storesKey();
      if (stores !== this.renderedStores) {
        this.renderedStores = stores;
        this.renderGrid();
      }
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

    // Placing takes the row, so the grid gets out of the way. Cancelling does
    // not bring it back: the player has said no to this building, and reopening
    // the menu under their thumb is a second decision they did not make.
    if (placement !== null) {
      this.setOpenCategory(null);
    }
    for (const [category, button] of this.categoryButtons) {
      const holdsPlacement =
        placement !== null && buildingDefinition(placement.buildingId).category === category;
      button.classList.toggle('is-active', holdsPlacement || this.openCategory === category);
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
    for (const [category, button] of this.categoryButtons) {
      button.textContent = this.i18n.t(`build.${category}` as MessageKey);
    }
    this.confirm.textContent = this.i18n.t('action.place');
    this.cancel.textContent = this.i18n.t('action.cancel');
  }

  private buildCategoryButtons(): void {
    for (const group of this.groups()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'build-button';
      button.dataset['category'] = group.id;
      button.setAttribute('aria-expanded', 'false');

      button.addEventListener('click', (event) => {
        event.stopPropagation();
        // Tapping the open category shuts it, so the bar is its own escape
        // hatch and the player is never left with a panel they cannot dismiss.
        this.setOpenCategory(this.openCategory === group.id ? null : group.id);
      });

      this.categoryButtons.set(group.id, button);
      this.bar.append(button);
    }
    this.relabelButtons();
  }

  private setOpenCategory(category: BuildingCategory | null): void {
    if (this.openCategory === category) {
      return;
    }
    this.openCategory = category;
    this.buildPanel.hidden = category === null;
    for (const [id, button] of this.categoryButtons) {
      button.setAttribute('aria-expanded', String(id === category));
      button.classList.toggle('is-active', id === category);
    }
    if (category !== null) {
      this.renderedStores = this.storesKey();
      this.renderGrid();
    }
  }

  private groups(): readonly BuildGroup[] {
    return buildMenuGroups(this.context.snapshot().stored, (key) => this.i18n.t(key));
  }

  /** A cheap fingerprint of the stores, so the grid redraws only on a change. */
  private storesKey(): string {
    const stored = this.context.snapshot().stored;
    return Object.values(stored)
      .map((amount) => (amount > 0 ? '1' : '0'))
      .join('');
  }

  private renderGrid(): void {
    if (this.openCategory === null) {
      return;
    }
    const group = this.groups().find((entry) => entry.id === this.openCategory);
    if (!group) {
      return;
    }

    if (group.options.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'build-panel__empty';
      empty.textContent = this.i18n.t('build.none');
      this.buildPanel.replaceChildren(empty);
      return;
    }

    this.buildPanel.replaceChildren(...group.options.map((option) => this.renderOption(option)));
  }

  private renderOption(option: BuildOption): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'build-card';
    card.dataset['building'] = option.id;
    card.title = option.description;
    card.classList.toggle('is-out-of-reach', option.outOfReach);

    const name = document.createElement('span');
    name.className = 'build-card__name';
    name.textContent = option.name;
    card.append(name);

    const cost = document.createElement('span');
    cost.className = 'build-card__cost';
    for (const part of option.cost) {
      const chip = document.createElement('span');
      chip.className = 'build-card__part';
      chip.classList.toggle('is-missing', part.missing);
      chip.textContent = part.text;
      cost.append(chip);
    }
    card.append(cost);

    card.addEventListener('click', (event) => {
      event.stopPropagation();
      // Placing closes the grid, which `update` does via `setOpenCategory`.
      this.context.beginPlacement(option.id);
      this.update();
    });

    return card;
  }
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Build menu is missing a required element: ${selector}`);
  }
  return element;
}
