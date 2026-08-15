/**
 * Creates the Phaser instance that renders a {@link GameContext}.
 *
 * All engine configuration lives here so the rest of the renderer never touches
 * global Phaser setup. Swapping renderers later means replacing this file and
 * the scenes, not the simulation.
 */

import Phaser from 'phaser';
import type { GameContext } from '@/game/Game';
import { WORLD_SCENE_KEY, WorldScene } from '@/renderer/phaser/scenes/WorldScene';

export interface PhaserGameOptions {
  readonly parent: HTMLElement;
  readonly context: GameContext;
}

export function createPhaserGame(options: PhaserGameOptions): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.parent,
    backgroundColor: '#12140f',
    scale: {
      // The canvas tracks its parent element; CSS decides the layout, and the
      // renderer follows. This is what makes every aspect ratio work.
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: '100%',
      height: '100%',
    },
    render: {
      antialias: true,
      // Devices report very high ratios; capping keeps fill rate sane on tablets.
      pixelArt: false,
    },
    // The game supplies its own camera controls and HUD buttons.
    input: {
      keyboard: false,
      mouse: true,
      touch: true,
    },
    banner: false,
    scene: [WorldScene],
  });

  game.scene.start(WORLD_SCENE_KEY, { context: options.context });

  return game;
}
