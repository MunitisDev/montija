/**
 * Getting good at a job.
 *
 * A settlement whose people are interchangeable is a settlement nobody minds
 * losing, and until now every villager was exactly as good at everything as
 * every other. Experience is the first thing in the game that makes a *particular
 * person* worth keeping where they are.
 *
 * The design is deliberately narrow, and these tests are mostly about the edges
 * of that narrowness:
 *
 * - **A trade is a building**, which is already how a profession works here.
 * - Experience buys **speed at that trade and nothing else** — no better yields,
 *   no wider range. One number, multiplied where tools and spirit already are.
 * - It is a **bonus, never a penalty**: a beginner works at exactly the rate every
 *   villager in this game has always worked at, so a settlement that never
 *   specialises is not punished, it is simply not collecting.
 * - Nothing **decays**. Moving a master costs the five years it took to make one;
 *   it does not also cost her the trade.
 */

import { describe, expect, it } from 'vitest';

import { WORLD_HEIGHT, WORLD_WIDTH } from '@/app/config';
import { RETIREMENT_AGE, WORKING_AGE } from '@/data/population';
import {
  INHERITED_EXPERIENCE_DAYS,
  SKILL_THRESHOLD_DAYS,
  SKILL_THRESHOLD_YEARS,
  SKILL_WORK_BONUS,
  skillLevelOf,
  skillYears,
} from '@/data/skills';
import { Building } from '@/simulation/buildings/Building';
import { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import { inheritTrades, runSkillDay } from '@/simulation/population/SkillSystem';
import { Simulation } from '@/simulation/Simulation';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { Villager } from '@/simulation/villagers/Villager';

const OPTIONS = { seed: 20260815, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT };

describe('the three levels', () => {
  it('are the years the player asked for', () => {
    expect(SKILL_THRESHOLD_YEARS).toEqual({ apprentice: 1, expert: 2, master: 5 });
  });

  it('leave everybody a beginner for their first year', () => {
    expect(skillLevelOf(0)).toBe('none');
    expect(skillLevelOf(DAYS_PER_YEAR - 1)).toBe('none');
  });

  it('promote on the day the year turns', () => {
    expect(skillLevelOf(SKILL_THRESHOLD_DAYS.apprentice)).toBe('apprentice');
    expect(skillLevelOf(SKILL_THRESHOLD_DAYS.expert)).toBe('expert');
    expect(skillLevelOf(SKILL_THRESHOLD_DAYS.master)).toBe('master');
  });

  it('stay a master for ever after', () => {
    expect(skillLevelOf(SKILL_THRESHOLD_DAYS.master * 6)).toBe('master');
  });

  it('cost a beginner nothing at all', () => {
    // **The whole shape of the system.** A settlement that never keeps anybody in
    // one job runs at exactly the speed this game has always run at.
    expect(SKILL_WORK_BONUS.none).toBe(1);
    expect(SKILL_WORK_BONUS.apprentice).toBeGreaterThan(1);
    expect(SKILL_WORK_BONUS.expert).toBeGreaterThan(SKILL_WORK_BONUS.apprentice);
    expect(SKILL_WORK_BONUS.master).toBeGreaterThan(SKILL_WORK_BONUS.expert);
  });

  it('report whole years, because that is how a player counts', () => {
    expect(skillYears(0)).toBe(0);
    expect(skillYears(DAYS_PER_YEAR * 3 + 5)).toBe(3);
  });
});

describe('learning by doing', () => {
  it('credits a day at a workshop to that trade', () => {
    const { villagers, buildings, worker } = staffed('woodcutter');

    runSkillDay(villagers, buildings);

    expect(worker.experienceAt('woodcutter')).toBe(1);
    expect(worker.experienceAt('quarry')).toBe(0);
  });

  it('reaches each level in the year it should', () => {
    const { villagers, buildings, worker } = staffed('woodcutter');

    for (let day = 0; day < DAYS_PER_YEAR; day += 1) {
      runSkillDay(villagers, buildings);
    }
    expect(worker.skillAt('woodcutter')).toBe('apprentice');

    for (let day = 0; day < DAYS_PER_YEAR; day += 1) {
      runSkillDay(villagers, buildings);
    }
    expect(worker.skillAt('woodcutter')).toBe('expert');

    for (let day = 0; day < DAYS_PER_YEAR * 3; day += 1) {
      runSkillDay(villagers, buildings);
    }
    expect(worker.skillAt('woodcutter')).toBe('master');
  });

  it('says who was promoted, once', () => {
    const { villagers, buildings, worker } = staffed('woodcutter');
    worker.experience.set('woodcutter', SKILL_THRESHOLD_DAYS.apprentice - 1);

    const promotion = runSkillDay(villagers, buildings);
    expect(promotion.promoted).toEqual([
      { villagerId: worker.id, name: worker.name, trade: 'woodcutter', level: 'apprentice' },
    ]);

    // And not again the next day, which would make the HUD shout every morning.
    expect(runSkillDay(villagers, buildings).promoted).toEqual([]);
  });

  it('credits nobody for a job they do not hold', () => {
    const { villagers, buildings, worker } = staffed('woodcutter');
    worker.employerId = null;

    runSkillDay(villagers, buildings);
    expect(worker.experienceAt('woodcutter')).toBe(0);
  });

  it('credits nobody for a yard, which has no craft to it', () => {
    // Otherwise "storage-yard" becomes a profession somebody can master, and a
    // master of standing next to a woodpile is not a thing this game has.
    const { villagers, buildings, worker } = staffed('storage-yard');

    runSkillDay(villagers, buildings);
    expect(worker.experienceAt('storage-yard')).toBe(0);
  });

  it('credits nobody for a workshop that is still being built', () => {
    const { villagers, buildings, worker, building } = staffed('woodcutter');
    // Undo the completion the fixture does, leaving a site.
    const site = new Building(building.id, 'woodcutter', building.origin);
    buildings.clear();
    buildings.restoreOne(site);

    runSkillDay(villagers, buildings);
    expect(worker.experienceAt('woodcutter')).toBe(0);
  });

  it('credits a retired villager with nothing', () => {
    const { villagers, buildings, worker } = staffed('woodcutter');
    worker.age = RETIREMENT_AGE;

    runSkillDay(villagers, buildings);
    expect(worker.experienceAt('woodcutter')).toBe(0);
  });

  it('keeps a trade when somebody is moved off it', () => {
    // Nothing decays. Moving a master costs the five years it took to make her,
    // and does not also cost her the woodcutting.
    const { villagers, buildings, worker } = staffed('woodcutter');
    worker.experience.set('woodcutter', SKILL_THRESHOLD_DAYS.master);
    worker.employerId = null;

    for (let day = 0; day < DAYS_PER_YEAR * 3; day += 1) {
      runSkillDay(villagers, buildings);
    }

    expect(worker.skillAt('woodcutter')).toBe('master');
  });
});

describe('a trade passed down', () => {
  it('starts a master’s child as an apprentice at fourteen', () => {
    const parent = person({ id: 1, age: 40 });
    parent.experience.set('woodcutter', SKILL_THRESHOLD_DAYS.master);
    const child = person({ id: 2, age: WORKING_AGE });
    child.parentIds = [1, 1];

    inheritTrades([parent, child]);

    expect(child.experienceAt('woodcutter')).toBe(INHERITED_EXPERIENCE_DAYS);
    expect(child.skillAt('woodcutter')).toBe('apprentice');
  });

  it('gives an expert’s child nothing, which is what makes five years matter', () => {
    const parent = person({ id: 1, age: 40 });
    parent.experience.set('woodcutter', SKILL_THRESHOLD_DAYS.expert);
    const child = person({ id: 2, age: WORKING_AGE });
    child.parentIds = [1, 1];

    inheritTrades([parent, child]);

    expect(child.experienceAt('woodcutter')).toBe(0);
  });

  it('waits until the child can work', () => {
    const parent = person({ id: 1, age: 40 });
    parent.experience.set('woodcutter', SKILL_THRESHOLD_DAYS.master);
    const child = person({ id: 2, age: WORKING_AGE - 1 });
    child.parentIds = [1, 1];

    inheritTrades([parent, child]);
    expect(child.experienceAt('woodcutter')).toBe(0);

    child.age = WORKING_AGE;
    inheritTrades([parent, child]);
    expect(child.experienceAt('woodcutter')).toBe(INHERITED_EXPERIENCE_DAYS);
  });

  it('gives it once, however many days pass', () => {
    const parent = person({ id: 1, age: 40 });
    parent.experience.set('woodcutter', SKILL_THRESHOLD_DAYS.master);
    const child = person({ id: 2, age: WORKING_AGE });
    child.parentIds = [1, 1];

    for (let day = 0; day < 50; day += 1) {
      inheritTrades([parent, child]);
    }

    expect(child.experienceAt('woodcutter')).toBe(INHERITED_EXPERIENCE_DAYS);
  });

  it('never overwrites what a child has earned for themselves', () => {
    const parent = person({ id: 1, age: 40 });
    parent.experience.set('woodcutter', SKILL_THRESHOLD_DAYS.master);
    const child = person({ id: 2, age: 20 });
    child.parentIds = [1, 1];
    child.experience.set('woodcutter', SKILL_THRESHOLD_DAYS.master);

    inheritTrades([parent, child]);

    expect(child.experienceAt('woodcutter')).toBe(SKILL_THRESHOLD_DAYS.master);
  });

  it('gives a founder nothing to inherit', () => {
    const founder = person({ id: 1, age: 20 });
    inheritTrades([founder]);
    expect(founder.experience.size).toBe(0);
  });
});

describe('the settlement hires the specialist', () => {
  it('takes the experienced hand over the nearer one', () => {
    // A settlement that spends five years making a master woodcutter and then
    // hands the post to whoever was standing closer has thrown those five years
    // away, and the player has no way to see it happen.
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 10 });
    const shop = raise(simulation, 'woodcutter');
    expect(shop).not.toBeNull();

    // The master is parked as far from the door as the map allows and everybody
    // else is stood right beside it, so distance alone would never choose her.
    // Placed *relative to the shop*, because `raise` puts it wherever the map
    // first allows — an absolute corner was the shop's own corner, and the test
    // passed without the rule doing anything.
    const specialist = simulation.villagers.all[0]!;
    specialist.experience.set('woodcutter', SKILL_THRESHOLD_DAYS.master);

    const door = shop!.accessCell;
    for (const villager of simulation.villagers.all) {
      villager.employerId = null;
      villager.workPreference = null;
      villager.position = { wx: door.gx + 0.5, wy: door.gy + 0.5 };
    }
    specialist.position = {
      wx: (door.gx + simulation.world.width / 2) % simulation.world.width,
      wy: (door.gy + simulation.world.height / 2) % simulation.world.height,
    };
    // Guards the test itself: if she is not the furthest, distance could pick her
    // and this proves nothing.
    const furthest = simulation.villagers.all.every(
      (villager) =>
        villager === specialist ||
        Math.hypot(villager.position.wx - door.gx, villager.position.wy - door.gy) <
          Math.hypot(specialist.position.wx - door.gx, specialist.position.wy - door.gy),
    );
    expect(furthest).toBe(true);

    for (let tick = 0; tick < TICKS_PER_DAY; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
    }

    expect(shop!.workers).toContain(specialist.id);
  });

  it('still takes the nearest when nobody has a trade', () => {
    // Nothing changes for a village that has not specialised yet, which is most
    // of them for the first few years.
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 10 });
    const shop = raise(simulation, 'woodcutter');
    for (const villager of simulation.villagers.all) {
      villager.employerId = null;
      villager.workPreference = null;
    }

    for (let tick = 0; tick < TICKS_PER_DAY; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
    }

    expect(shop!.workers.length).toBeGreaterThan(0);
  });

  it('still honours a posting the player made, trade or no trade', () => {
    // The player's instruction beats the settlement's judgement. It always did,
    // and a specialist rule that overrode it would be the game arguing back.
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 10 });
    const shop = raise(simulation, 'woodcutter');
    const specialist = simulation.villagers.all[0]!;
    specialist.experience.set('woodcutter', SKILL_THRESHOLD_DAYS.master);
    const chosen = simulation.villagers.all[1]!;

    for (const villager of simulation.villagers.all) {
      villager.employerId = null;
      villager.workPreference = null;
    }
    chosen.workPreference = shop!.id;

    for (let tick = 0; tick < TICKS_PER_DAY; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
    }

    expect(shop!.workers).toContain(chosen.id);
  });
});

