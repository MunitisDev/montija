/**
 * What the first frame of a settlement looks like, and what it does not do.
 *
 * Two small things, both asked for from play, and both about giving the player
 * the moment before the year starts running.
 */

import { describe, expect, it } from 'vitest';

import { WORLD_HEIGHT, WORLD_WIDTH } from '@/app/config';
import { Game } from '@/game/Game';
import { gridToScene } from '@/shared/math/isometric';

describe('a new settlement', () => {
  it('begins with the clock stopped', () => {
    // The first thing to do in this game is read the ground — where the river
    // runs, where the rock is, which way the wood lies — and deciding that against
    // a running clock means deciding it badly.
    const game = new Game({ seed: 20260816 });
    game.startNewSettlement();

    expect(game.clock.isPaused).toBe(true);
    expect(game.clock.tick).toBe(0);
  });

  it('still remembers what speed to come back to', () => {
    // Paused is not the same as speed zero being the only speed there is: the
    // player presses a speed button and the year starts, and pause afterwards has
    // to return them to the speed they chose.
    const game = new Game({ seed: 20260816 });
    game.startNewSettlement();
    game.clock.resume();

    expect(game.clock.isPaused).toBe(false);
    expect(game.clock.speed).toBeGreaterThan(0);
  });

  it('opens looking at the camp', () => {
    const game = new Game({ seed: 20260816 });
    game.startNewSettlement();
    const camp = gridToScene(game.simulation.world.landfallCell);

    // Within a cell of it: the camera clamps, and on a corner-founded map the
    // clamp is what stops it from centring exactly.
    expect(Math.abs(game.camera.view.centreX - camp.px)).toBeLessThan(64);
    expect(Math.abs(game.camera.view.centreY - camp.py)).toBeLessThan(64);
  });
});

describe('the camera and the edge of the map', () => {
  it('can put any corner tile in the middle of the screen', () => {
    // **Building is done by moving the ghost, and the ghost sits at the centre of
    // the view** — so wherever the camera centre cannot go, nothing can be built.
    // The clamp used to hold the whole visible rectangle inside the world, which
    // meant the centre could never come within half a screen of an edge and the
    // corners of the map were simply not places a player could put a house.
    const game = new Game({ seed: 20260816 });
    const corners = [
      { gx: 0, gy: 0 },
      { gx: WORLD_WIDTH - 1, gy: 0 },
      { gx: 0, gy: WORLD_HEIGHT - 1 },
      { gx: WORLD_WIDTH - 1, gy: WORLD_HEIGHT - 1 },
    ];

    for (const corner of corners) {
      const scene = gridToScene(corner);
      game.camera.centreOn(scene);

      expect(game.camera.view.centreX, `${corner.gx},${corner.gy} x`).toBeCloseTo(scene.px, 3);
      expect(game.camera.view.centreY, `${corner.gx},${corner.gy} y`).toBeCloseTo(scene.py, 3);
    }
  });

  it('does not follow the camera off the map altogether', () => {
    // The centre stays over the scene. Empty ground past the edge of the world is
    // honest — there is nothing there — but the world drifting out of shot is not.
    const game = new Game({ seed: 20260816 });
    game.camera.centreOn({ px: 900_000, py: 900_000 });

    const bounds = game.simulation.world.sceneBounds;
    expect(game.camera.view.centreX).toBeLessThanOrEqual(bounds.maxX);
    expect(game.camera.view.centreY).toBeLessThanOrEqual(bounds.maxY);
  });
});
