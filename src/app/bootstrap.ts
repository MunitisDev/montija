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

import { Game } from '@/game/Game';
import { PointerController } from '@/input/PointerController';
import { TouchController } from '@/input/TouchController';
import { createPhaserGame } from '@/renderer/phaser/createPhaserGame';
import { Hud } from '@/ui/hud/Hud';
import { BuildMenu } from '@/ui/build-menu/BuildMenu';
import { I18n } from '@/ui/i18n/I18n';
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

  const game = new Game();
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
  const buildMenu = new BuildMenu(hudRoot, game, i18n);

  // Mouse and touch are separate controllers feeding one intent sink, so a
  // hybrid device never processes the same gesture through both paths.
  const pointerController = new PointerController(canvasHost, game.input);
  const touchController = new TouchController(canvasHost, game.input);
  pointerController.attach();
  touchController.attach();

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
    debugOverlay?.update();
    window.requestAnimationFrame(renderHud);
  };
  window.requestAnimationFrame(renderHud);

  document.body.classList.remove('is-loading');
}

start();