describe('experience survives a save', () => {
  it('keeps every trade and every day of it', async () => {
    const { serialise, restore } = await import('@/simulation/save/serialise');
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 4 });
    const villager = simulation.villagers.all[0]!;
    villager.experience.set('woodcutter', SKILL_THRESHOLD_DAYS.master);
    villager.experience.set('quarry', 7);
    villager.illDaysLived = 30;

    const loaded = new Simulation({ ...OPTIONS, startingVillagers: 4 });
    restore(loaded, serialise(simulation, 'now'));
    const same = loaded.villagers.all.find((other) => other.id === villager.id)!;

    expect(same.experienceAt('woodcutter')).toBe(SKILL_THRESHOLD_DAYS.master);
    expect(same.experienceAt('quarry')).toBe(7);
    expect(same.illDaysLived).toBe(30);
  });
});

/** A villager built directly, for the tests that are about one person. */
function person(options: { id: number; age: number }): Villager {
  return new Villager({
    id: options.id,
    name: `V${options.id} Family`,
    sex: options.id % 2 === 0 ? 'f' : 'm',
    age: options.age,
    position: { wx: 0.5, wy: 0.5 },
    lifespan: 70,
  });
}

/** One villager holding a post at one finished building of the given kind. */
function staffed(trade: 'woodcutter' | 'storage-yard') {
  const buildings = new BuildingRegistry();
  const building = new Building(1, trade, { gx: 0, gy: 0 });
  building.complete();
  buildings.restoreOne(building);

  const worker = person({ id: 1, age: 30 });
  worker.employerId = building.id;

  return { villagers: [worker], buildings, worker, building };
}

/** Places a building and finishes it, so it is ready to be staffed. */
function raise(simulation: Simulation, id: 'woodcutter') {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      if (simulation.canPlaceBuilding(id, { gx, gy }).ok) {
        const building = simulation.placeBuilding(id, { gx, gy });
        if (building) {
          simulation.world.buildings.complete(simulation.world, building);
        }
        return building;
      }
    }
  }
  return null;
}
