# Game Design

Status labels: **Implemented**, **Prototype**, **Planned**.

This document describes what the game currently does. Where a number is quoted, it is the number in
the code, and the figures under [Difficulty](#difficulty) were measured by the headless playtests in
`tests/balance.test.ts` rather than estimated.

---

## The fantasy

Build a small medieval settlement in an unforgiving wilderness and help its inhabitants survive,
grow and prosper over many years. The mood is grounded and slightly melancholic: this is a hard
place, and people can die in it.

The first objective is the MVP's: **survive the first winter**.

---

## The core loop — Implemented

```text
SPRING   build and gather
SUMMER   expand and produce
AUTUMN   prepare
WINTER   consume stored resources and survive
```

A year is four seasons of 12 days; a day is 60 simulation ticks, six seconds at 1x. A full year is
therefore about five minutes of real time at 1x, or roughly 75 seconds at 4x.

Winter is the point of the game. Foraging yields **nothing at all** between the first and last day of
winter, so everything eaten in those twelve days must have been stored during the three before it.

---

## Resources — Implemented

Resources exist physically. When a tree is felled, logs appear **on the ground** where it stood; a
villager must claim a hauling job, walk there, pick them up, carry them to a yard and put them down
before the settlement can spend them. The HUD's totals are a cached summary of what the yards
physically hold, and deliberately exclude what is still lying in the field — that is what the small
`+n` beside a resource means.

| Resource | Used for                                  |
| -------- | ----------------------------------------- |
| Food     | eaten, one per villager per day           |
| Logs     | construction, and split into firewood     |
| Firewood | burned, one per villager per freezing day |
| Stone    | construction                              |

The settlers arrive with 120 food, 30 logs and 12 stone. The food is about twelve days' grace for
ten villagers — enough to raise a Gatherer Hut without hurrying, and not enough to ignore.

---

## Buildings — Implemented

Definitions live in `src/data/buildings.ts`; the build menu is generated from them.

| Building     | Cost             | Slots | Effect                             |
| ------------ | ---------------- | ----- | ---------------------------------- |
| House        | 8 logs, 4 stone  | —     | houses 4                           |
| Storage Yard | 6 logs           | —     | stores logs, stone, firewood       |
| Food Storage | 6 logs, 2 stone  | —     | stores food                        |
| Gatherer Hut | 10 logs, 2 stone | 2     | forages food, scaled by the season |
| Woodcutter   | 8 logs, 4 stone  | 2     | 1 log → 4 firewood                 |

The settlement is founded with one storage yard already standing, holding the settlers' supplies.
That founding yard currently accepts **every** resource, which means the Food Storage building adds
capacity rather than being required. That is a known inconsistency with the two buildings'
descriptions, and is listed under [Open questions](#open-questions).

---

## Work — Implemented

Villagers are autonomous. They do not have a plan; they ask the job board for the best available
work, and the board answers by priority, then by distance, then by job id — the last so that the
simulation stays reproducible.

Priorities, highest first:

| Priority | Work                             | Why                                                                 |
| -------- | -------------------------------- | ------------------------------------------------------------------- |
| urgent   | production                       | a workshop has a fixed number of slots; leaving one empty wastes it |
| high     | construction, hauling to storage | use what you already have before gathering more                     |
| normal   | felling trees, mining stone      | raw material, and the most abundant kind of work                    |

That ordering is load-bearing rather than cosmetic. With production and hauling merely equal to
felling, a player who marked a stand of trees posted dozens of _nearer_ jobs, and the settlement
would starve with fifty food lying in piles beside the hut because nobody would stop chopping long
enough to carry it in. The harder the player worked, the worse they did.

A workshop reserves one slot per worker, not the whole building, so a two-slot hut really does work
two villagers.

---

## Survival — Implemented

Supplies are consumed once a day, at the day boundary, and shared evenly: a half-fed settlement
weakens together rather than having some eat while others starve.

| Rate                   | Value                                                |
| ---------------------- | ---------------------------------------------------- |
| Food eaten             | 1 per villager/day                                   |
| Firewood burned        | 1 per villager per freezing day                      |
| Hunger and warmth lost | 25/day at a full shortfall, in proportion below that |
| Hunger restored        | 20/day when fed in full                              |
| Warmth restored        | 25/day when warm                                     |
| Health lost            | 10/day per exhausted need                            |
| Health restored        | 4/day when neither is exhausted                      |

Decline is deliberately steeper than recovery. It used to be the other way round — 34 restored
against 12 lost — which meant one fed day cancelled nearly three starving ones, a settlement could
live on half rations forever, and winter killed nobody. Poor planning has to cost something.

At the current rates an unfed settlement empties its hunger in four days and buries its first
villager about ten days later: roughly one winter, which is the span the player is asked to plan for.

---

## Difficulty

Measured by `tests/balance.test.ts`, which plays a full year headlessly at four levels of attention.
Because the simulation is pure TypeScript and deterministic from its seed, a year takes a fraction of
a second, so retuning a number is a measurement rather than a five-minute stare at the screen.

| The player…                         | Outcome                                    |
| ----------------------------------- | ------------------------------------------ |
| does nothing at all                 | everyone dead by day 25, during autumn     |
| leaves the food supply until day 15 | everyone dead by day 48, during winter     |
| raises one hut for ten villagers    | survives winter, but ends it at 14 health  |
| raises two huts and stockpiles      | survives, ending winter nearly out of food |

One Gatherer Hut feeds roughly six villagers. Ten need two, and the settlement that has one usually
believes it has solved food — so the HUD says so explicitly rather than leaving the player to lose to
an invisible rule.

The intended shape is that a prepared settlement survives its first winter _narrowly_: in the
measured run above, the well-played settlement ends winter with six food in store and its firewood
already gone.

---

## Guidance — Implemented

The simulation reports the single most urgent thing wrong; the HUD shows it as one banner. One
warning at a time on purpose — the player needs to know what to do next, not everything that could
ever go wrong.

In order of precedence: people starving, nobody gathering food, one hut for too many mouths, no
woodcutter with winter in sight, not enough firewood to last it.

"People are starving" fires on genuine hunger rather than on a day's missed delivery. A settlement
living hand to mouth has shortfall days routinely while nobody is any thinner, and an alarm that
cries wolf is one the player stops reading.

---

## Open questions

- **The founding yard accepts everything**, so Food Storage is optional. Making it a proper Storage
  Yard would give that building a purpose and match its description, but a settlement whose food had
  nowhere to go would starve beside full piles with no warning, so it needs the guidance to land
  first.
- **A do-nothing settlement dies in autumn, not winter.** Defensible — doing nothing for
  twenty-five days should be fatal — but it means the first failure most players see is not the one
  the game is named for.
- **Villagers idle around 30% of the time** in the measured runs, mostly when the player has not
  designated enough work. Whether that reads as calm or as broken is a question for a real playtest.
- **Population never grows.** There is no birth, ageing or immigration yet, so "over many years" is
  not yet true.
