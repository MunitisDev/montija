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

  const hud = new Hud(hudRoot, game);
  const buildMenu = new BuildMenu(hudRoot, game);

  // Mouse and touch are separate controllers feeding one intent sink, so a
  // hybrid device never processes the same gesture through both paths.
  const pointerController = new PointerController(canvasHost, game.input);
  const touchController = new TouchController(canvasHost, game.input);
  pointerController.attach();
  touchController.attach();

  const debugOverlay = import.meta.env.DEV
    ? new DebugOverlay(requireElement<HTMLPreElement>('#debug-overlay'), game)
    : null;

  if (debugOverlay) {
    const toggle = requireElement<HTMLButtonElement>('#debug-toggle');
    toggle.hidden = false;
    toggle.addEventListener('click', () => debugOverlay.toggle());
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
