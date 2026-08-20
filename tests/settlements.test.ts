/**
 * A settlement's name is its save file, and permadeath is what that buys.
 *
 * **One autosave in one slot is fine for a game with one settlement and wrong
 * for a game about founding them.** A player who begins again after a hard
 * winter wants *their* valley back — the one with the bridge in the wrong place
 * and the orchard that finally came in — not whichever run was saved last.
 *
 * So the file is named when the settlement is founded, it writes itself as each
 * year turns, and when the last villager dies it is deleted. That last part is
 * the whole reason the rest of it is shaped this way: a run has to be able to
 * *end*, and leaving the final autosave behind would quietly hand the player a
 * way to un-lose it.
 *
 * The naming rules are pure and tested here beside the machinery they serve,
 * because a rule about words and a rule about disks are easy to conflate and the
 * bugs live exactly where they meet.
 */

import { describe, expect, it } from 'vitest';

import { Game } from '@/game/Game';
import { PLACE_NAMES, suggestedPlaceName } from '@/data/places';
import { summarise } from '@/simulation/save/SaveGame';
import { serialise } from '@/simulation/save/serialise';
import {
  MAX_SETTLEMENT_NAME,
  roman,
  slotFor,
  tidyName,
  uniqueName,
} from '@/simulation/save/settlementName';
import { TICKS_PER_YEAR } from '@/simulation/seasons/SeasonClock';
import { Simulation } from '@/simulation/Simulation';

const SEED = 20260823;

describe('what a settlement may be called', () => {
  it('tidies what was typed rather than refusing it', () => {
    // Trailing spaces, double spaces and a paragraph pasted into the box are all
    // things a player did by accident. An error message is a worse answer than
    // quietly fixing it.
    expect(tidyName('  Peñalba  ')).toBe('Peñalba');
    expect(tidyName('Dos   Aguas')).toBe('Dos Aguas');
    expect(tidyName('   ')).toBe('');
    expect(tidyName('x'.repeat(80)).length).toBe(MAX_SETTLEMENT_NAME);
  });

  it('files two spellings of one name as the same village', () => {
    // Which is what a player who typed it twice meant.
    expect(slotFor('Peñalba')).toBe(slotFor('peñalba'));
    expect(slotFor('Peñalba')).toBe(slotFor(' Peñalba '));
    expect(slotFor('Peñalba')).not.toBe(slotFor('Peñalva'));
  });

  it('never lets two settlements share a name', () => {
    expect(uniqueName('Peñalba', [])).toBe('Peñalba');
    expect(uniqueName('Peñalba', ['Peñalba'])).toBe('Peñalba II');
    expect(uniqueName('Peñalba', ['Peñalba', 'Peñalba II'])).toBe('Peñalba III');
    // And the clash is judged the way the store will judge it, not by spelling.
    expect(uniqueName('peñalba', ['Peñalba'])).toBe('peñalba II');
  });

  it('counts in numerals a village register would use', () => {
    expect(roman(2)).toBe('II');
    expect(roman(4)).toBe('IV');
    expect(roman(9)).toBe('IX');
    expect(roman(14)).toBe('XIV');
    expect(roman(40)).toBe('XL');
  });

  it('suggests a name for the valley on screen, and the same one twice', () => {
    // From the seed rather than rolled, so the place reads as already having a
    // name rather than as a slot machine.
    expect(suggestedPlaceName(SEED)).toBe(suggestedPlaceName(SEED));
    expect(PLACE_NAMES).toContain(suggestedPlaceName(SEED));
  });
});

describe('founding a settlement', () => {
  it('is unsaveable until it has a name', () => {
    // Deliberately: a save *is* a name, so there is nowhere to put an unnamed
    // one. Better refused with a reason than filed somewhere anonymous.
    const game = new Game({ seed: SEED });
    expect(game.settlementName).toBeNull();

    return game.save().then((saved) => {
      expect(saved).toBe(false);
      expect(game.saveStatus).toContain('Name');
    });
  });

  it('writes its first file the moment it is named', async () => {
    const game = new Game({ seed: SEED });
    const name = await game.nameSettlement('Peñalba');

    expect(name).toBe('Peñalba');
    expect(game.settlementName).toBe('Peñalba');
    expect(await game.hasSave()).toBe(true);

    const saves = await game.listSettlements();
    expect(saves).toHaveLength(1);
    expect(saves[0]?.name).toBe('Peñalba');
    expect(saves[0]?.year).toBe(1);
    expect(saves[0]?.population).toBeGreaterThan(0);
  });

  it('refuses a name that is nothing but spaces, and stays unnamed', () => {
    const game = new Game({ seed: SEED });
    return game.nameSettlement('   ').then(async (name) => {
      expect(name).toBe('');
      expect(game.settlementName).toBeNull();
      expect(await game.hasSave()).toBe(false);
    });
  });

  it('gives the second village of the same name a numeral', async () => {
    const game = new Game({ seed: SEED });
    await game.nameSettlement('Peñalba');

    // A new valley in the same session: same store, same name asked for.
    game.startNewSettlement(SEED + 1);
    expect(game.settlementName).toBeNull();
    expect(await game.nameSettlement('Peñalba')).toBe('Peñalba II');

    const saves = await game.listSettlements();
    expect(saves.map((save) => save.name).sort()).toEqual(['Peñalba', 'Peñalba II']);
  });

  it('does not carry the last settlement’s name into a new valley', async () => {
    // Or the first year of a fresh village would overwrite the file of the
    // village the player had just left.
    const game = new Game({ seed: SEED });
    await game.nameSettlement('Peñalba');
    game.startNewSettlement(SEED + 7);

    expect(game.settlementName).toBeNull();
    expect(await game.save()).toBe(false);
  });
});

