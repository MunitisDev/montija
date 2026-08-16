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
import type { GameContext } from '@/game/Game';
import type { SimulationSnapshot } from '@/simulation/Simulation';
import { SIMULATION_SPEEDS, type SimulationSpeed } from '@/simulation/SimulationClock';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { LANGUAGES, type I18n, type Language } from '@/ui/i18n/I18n';
import type { MessageKey } from '@/ui/i18n/messages';

/** Elements the HUD binds to, looked up once. */
interface HudElements {
  readonly population: HTMLElement;
  readonly resources: Readonly<Record<ResourceId, HTMLElement>>;
  readonly selection: HTMLElement;
  readonly selectionTerrain: HTMLElement;
  readonly selectionCell: HTMLElement;
  readonly selectionFlags: HTMLElement;
  readonly selectionAction: HTMLButtonElement;
  readonly selectionRoad: HTMLButtonElement;
  readonly season: HTMLElement;
  readonly temperature: HTMLElement;
  readonly advice: HTMLElement;
  readonly events: HTMLElement;
  readonly building: HTMLElement;
  readonly buildingName: HTMLElement;
  readonly buildingState: HTMLElement;
  readonly buildingDetail: HTMLElement;
  readonly failure: HTMLElement;
  readonly failureSurvived: HTMLElement;
  readonly failureRestart: HTMLButtonElement;
  readonly language: HTMLButtonElement;
  readonly fullscreen: HTMLButtonElement | null;
  readonly speedButtons: readonly HTMLButtonElement[];
  readonly saveButton: HTMLButtonElement;
  readonly loadButton: HTMLButtonElement;
  readonly saveStatus: HTMLElement;
}

export class Hud {
  private readonly context: GameContext;
  private readonly i18n: I18n;
  private readonly root: HTMLElement;
  private renderedLanguageVersion = -1;
  private readonly elements: HudElements;
  private lastRenderedSpeed: SimulationSpeed | null = null;
  private lastRenderedPopulation = -1;
  private lastRenderedSelection = -1;
  /** Stored totals last written to the DOM, so unchanged values are skipped. */
  private readonly lastRenderedTotals = new Map<ResourceId, number>();
  /** Loose totals last written, tracked apart from stored ones. */
  private readonly lastRenderedLoose = new Map<ResourceId, number>();
  private lastRenderedSaveVersion = -1;
  private lastRenderedAdvice: string | null | undefined;
  private lastRenderedFailure: string | null | undefined;
  /** The last day whose events were announced, so each is announced once. */
  private lastAnnouncedDay = -1;
  private lastRenderedSeason = '';
  private isFullscreen = false;
  private lastRenderedTemperature = Number.NaN;

