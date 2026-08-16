/**
 * Application entry point.
 *
 * Wires the layers together in dependency order and starts the frame loop:
 *
 *   input -> Game (commands) -> Simulation -> state -> Phaser / HUD
 *
 * Nothing below reaches backwards through that chain.
 */

import '@/ui/styles/base.css';
import '@/ui/styles/hud.css';
import '@/ui/styles/menu.css';

import { Game } from '@/game/Game';
import { PointerController } from '@/input/PointerController';
import { TouchController } from '@/input/TouchController';
import { createPhaserGame } from '@/renderer/phaser/createPhaserGame';
import { Hud } from '@/ui/hud/Hud';
import { BuildMenu } from '@/ui/build-menu/BuildMenu';
import { Guide } from '@/ui/guide/Guide';
import { Roster } from '@/ui/roster/Roster';
import { SettingsMenu } from '@/ui/settings/SettingsMenu';
import { MainMenu } from '@/ui/menu/MainMenu';
import { I18n } from '@/ui/i18n/I18n';
import { StatsOverlay, requestedVillagers, statsRequested } from '@/ui/StatsOverlay';
import { DebugControls } from '@/debug/DebugControls';
import { DebugOverlay } from '@/debug/DebugOverlay';

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Expected element ${selector} to exist in index.html`);
  }
  return element;
}

export function start(): void {
  const canvasHost = requireElement<HTMLDivElement>('#game-canvas');
  const hudRoot = requireElement<HTMLDivElement>('#hud');

  // `?villagers=N` founds a larger settlement, for measuring the frame rate
  // under load on a real device. Absent, the game starts as it always has.
  const benchmarkVillagers = requestedVillagers(window.location.search);
  const game = new Game(
    benchmarkVillagers === null ? {} : { startingVillagers: benchmarkVillagers },
  );
  const phaserGame = createPhaserGame({ parent: canvasHost, context: game });

  if (import.meta.env.DEV) {
    // Handles for profiling and debugging from the browser console. Dropped
    // from production builds along with the rest of the DEV-only branches.
    Object.assign(window as unknown as Record<string, unknown>, {
      __game: phaserGame,
      __context: game,
    });
  }

  const i18n = new I18n();
  document.documentElement.lang = i18n.language;

  const hud = new Hud(hudRoot, game, i18n);

  // The whole game element, not the canvas: fullscreening the canvas alone
  // would leave the HUD behind in the page.
  const gameRoot = requireElement<HTMLDivElement>('#game');
  const buildMenu = new BuildMenu(hudRoot, game, i18n);

  // These live outside #hud — see index.html for why — so they are looked up
  // from the game root rather than the HUD layer.
  const guide = new Guide(gameRoot, i18n);
  const roster = new Roster(gameRoot, game, i18n);
  const settings = new SettingsMenu({
    root: gameRoot,
    context: game,
    i18n,
    guide,
    fullscreenTarget: gameRoot,
    onFullscreenChange: (active) => hud.setFullscreen(active),
  });
  const mainMenu = new MainMenu(gameRoot, game, i18n, guide);

  /**
   * Opens a sheet with the clock stopped, and puts it back as it was after.
   *
   * Shared by the rules and the people panel because both are things you stop
   * to read: nobody wants winter happening behind a page they are studying,
   * and a player who was already paused should still be paused afterwards.
   */
  const openPaused = (sheet: {
    open: (o: { closeLabel: string; onClose: () => void }) => void;
  }) => {
    const wasPaused = game.clock.isPaused;
    game.clock.pause();
    sheet.open({
      closeLabel: i18n.t('menu.close'),
      onClose: () => {
        if (!wasPaused) {
          game.clock.resume();
        }
      },
    });
  };

  const rosterButton = hudRoot.querySelector<HTMLButtonElement>('[data-ui="roster-open"]');
  rosterButton?.addEventListener('click', () => openPaused(roster));

  // Everything that is not the settlement — rules, save, load, full screen,
  // language — sits behind the cog. Opening it pauses like the other sheets:
  // nobody wants winter happening behind a page they stopped to read.
  const settingsButton = hudRoot.querySelector<HTMLButtonElement>('[data-ui="settings-open"]');
  settingsButton?.addEventListener('click', () => openPaused(settings));

  // Both buttons are glyphs, so their only name is the one assistive technology
  // reads — and that name has to change with the language like every other.
  let labelledLanguageVersion = -1;
  const relabelGlyphs = (): void => {
    if (labelledLanguageVersion === i18n.changeVersion) {
      return;
    }
    labelledLanguageVersion = i18n.changeVersion;
    if (settingsButton) {
      settingsButton.setAttribute('aria-label', i18n.t('settings.title'));
      settingsButton.title = i18n.t('settings.title');
    }
    if (rosterButton) {
      rosterButton.setAttribute('aria-label', i18n.t('roster.open'));
      rosterButton.title = i18n.t('roster.open');
    }
  };
  relabelGlyphs();

  // Mouse and touch are separate controllers feeding one intent sink, so a
  // hybrid device never processes the same gesture through both paths.
  const pointerController = new PointerController(canvasHost, game.input);
  const touchController = new TouchController(canvasHost, game.input);
  pointerController.attach();
  touchController.attach();

  // Kept out of `src/debug` on purpose: that whole folder is stripped from a
  // release, and frame rate is the one measurement that only means anything on
  // the device somebody actually plays on. Hidden unless the URL asks for it.
  const statsOverlay = statsRequested(window.location.search)
    ? new StatsOverlay(hudRoot, game)
    : null;

  const debugOverlay = import.meta.env.DEV
    ? new DebugOverlay(requireElement<HTMLPreElement>('#debug-overlay'), game)
    : null;

  // Built in code, not in index.html, so the bundler drops every trace of it
  // from a production build.
  const debugControls = import.meta.env.DEV ? new DebugControls(hudRoot, game) : null;

  // The overlay starts on screen, so the controls must start there too rather
  // than waiting for a toggle that would then hide both.
  debugControls?.setVisible(debugOverlay?.isVisible ?? false);

  if (debugOverlay) {
    const toggle = requireElement<HTMLButtonElement>('#debug-toggle');
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      debugOverlay.toggle();
      debugControls?.setVisible(debugOverlay.isVisible);
    });
  }

  // The HUD refreshes on its own rAF rather than inside the Phaser scene: DOM
  // work stays out of the render path, and the overlay keeps updating even if
  // the world scene is swapped out.
  const renderHud = (): void => {
    hud.update();
    buildMenu.update();
    settings.update();
    relabelGlyphs();
    debugOverlay?.update();
    statsOverlay?.update();
    window.requestAnimationFrame(renderHud);
  };
  window.requestAnimationFrame(renderHud);

  document.body.classList.remove('is-loading');

  // Last, so the menu opens over a world that is already drawn rather than
  // over the empty canvas of a game still starting up.
  mainMenu.open();
}

start();
