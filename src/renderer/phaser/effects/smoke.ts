/**
 * Hearth smoke: the thing that makes a settlement look lived in.
 *
 * A village of static boxes reads as a diagram of a village. One thread of
 * smoke leaving a roof and bending away on the wind does more for "people live
 * here" than any amount of detail carved into the walls, and it is the one item
 * on the art bible's mood list — *smoke, mist, rain, snowfall* — that says
 * somebody is home rather than that weather is happening.
 *
 * Pure, and deliberately so. The maths is here with no Phaser and no DOM, so
 * the behaviour that actually matters — smoke rises, drifts, thins and dies,
 * and never grows without bound — can be tested headlessly. The renderer beside
 * this file only decides what colour to paint it.
 *
 * It is **presentation only**. Every random number comes from the caller's
 * presentation stream, never a simulation one: a puff of smoke must never be
 * able to shift where a villager walks, and a settlement's history has to
 * replay identically however the wind blew.
 */

import type { Season } from '@/simulation/seasons/SeasonClock';

export interface SmokeParticle {
  /** Scene-space position, in pixels. */
  x: number;
  y: number;
  /** Seconds since it left the chimney. */
  age: number;
  /** Seconds it will last. */
  life: number;
  /** Sideways speed, in pixels per second. Its own, so a plume frays. */
  drift: number;
  /** Upward speed, in pixels per second. */
  rise: number;
  /** Radius at birth, in pixels. */
  size: number;
}

/**
 * The wind, as a constant.
 *
 * One direction for the whole map and the whole game. A turning wind is a
 * lovely idea and a bad one here: every plume would swing together like a
 * shoal, which reads as one system animating rather than as fifty separate
 * fires.
 */
export const WIND_X = 7;

/** How long a puff lasts, before its own variation. */
const BASE_LIFE = 3.4;

/**
 * Puffs per second from one chimney, before the season has its say.
 *
 * **Twice what it was, at half the size.** A plume is made of many small puffs
 * fraying apart; at two and a half a second, growing fast, it came out as three
 * or four grey balls stacked over the roof — which reads as a bug rather than as
 * smoke. More and smaller costs nothing worth measuring: a puff is one filled
 * circle, and the whole settlement is still capped by {@link MAX_PARTICLES}.
 */
const BASE_RATE = 4;

/**
 * How hard each season's fires are burning.
 *
 * Winter is the point: a settlement in January should be visibly *working* at
 * staying warm. Summer is not zero, because a hearth is also where the cooking
 * happens, and a village with no smoke at all in July looks abandoned.
 */
const SEASON_RATE: Readonly<Record<Season, number>> = {
  winter: 1.6,
  autumn: 1.0,
  spring: 0.85,
  summer: 0.5,
};

/**
 * The most puffs allowed alive at once, across the whole settlement.
 *
 * A hard ceiling rather than a target. Thirty houses each emitting freely is
 * several hundred filled circles a frame, which is affordable — but the count has
 * to be bounded by something other than optimism, because the number of houses is
 * not.
 *
 * Raised from 420 when the puffs got smaller and more numerous. The figure to
 * keep it above is *houses × the size a winter plume settles at*, or the cap
 * starts cutting plumes short in ordinary play, which looks like fires going out.
 */
export const MAX_PARTICLES = 900;

/** Seconds between puffs from one chimney in a given season. */
export function emissionInterval(season: Season): number {
  return 1 / (BASE_RATE * SEASON_RATE[season]);
}

/**
 * Makes one puff at a chimney mouth.
 *
 * `random` is the presentation stream: `0..1`, and never a simulation source.
 */
export function emit(x: number, y: number, random: () => number): SmokeParticle {
  return {
    x,
    y,
    age: 0,
    life: BASE_LIFE * (0.7 + random() * 0.6),
    // Each puff carries its own drift and rise, so a column frays into a plume
    // instead of rising as a rigid string of beads.
    drift: WIND_X * (0.6 + random() * 0.8),
    rise: 13 + random() * 8,
    size: 1.7 + random() * 1.5,
  };
}

/**
 * Advances every puff, and drops the ones that have gone.
 *
 * Mutates the array in place and returns it: this runs every frame for every
 * fire in the settlement, and allocating a new array each time would be the
 * one genuinely hot allocation in the renderer.
 */
export function advanceSmoke(particles: SmokeParticle[], deltaSeconds: number): SmokeParticle[] {
  let kept = 0;

  for (const particle of particles) {
    particle.age += deltaSeconds;
    if (particle.age >= particle.life) {
      continue;
    }

    particle.y -= particle.rise * deltaSeconds;
    particle.x += particle.drift * deltaSeconds;
    // Smoke slows as it cools and spreads. Without this a plume is a straight
    // ramp; with it, it leans over and flattens out the way one actually does.
    particle.rise *= 1 - 0.55 * deltaSeconds;

    particles[kept] = particle;
    kept += 1;
  }

  particles.length = kept;
  return particles;
}

/** How solid a puff is now. Fades in fast, out slowly. */
export function puffAlpha(particle: SmokeParticle): number {
  const t = particle.age / particle.life;
  if (t >= 1) {
    return 0;
  }
  // A short fade-in stops puffs popping into existence at full strength on the
  // chimney lip, which is where the eye is.
  const fadeIn = Math.min(1, t / 0.12);
  const fadeOut = 1 - t;
  // Tuned by looking at it. At 0.38 the plume was there and invisible at a
  // glance, which defeats the only thing it is for; much above 0.6 it stops
  // being smoke and starts being a cloud sitting on the roof.
  return 0.55 * fadeIn * fadeOut * fadeOut;
}

/** How wide a puff is now. Smoke expands as it cools. */
export function puffRadius(particle: SmokeParticle): number {
  return particle.size * (1 + particle.age * 0.55);
}