  constructor(root: HTMLElement, context: GameContext, i18n: I18n) {
    this.context = context;
    this.i18n = i18n;
    this.root = root;
    this.elements = collectElements(root);
    this.bindSpeedButtons();
    this.bindSelectionAction();
    this.bindRoadAction();
    this.bindSessionButtons();
    this.bindLanguageButton();
    this.elements.failureRestart.addEventListener('click', () => {
      this.context.startNewSettlement();
      // `undefined` means "not yet drawn". `null` is a real value here — it is
      // what "the settlement is fine" looks like — so using it as the reset
      // sentinel left the panel on screen over the new settlement.
      this.lastRenderedFailure = undefined;
      this.update();
    });
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

    // A language change invalidates every string, so force a full redraw
    // rather than trying to work out which labels happen to differ.
    if (this.i18n.changeVersion !== this.renderedLanguageVersion) {
      this.renderedLanguageVersion = this.i18n.changeVersion;
      this.applyStaticText();
      this.invalidateAll();
    }

    if (snapshot.villagerCount !== this.lastRenderedPopulation) {
      this.elements.population.textContent = String(snapshot.villagerCount);
      this.lastRenderedPopulation = snapshot.villagerCount;
    }

    // Population is read outside the resource loop below, so it needs its own
    // naming — otherwise it is the one icon with nothing to say for itself.
    const populationLabel = this.i18n.t('hud.population');
    const populationRow = this.elements.population.parentElement;
    if (populationRow && populationRow.title !== populationLabel) {
      populationRow.title = populationLabel;
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
      // The caption is hidden on very short screens, where five bare numbers
      // are otherwise a guessing game. The title survives that.
      const label = this.i18n.t(`hud.${resource}` as MessageKey);
      if (element.parentElement && element.parentElement.title !== label) {
        element.parentElement.title = label;
      }

      if (this.lastRenderedLoose.get(resource) !== loose) {
        element.dataset['loose'] = loose > 0 ? `+${loose}` : '';
        // Said in words as well as symbols: "Food 0 +50" is alarming until you
        // know the 50 is real and merely still in the field.
        element.title = loose > 0 ? `${label}: +${loose} ${this.i18n.t('hud.looseHint')}` : '';
        this.lastRenderedLoose.set(resource, loose);
      }
    }

    const seasonLabel = [
      this.i18n.t(`season.${snapshot.season}` as MessageKey),
      `${this.i18n.t('time.yearShort')}${snapshot.year}`,
      `${this.i18n.t('time.dayShort')}${snapshot.dayOfSeason}`,
    ].join(' · ');
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

    const advice = snapshot.advice;
    if (advice !== this.lastRenderedAdvice) {
      this.elements.advice.hidden = advice === null;
      if (advice) {
        this.elements.advice.textContent = this.i18n.t(`warning.${advice}` as MessageKey);
      }
      this.lastRenderedAdvice = advice;
    }

    this.announceEvents(snapshot);

    // The settlement is over. Said plainly, with the only action left.
    const failureKey = snapshot.hasFailed
      ? `${snapshot.year}-${snapshot.season}-${snapshot.dayOfSeason}`
      : null;
    if (failureKey !== this.lastRenderedFailure) {
      this.elements.failure.hidden = !snapshot.hasFailed;
      if (snapshot.hasFailed) {
        const survived = [
          this.i18n.t('failure.survived'),
          `${this.i18n.t('time.yearShort')}${snapshot.year}`,
          this.i18n.t(`season.${snapshot.season}` as MessageKey),
          `${this.i18n.t('time.dayShort')}${snapshot.dayOfSeason}`,
        ].join(' · ');
        this.elements.failureSurvived.textContent = survived;
      }
      this.lastRenderedFailure = failureKey;
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

  /**
   * Announces what happened overnight.
   *
   * The population moves for four different reasons and, until this existed,
   * the only sign of any of them was a number quietly changing in the corner —
   * so a settlement could gain two people or bury one and the player would have
   * no idea which had happened, or why.
   *
   * Once a day, and only for days that actually brought news.
   */
  private announceEvents(snapshot: SimulationSnapshot): void {
    const day = Math.floor(snapshot.tick / TICKS_PER_DAY);
    if (day === this.lastAnnouncedDay) {
      return;
    }
    // A restart winds the clock back; announcing the whole first day again is
    // better than going silent until the settlement catches up.
    const isFirstLook = this.lastAnnouncedDay < 0 || day < this.lastAnnouncedDay;
    this.lastAnnouncedDay = day;
    if (isFirstLook) {
      return;
    }

    const { population, lastDay } = snapshot;
    // Deaths of old age are counted separately from the ones the player caused
    // by running out of food or firewood, because only one of those is a
    // mistake and they should not read the same.
    const fromHardship = Math.max(0, lastDay.deaths);

    this.announce('event.born', population.births);
    this.announce('event.arrived', population.arrivals);
    this.announce('event.diedOfOldAge', population.deathsOfOldAge);
    this.announce('event.died', fromHardship);
  }

  private announce(key: MessageKey, count: number): void {
    if (count <= 0) {
      return;
    }

    const notice = document.createElement('div');
    notice.className = 'events__notice';
    notice.textContent = count > 1 ? `${this.i18n.t(key)} (${count})` : this.i18n.t(key);
    if (key === 'event.died' || key === 'event.diedOfOldAge') {
      notice.classList.add('is-loss');
    }

    this.elements.events.append(notice);
    // Removed on the animation's own end rather than on a timer, so the two can
    // never disagree about how long a notice lasts.
    notice.addEventListener('animationend', () => notice.remove());
  }

  /**
   * Describes the building the player tapped.
   *
   * Until this existed a settlement builder let you raise a workshop and never
   * ask what it was doing — which is the half of the game that comes after
   * building it. The lines answer the questions a player actually has: is it
   * finished, what is it still waiting for, is anybody working it, what is
   * inside.
   */
  private renderBuildingPanel(): void {
    const building = this.context.selection?.building ?? null;
    this.elements.building.hidden = building === null;
    if (!building) {
      return;
    }

    this.elements.buildingName.textContent = this.i18n.t(
      `building.${building.buildingId}` as MessageKey,
    );

    if (!building.complete) {
      const percent = Math.round(building.progress * 100);
      this.elements.buildingState.textContent = `${this.i18n.t('building.underConstruction')} ${percent}%`;
      // Materials are reported apart from progress, because "waiting for stone"
      // and "half built" are different problems with different answers.
      this.elements.buildingDetail.textContent =
        building.missingMaterials.length > 0
          ? `${this.i18n.t('building.waitingFor')}: ${this.describeAmounts(building.missingMaterials)}`
          : '';
      return;
    }

    const state: string[] = [];
    if (building.workerSlots > 0) {
      state.push(`${this.i18n.t('building.workers')} ${building.workers}/${building.workerSlots}`);
    }
    if (building.housing > 0) {
      state.push(`${this.i18n.t('building.residents')} ${building.residents}/${building.housing}`);
    }
    this.elements.buildingState.textContent = state.join(' · ');

    // A workshop with nobody in it looks identical to a working one, and the
    // difference is the whole reason a settlement starves with a hut standing.
    if (building.workerSlots > 0 && building.workers === 0) {
      this.elements.buildingDetail.textContent = this.i18n.t('building.idleNoWorkers');
      return;
    }

    this.elements.buildingDetail.textContent =
      building.contents.length > 0
        ? `${this.i18n.t('building.holding')} ${this.describeAmounts(building.contents)}`
        : '';
  }

  private describeAmounts(amounts: readonly { resource: ResourceId; amount: number }[]): string {
    return amounts
      .map((entry) => `${entry.amount} ${this.i18n.t(`hud.${entry.resource}` as MessageKey)}`)
      .join(', ');
  }

  private renderSelection(): void {
    this.renderBuildingPanel();
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
    this.renderRoadAction(selection);

    // A tapped villager is what the player meant; the tile is the fallback.
    if (selection.villager) {
      const villager = selection.villager;
      this.elements.selectionTerrain.textContent = villager.name;
      this.elements.selectionCell.textContent = `${this.i18n.t('villager.age')} ${villager.age}`;
      this.elements.selectionFlags.textContent = this.i18n.t(
        `villager.${villager.activity}` as MessageKey,
      );
      return;
    }

    if (selection.treeId !== null) {
      this.elements.selectionTerrain.textContent = this.i18n.t('terrain.tree');
      this.elements.selectionCell.textContent = `${selection.cell.gx}, ${selection.cell.gy}`;
      this.elements.selectionFlags.textContent = selection.designated
        ? this.i18n.t('status.markedForFelling')
        : '';
      return;
    }

    if (selection.isStoneDeposit) {
      this.elements.selectionTerrain.textContent = this.i18n.t('terrain.stoneDeposit');
      this.elements.selectionCell.textContent = `${selection.cell.gx}, ${selection.cell.gy}`;
      this.elements.selectionFlags.textContent = selection.designated
        ? this.i18n.t('status.markedForMining')
        : '';
      return;
    }

    this.elements.selectionTerrain.textContent = this.i18n.t(
      `terrain.${selection.terrain}` as MessageKey,
    );
    this.elements.selectionCell.textContent = `${selection.cell.gx}, ${selection.cell.gy}`;

    const flags: string[] = [];
    if (selection.hasRoad) {
      flags.push(this.i18n.t('status.road'));
    } else if (selection.roadDesignated) {
      flags.push(this.i18n.t('status.roadOrdered'));
    }
    if (!selection.walkable) {
      flags.push(this.i18n.t('terrain.impassable'));
    }
    if (!selection.buildable) {
      flags.push(this.i18n.t('terrain.cannotBuild'));
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

  private bindRoadAction(): void {
    this.elements.selectionRoad.addEventListener('click', () => {
      this.context.toggleSelectedRoad();
      this.update();
    });
  }

  /**
   * The road button, which says what it will do rather than what the cell is.
   *
   * Hidden entirely on cells that cannot take one — water, rock, a standing
   * tree — because a permanently disabled button on a bottom bar this small
   * costs more room than it earns.
   */
  private renderRoadAction(selection: {
    hasRoad: boolean;
    roadDesignated: boolean;
    canPave: boolean;
  }): void {
    const available = selection.hasRoad || selection.roadDesignated || selection.canPave;
    this.elements.selectionRoad.hidden = !available;
    if (!available) {
      return;
    }

    const undoing = selection.hasRoad || selection.roadDesignated;
    this.elements.selectionRoad.textContent = this.i18n.t(
      selection.hasRoad
        ? 'action.liftRoad'
        : selection.roadDesignated
          ? 'action.cancel'
          : 'action.pave',
    );
    this.elements.selectionRoad.classList.toggle('is-cancel', undoing);
  }

  private renderSelectionAction(actionable: boolean, designated: boolean, isTree: boolean): void {
    this.elements.selectionAction.hidden = !actionable;
    if (!actionable) {
      return;
    }
    const verb = this.i18n.t(isTree ? 'action.fell' : 'action.mine');
    this.elements.selectionAction.textContent = designated ? this.i18n.t('action.cancel') : verb;
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

  private bindLanguageButton(): void {
    this.elements.language.addEventListener('click', () => {
      const next = LANGUAGES[(LANGUAGES.indexOf(this.i18n.language) + 1) % LANGUAGES.length];
      this.i18n.setLanguage(next as Language);
      this.update();
    });
  }

  /** Writes the labels that never change except with the language. */
  /**
   * Names the fullscreen button for what it will do next.
   *
   * Driven by the browser's own event rather than by the click, because the
   * player can leave fullscreen with Escape or a system gesture and a button
   * still offering to enter it would be lying.
   */
  public setFullscreen(active: boolean): void {
    this.isFullscreen = active;
    // The stylesheet decides what full screen means for the layout; this only
    // reports the state, which is the same split the placement bar uses.
    this.root.classList.toggle('is-fullscreen', active);
    this.labelFullscreenButton();
  }

  private labelFullscreenButton(): void {
    const button = this.elements.fullscreen;
    if (!button) {
      return;
    }
    const label = this.i18n.t(this.isFullscreen ? 'action.exitFullscreen' : 'action.fullscreen');
    button.setAttribute('aria-label', label);
    button.title = label;
    button.classList.toggle('is-active', this.isFullscreen);
  }

  private applyStaticText(): void {
    this.elements.failureRestart.textContent = this.i18n.t('failure.restart');
    this.labelFullscreenButton();
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) {
      const key = element.dataset['i18n'] as MessageKey | undefined;
      if (key) {
        element.textContent = this.i18n.t(key);
      }
    }
    this.elements.saveButton.textContent = this.i18n.t('action.save');
    this.elements.loadButton.textContent = this.i18n.t('action.load');
    this.elements.language.textContent = this.i18n.language.toUpperCase();
  }

  /** Forces every cached readout to redraw. */
  private invalidateAll(): void {
    this.lastRenderedPopulation = -1;
    this.lastRenderedSelection = -1;
    this.lastRenderedSpeed = null;
    this.lastRenderedSeason = '';
    this.lastRenderedTemperature = Number.NaN;
    this.lastRenderedAdvice = undefined;
    this.lastRenderedFailure = undefined;
    this.lastRenderedTotals.clear();
    this.lastRenderedLoose.clear();
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
    population: requireElement(root, '[data-hud="population"]'),
    resources: {
      food: requireElement(root, '[data-hud="food"]'),
      logs: requireElement(root, '[data-hud="logs"]'),
      firewood: requireElement(root, '[data-hud="firewood"]'),
      stone: requireElement(root, '[data-hud="stone"]'),
      iron: requireElement(root, '[data-hud="iron"]'),
      tools: requireElement(root, '[data-hud="tools"]'),
    },
    selection: requireElement(root, '[data-hud="selection"]'),
    selectionTerrain: requireElement(root, '[data-hud="selection-terrain"]'),
    selectionCell: requireElement(root, '[data-hud="selection-cell"]'),
    selectionFlags: requireElement(root, '[data-hud="selection-flags"]'),
    selectionAction: requireElement(root, '[data-hud="selection-action"]') as HTMLButtonElement,
    selectionRoad: requireElement(root, '[data-hud="selection-road"]') as HTMLButtonElement,
    season: requireElement(root, '[data-hud="season"]'),
    temperature: requireElement(root, '[data-hud="temperature"]'),
    advice: requireElement(root, '[data-hud="advice"]'),
    fullscreen: root.querySelector<HTMLButtonElement>('[data-hud="fullscreen"]'),
    events: requireElement(root, '[data-hud="events"]'),
    building: requireElement(root, '[data-hud="building"]'),
    buildingName: requireElement(root, '[data-hud="building-name"]'),
    buildingState: requireElement(root, '[data-hud="building-state"]'),
    buildingDetail: requireElement(root, '[data-hud="building-detail"]'),
    failure: requireElement(root, '[data-hud="failure"]'),
    failureSurvived: requireElement(root, '[data-hud="failure-survived"]'),
    failureRestart: requireElement(root, '[data-hud="failure-restart"]') as HTMLButtonElement,
    language: requireElement(root, '[data-hud="language"]') as HTMLButtonElement,
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
