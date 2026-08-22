/**
 * The fight, and the one rule it is built on: **a wolf is worth a person.**
 *
 * The player asked for that in as many words, and it turns out to be the whole
 * design. If a wolf and an armed villager are exactly equal then nothing about a
 * fight is a die roll — the outcome is *numbers*, and numbers are something the
 * player decides. Two wolves kill one villager. Two villagers kill one wolf.
 * Nobody wins a fair one-on-one: both sides go down together, which is precisely
 * why a settlement must never send one person.
 *
 * ```text
 *                  vigour   per tick   1v1 against a wolf
 * wolf               100       2.0     —
 * villager, armed    100       2.0     both die
 * villager, bare     100       1.4     the villager dies, the wolf lives
 * ```
 *
 * **Damage is simultaneous**, and that is what makes "equal" mean equal: both
 * sides are read before either is written, so two equal fighters reach zero on
 * the same tick and both are lost. Resolving one side first would hand the win to
 * whichever happened to be earlier in an array, which is the sort of unfairness
 * nobody can see and everybody feels.
 *
 * **No dice at all.** Not one call to a random stream lives in this file, which is
 * why the fair-damage system the player asked for is also perfectly reproducible:
 * the same settlement, the same pack and the same tools always end the same way.
 * What decides a fight is how many came, whether they had tools, and whether the
 * wall held — three things the player chose seasons earlier.
 *
 * **What the tools are.** The settlement's `tools` are handed out when the alarm
 * goes up: a hoe, a billhook, a felling axe. There are only so many, so a
 * settlement that has never built a Blacksmith fights with its hands and loses
 * people it would otherwise have kept — the first time in this game that tools are
 * a defence rather than a work bonus.
 */

import type { Villager } from '@/simulation/villagers/Villager';
import type { Wolf } from './Wolf';

/**
 * How much fight there is in one wolf, and in one person.
 *
 * The same number for both, which is the point. A hundred rather than one, so
 * that a wound is a *quantity* the game can talk about — half-mauled means
 * something — without any of it being fractional in the places it is displayed.
 */
export const WOLF_VIGOUR = 100;
export const VILLAGER_VIGOUR = 100;

/**
 * What a wolf takes out of whoever it is biting, per tick.
 *
 * Two, so a fight lasts fifty ticks — five seconds at 1x, a second and a bit at
 * 4x. Long enough to watch and to send help, short enough that a settlement is
 * not paused for a minute of biting.
 */
export const WOLF_BITE = 2;

/** What somebody with a tool in their hands gives back. Equal, by design. */
export const ARMED_BLOW = 2;

/**
 * And what somebody with nothing gives back.
 *
 * Seven tenths, which is exactly enough to lose a one-on-one: bare-handed, a
 * villager takes a wolf down to thirty and dies doing it. Two of them still win,
 * so a toolless settlement is not defenceless — it is *worse off*, which is the
 * difference between a hardship and a wall.
 */
export const BARE_BLOW = 1.4;

/** How much of a wound a day of ordinary living heals. */
export const WOUND_HEALING_PER_DAY = 12;

/** One villager and one wolf, biting each other for one tick. */
export interface Exchange {
  readonly villager: Villager;
  readonly wolf: Wolf;
  /** Whether this villager got one of the settlement's tools. */
  readonly armed: boolean;
}

export interface CombatReport {
  /** Villagers who fell, by id. */
  readonly fallen: readonly number[];
  /** Wolves killed, by id. */
  readonly slain: readonly number[];
}

export const NO_COMBAT: CombatReport = { fallen: [], slain: [] };

/**
 * Resolves one tick of fighting.
 *
 * Every pairing is read first and written second — see the header — so the order
 * of the list cannot decide who wins.
 */
export function exchangeBlows(pairings: readonly Exchange[]): CombatReport {
  const wolfDamage = new Map<number, number>();
  const villagerDamage = new Map<number, number>();

  for (const { villager, wolf, armed } of pairings) {
    const blow = armed ? ARMED_BLOW : BARE_BLOW;
    wolfDamage.set(wolf.id, (wolfDamage.get(wolf.id) ?? 0) + blow);
    villagerDamage.set(villager.id, (villagerDamage.get(villager.id) ?? 0) + WOLF_BITE);
  }

  const fallen: number[] = [];
  const slain: number[] = [];
  const seenWolves = new Set<number>();
  const seenVillagers = new Set<number>();

  for (const { villager, wolf } of pairings) {
    if (!seenWolves.has(wolf.id)) {
      seenWolves.add(wolf.id);
      wolf.vigour -= wolfDamage.get(wolf.id) ?? 0;
      if (wolf.vigour <= 0) {
        slain.push(wolf.id);
      }
    }
    if (!seenVillagers.has(villager.id)) {
      seenVillagers.add(villager.id);
      villager.wounds += villagerDamage.get(villager.id) ?? 0;
      if (villager.wounds >= VILLAGER_VIGOUR) {
        fallen.push(villager.id);
      }
    }
  }

  return { fallen, slain };
}

/**
 * How many of the settlement's defenders have a tool in their hands.
 *
 * The store is not emptied and nothing is consumed: the tools are handed out and
 * handed back, which is what happens to a village's tools in an afternoon. What
 * the number does is decide who fights at full strength — see {@link BARE_BLOW}.
 */
export function armedCount(toolsInStore: number, defenders: number): number {
  return Math.max(0, Math.min(defenders, Math.floor(toolsInStore)));
}
