/**
 * Hearth smoke.
 *
 * A village of static boxes reads as a diagram of a village. One thread of
 * smoke bending off a roof does more for "people live here" than any amount of
 * detail carved into the walls — so it is worth having, and worth being sure it
 * behaves.
 *
 * Two of these tests are about looks and one is about not setting the machine
 * on fire. A particle system with no ceiling is the classic way to turn a
 * pleasant effect into a frame-rate bug six months later, and the ceiling is
 * only real if something checks it.
 */

import { describe, expect, it } from 'vitest';

import { chimneyMouth, chimneyOffset } from '@/renderer/phaser/terrain/buildingArt';
import { BUILDING_IDS } from '@/data/buildings';
import {
  MAX_PARTICLES,
  WIND_X,
  advanceSmoke,
  emissionInterval,
  emit,
  puffAlpha,
  puffRadius,
  type SmokeParticle,
} from '@/renderer/phaser/effects/smoke';
import { SEASONS } from '@/simulation/seasons/SeasonClock';

/** A predictable stand-in for the presentation random stream. */
function steady(value = 0.5): () => number {
  return () => value;
}

function puff(): SmokeParticle {
  return emit(100, 100, steady());
}

describe('a puff of smoke', () => {
  it('rises', () => {
    const particle = puff();
    const startY = particle.y;
    advanceSmoke([particle], 0.5);
    expect(particle.y).toBeLessThan(startY);
  });

  it('drifts downwind', () => {
    const particle = puff();
    const startX = particle.x;
    advanceSmoke([particle], 0.5);
    expect(particle.x - startX).toBeGreaterThan(0);
    expect(WIND_X).toBeGreaterThan(0);
  });

  it('slows as it cools, so a plume leans over instead of ramping', () => {
    const particle = puff();
    const first = particle.rise;
    advanceSmoke([particle], 1);
    expect(particle.rise).toBeLessThan(first);
  });

  it('spreads as it ages', () => {
    const particle = puff();
    const born = puffRadius(particle);
    advanceSmoke([particle], 1.5);
    expect(puffRadius(particle)).toBeGreaterThan(born);
  });

  it('fades in rather than popping on at the chimney lip', () => {
    // The lip is exactly where the eye is, so a puff appearing at full strength
    // there is the one place the effect would look cheap.
    const particle = puff();
    const atBirth = puffAlpha(particle);
    advanceSmoke([particle], 0.4);
    expect(puffAlpha(particle)).toBeGreaterThan(atBirth);
  });

  it('fades out to nothing', () => {
    const particle = puff();
    particle.age = particle.life * 0.999;
    expect(puffAlpha(particle)).toBeLessThan(0.01);
    expect(puffAlpha(particle)).toBeGreaterThanOrEqual(0);
  });

  it('is never more solid than a wisp', () => {
    // Smoke, not a cloud sitting on the roof.
    const particle = puff();
    for (let step = 0; step < 40; step += 1) {
      expect(puffAlpha(particle)).toBeLessThan(0.6);
      advanceSmoke([particle], 0.1);
    }
  });
});

describe('a plume', () => {
  it('drops its puffs once they have gone', () => {
    const particles = [puff()];
    advanceSmoke(particles, 100);
    expect(particles).toEqual([]);
  });

  it('does not grow without bound while a fire burns', () => {
    // The test that matters for the frame rate. Emission is capped by the
    // caller, but a plume must also die off on its own: if puffs outlived their
    // replacement rate the array would climb for as long as the game ran.
    const particles: SmokeParticle[] = [];
    const interval = emissionInterval('winter');
    let sinceLast = 0;

    for (let step = 0; step < 4000; step += 1) {
      const delta = 1 / 60;
      sinceLast += delta;
      if (sinceLast >= interval) {
        sinceLast = 0;
        particles.push(emit(0, 0, steady(0.9)));
      }
      advanceSmoke(particles, delta);
    }

    // **Settled, not merely small.** The claim is that a plume reaches a steady
    // size and stays there, and a bare threshold tests that only by accident —
    // it needed re-tuning the first time the emission rate changed, which is a
    // test measuring the wrong thing. So the plume is measured twice, a
    // thousand frames apart, and asked to have stopped growing.
    const settled = particles.length;
    for (let step = 0; step < 1000; step += 1) {
      const delta = 1 / 60;
      sinceLast += delta;
      if (sinceLast >= interval) {
        sinceLast = 0;
        particles.push(emit(0, 0, steady(0.9)));
      }
      advanceSmoke(particles, delta);
    }

    expect(particles.length).toBe(settled);
    // And a plume is a plume rather than a cloud: one chimney's worth of smoke
    // has to leave room for a settlement of them inside MAX_PARTICLES.
    expect(settled).toBeLessThan(MAX_PARTICLES / 30);
  });

  it('leaves room for a whole settlement inside the ceiling', () => {
    // Thirty chimneys should fit comfortably; the cap is a backstop against a
    // settlement nobody has imagined yet, not a limit on ordinary play. A winter
    // plume settles at about twenty-two puffs, so thirty of them is the number
    // the ceiling has to clear.
    expect(MAX_PARTICLES).toBeGreaterThan(30 * 25);
  });

  it('frays rather than rising as a string of beads', () => {
    // Each puff carries its own drift and rise, so two puffs from the same
    // chimney must not travel identically.
    let seed = 0;
    const varying = (): number => {
      seed += 0.37;
      return seed % 1;
    };
    const a = emit(0, 0, varying);
    const b = emit(0, 0, varying);
    expect(a.drift === b.drift && a.rise === b.rise && a.life === b.life).toBe(false);
  });
});

describe('how hard the fires burn', () => {
  it('is heaviest in winter and lightest in summer', () => {
    // A settlement in January should look like it is working at staying warm.
    expect(emissionInterval('winter')).toBeLessThan(emissionInterval('autumn'));
    expect(emissionInterval('autumn')).toBeLessThan(emissionInterval('summer'));
  });

  it('never stops entirely, because a hearth is also a kitchen', () => {
    for (const season of SEASONS) {
      expect(emissionInterval(season), season).toBeGreaterThan(0);
      expect(Number.isFinite(emissionInterval(season)), season).toBe(true);
    }
  });
});

describe('where the smoke comes from', () => {
  it('is only the buildings with a hearth', () => {
    const withFires = BUILDING_IDS.filter((id) => chimneyOffset(id) !== null);
    expect(withFires).toContain('house');
    expect(withFires.length).toBeGreaterThan(0);
    // Not everything. A settlement where every shed smokes reads as a
    // settlement on fire.
    expect(withFires.length).toBeLessThan(BUILDING_IDS.length);
  });

  it('never smokes out of a field or an open yard', () => {
    expect(chimneyOffset('crop-field')).toBeNull();
    expect(chimneyOffset('orchard')).toBeNull();
    expect(chimneyOffset('storage-yard')).toBeNull();
  });

  it('leaves from the top of the stack, above the roof', () => {
    // Emitting from the base of the chimney would put the plume inside the
    // thatch, which is both wrong and alarming.
    for (const id of BUILDING_IDS) {
      const stack = chimneyOffset(id);
      const mouth = chimneyMouth(id);
      if (!stack || !mouth) {
        continue;
      }
      expect(mouth.dy, id).toBeLessThan(stack.dy);
      expect(mouth.dx, id).toBe(stack.dx);
      // Above the anchor, which is the ground: a chimney below ground level
      // would mean the offsets had lost their sign somewhere.
      expect(mouth.dy, id).toBeLessThan(0);
    }
  });
});