describe('keeping the record', () => {
  it('writes the year as it turns, over the same file', async () => {
    const game = new Game({ seed: SEED });
    await game.nameSettlement('Ubierna');
    expect((await game.listSettlements())[0]?.year).toBe(1);

    runToYear(game, 2);

    // Still one file, and it is the new year rather than a second copy.
    const saves = await game.listSettlements();
    expect(saves).toHaveLength(1);
    expect(saves[0]?.name).toBe('Ubierna');
    expect(saves[0]?.year).toBe(2);
  });

  it('opens the file it lists, and keeps playing under that name', async () => {
    const game = new Game({ seed: SEED });
    await game.nameSettlement('Somoza');
    const saves = await game.listSettlements();

    game.startNewSettlement(SEED + 3);
    expect(game.settlementName).toBeNull();

    expect(await game.loadSettlement(saves[0]!.slot)).toBe(true);
    expect(game.settlementName).toBe('Somoza');
    // And a save now goes back to that settlement's own file rather than
    // founding a second one.
    expect(await game.save()).toBe(true);
    expect(await game.listSettlements()).toHaveLength(1);
  });
});

describe('permadeath', () => {
  it('deletes the file when the last villager is gone', async () => {
    const game = new Game({ seed: SEED });
    await game.nameSettlement('Yesares');
    expect(await game.hasSave()).toBe(true);

    kill(game);
    // One frame with the clock running is all it takes: the settlement is
    // already over, and the record goes with it.
    game.clock.setSpeed(4);
    game.advance(250);

    expect(game.simulation.hasFailed).toBe(true);
    expect(await game.hasSave()).toBe(false);
    expect(await game.listSettlements()).toHaveLength(0);
    // And the name goes too, so the next valley has to be founded like any
    // other rather than inheriting a dead village's file.
    expect(game.settlementName).toBeNull();
  });

  it('leaves other settlements alone when one dies', async () => {
    const game = new Game({ seed: SEED });
    await game.nameSettlement('Ardaña');
    game.startNewSettlement(SEED + 11);
    await game.nameSettlement('Gorbea');

    kill(game);
    game.clock.setSpeed(4);
    game.advance(250);

    const saves = await game.listSettlements();
    expect(saves.map((save) => save.name)).toEqual(['Ardaña']);
  });
});

describe('a save from before settlements had names', () => {
  it('is still listed, under a placeholder', () => {
    // Those settlements were founded before anybody asked. Refusing to show
    // them would be the update quietly eating a player's village.
    const simulation = new Simulation({
      seed: SEED,
      worldWidth: 48,
      worldHeight: 48,
      startingVillagers: 4,
    });
    const nameless = serialise(simulation, 'now');
    expect(nameless.settlementName).toBeUndefined();

    const summary = summarise('autosave', nameless);
    expect(summary.name).not.toBe('');
    expect(summary.year).toBe(1);
  });

  it('reads its year off the clock rather than guessing', () => {
    const simulation = new Simulation({
      seed: SEED,
      worldWidth: 48,
      worldHeight: 48,
      startingVillagers: 4,
    });
    simulation.restoreClock(TICKS_PER_YEAR * 3, 0);
    expect(summarise('slot', serialise(simulation, 'now', 'Tejadillo')).year).toBe(4);
  });
});

// --- helpers ---------------------------------------------------------------

/**
 * Winds the clock to just short of a year's turn, then runs across it.
 *
 * **Jumped rather than played, and deliberately.** A settlement left to itself
 * for a year dies — no houses, no harvest — and a dead settlement has its file
 * deleted, which is the *other* rule this file tests and would quietly swallow
 * this one. What is being measured here is the moment the year rolls over, so
 * that is the only part worth simulating.
 */
function runToYear(game: Game, year: number): void {
  const eve = TICKS_PER_YEAR * (year - 1) - 20;
  game.simulation.restoreClock(eve, 0);
  game.clock.restore(eve, 4);

  for (let frame = 0; frame < 400 && game.simulation.year.year < year; frame += 1) {
    game.advance(250);
  }
  expect(game.simulation.year.year).toBe(year);
  expect(game.simulation.hasFailed).toBe(false);
}

/** Empties the settlement, which is the one way a run ends. */
function kill(game: Game): void {
  for (const villager of [...game.simulation.villagers.all]) {
    game.simulation.villagers.remove(villager.id);
  }
}
