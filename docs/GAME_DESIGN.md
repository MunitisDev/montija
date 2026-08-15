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

| Resource | Used for                                  | Keeps?                     |
| -------- | ----------------------------------------- | -------------------------- |
| Food     | eaten, one per villager per day           | no — 10% a day in the open |
| Logs     | construction, and split into firewood     | indefinitely               |
| Firewood | burned, one per villager per freezing day | indefinitely               |
| Stone    | construction                              | indefinitely               |

The settlers arrive with 120 food, 30 logs and 12 stone. The food is about twelve days' grace for
ten villagers — enough to raise a Gatherer Hut without hurrying, and not enough to ignore.

---

## Buildings — Implemented

Definitions live in `src/data/buildings.ts`; the build menu is generated from them.

| Building     | Cost             | Slots | Effect                             |
| ------------ | ---------------- | ----- | ---------------------------------- |
| House        | 8 logs, 4 stone  | —     | houses 4, and heats them           |
| Storage Yard | 6 logs           | —     | stores logs, stone, firewood       |
| Food Storage | 6 logs, 2 stone  | —     | stores food, and keeps it          |
| Gatherer Hut | 10 logs, 2 stone | 2     | forages food, scaled by the season |
| Woodcutter   | 8 logs, 4 stone  | 2     | 1 log → 4 firewood                 |

The settlement is founded with one storage yard already standing, holding the settlers' supplies.
It accepts every resource, which is what a settlers' communal store would — but it is an open yard,
and food does not keep in one. See [Spoilage](#spoilage--implemented).

---

## Spoilage — Implemented

Food rots. It loses a tenth of itself each day in an ordinary yard or lying in the field, and a
hundredth in a Food Storage. Timber, stone and firewood are unaffected: the same timber a year later
is the same timber, and pretending otherwise would be busywork rather than a decision.

This is what gives the Food Storage a reason to exist. Making an ordinary yard _refuse_ food would
have done that too, but it is a wall the player cannot see: a settlement whose food had nowhere to go
would starve beside full piles with nothing on screen explaining why. Spoilage says the same thing
gradually and legibly, and a player who ignores it loses a stockpile rather than a settlement.

Measured across a full year, with the same player building the same three huts:

|                     | Food banked entering winter |
| ------------------- | --------------------------- |
| with a Food Storage | 189                         |
| without one         | 93                          |

Ten villagers eat 120 across a winter, so that gap is the difference between comfort and famine.

Two consequences worth knowing:

- **Haulers take food to the larder in preference to a nearer open yard.** Carrying food past the
  building meant to keep it, to watch it rot somewhere closer, is not what a person would do.
- **Because of that, a larder placed badly costs throughput.** Every load walks further. With a
  large surplus that is easily worth it; with a settlement living hand to mouth it can cost more
  than the spoilage saves. Where the larder goes is a real decision.

Spoilage is deterministic. A settlement losing a random amount each night would be unplannable.

---

## Homes and the years — Implemented

A House shelters four people, and **firewood only warms somebody who has one**.
A settlement with full yards and a healthy woodpile but no houses spends winter
outdoors: measured over a year, that settlement loses everyone on day 44 with
149 food still in store. Somebody sleeping rough gets a quarter of the fire's
benefit — there is a communal hearth, and standing beside it beats nothing.

Villagers age a year for every year of days, and each is born with a lifespan
between 55 and 78 drawn from the seeded stream, so a founding generation does
not die together. Below fifteen they are children: they eat, they do not work,
and they grow up.

A settlement grows when it has earned it — a spare bed, two healthy adults of an
age to raise a child, and twelve days of food per person in store. Growth is
slow on purpose, roughly a couple of children a year at best, because the brief
asks for many years rather than a boom. Measured over six years, a well-run
settlement went from ten to twelve and then stopped, capped by its own housing:
the way to grow is to build.

**Newcomers arrive** at a settlement visibly worth joining: eighteen days of food per person and at
least two empty beds. The bar is deliberately higher than a birth's — a family already living
somewhere will take a chance a stranger on the road will not — and each arrival fills the beds that
attracted it, so a settlement has to keep building to keep growing.

This exists to close a dead end. Without it, a settlement that lost its last adults of childbearing
age could never grow again however well the player then played: the only outcome left was a slow
decline they could watch but not change, which is a failure state that fails to say so.

Two failure modes are real and neither is a bug:

- **Building no houses** kills the settlement in its first winter, however full
  its stores.
- **Building too many** starves it. Houses cost timber and the labour to raise
  them, and a settlement that spends its spring on roofs has no food when the
  cold comes.

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

| The player…                         | Outcome                                            |
| ----------------------------------- | -------------------------------------------------- |
| does nothing at all                 | everyone dead by day 25, during autumn             |
| leaves the food supply until day 25 | everyone dead before the hut is even finished      |
| builds one hut at midsummer         | survives, but reaches spring starving at 40 health |
| builds one hut for ten villagers    | survives with empty stores and hungry people       |
| builds three huts and a larder      | survives comfortably, ending winter with food left |

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

In order of precedence: people starving, people freezing, people with no house as winter approaches,
nobody gathering food, one hut for too many mouths, food rotting with nowhere to keep it, no
woodcutter with winter in sight, not enough firewood to last it.

"People are starving" fires on genuine hunger rather than on a day's missed delivery. A settlement
living hand to mouth has shortfall days routinely while nobody is any thinner, and an alarm that
cries wolf is one the player stops reading.

---

## Telling the player what happened — Implemented

Two channels, deliberately distinct:

- **Advice** is a standing problem to fix, shown as one banner: people starving, no larder, no roof.
- **Notices** are things that have already happened and need no reply — a birth, newcomers arriving,
  a death — drifting up and fading out. A death is coloured differently from a birth, and a death of
  old age is worded differently from one the player caused by running out of food, because only one
  of those is a mistake.

The population moves for four separate reasons, and before this the only sign of any of them was a
number quietly changing in a corner.

**Failure is now stated.** When the last villager is gone the game says so, reports how long the
settlement lasted, and offers the only useful action left: begin again, on a new map. The simulation
had always known — `hasFailed` existed from Phase 8 — and nothing had ever asked it, so a dead
settlement simply carried on being drawn as an empty valley.

---

## Open questions

- **A do-nothing settlement dies in autumn, not winter.** Defensible — doing nothing for
  twenty-five days should be fatal — but it means the first failure most players see is not the one
  the game is named for.
- **Villagers idle around 30% of the time** in the measured runs, mostly when the player has not
  designated enough work. Whether that reads as calm or as broken is a question for a real playtest.
- **No professions.** Villagers take whatever the job board offers rather than holding a trade, so a
  "worker slot" is a post rather than a career.
