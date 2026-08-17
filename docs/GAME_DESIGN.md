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

## Where they came from — Implemented

**They left.** One night something came out of the dark into their village.
Nobody saw clearly what it was, and nobody stayed to find out. Ten of them walked
out with what they could carry.

That is deliberately all of it. The less the game says about what came, the more
room there is for the thing the player eventually has to build walls against —
and a premise that explains itself has nothing left to reveal.

> **The shipwreck this replaced.** The settlers used to be castaways, and it read
> well until the rest of the game caught up with it: strangers walk in to join a
> settlement and a merchant calls every twelve days, neither of which happens on
> an unreachable coast. A premise that the systems contradict is worse than a
> plainer one they agree with. The rescue arc it existed to support — a School, a
> bottle on the tide and a ship forty years later — went with it.

Every map still has a coast: one edge is ocean, chosen from the seed and produced
by subtracting a falloff from the same elevation noise as everything else, so the
waterline wanders into inlets and headlands instead of ruling a straight blue line
down one side. Only one edge — a settlement ringed by water is a different game
and a much smaller map. It gives the settlement one side it cannot be approached
from, which is worth having when the walls arrive.

The settlers make camp within sight of the water, and **the starting yard is what
they carried**. The camera opens on it, so the first thing anybody sees is their
own people.

What is in that bundle says the same thing the premise does:

| Carried      | Why                                                           |
| ------------ | ------------------------------------------------------------- |
| 45 logs      | Worth the weight: the first two or three buildings            |
| 156 food     | Fifteen days for ten mouths, most of which rots first         |
| 8 iron       | Taken because it was valuable, useless until there is a smith |
| **no stone** | Nobody flees carrying rock                                    |

**No stone is the interesting one.** It makes the first morning of the game a
search rather than a shopping trip. It also forced a change: the Gatherer Hut
costs timber only now, because with stone in its price a settlement playing well
starved on day 22 of three seeds out of four while hunting a deposit it could
not eat. Wood gets you fed; stone is for everything that has to last.

**Ten people, and three of them are young.** The founding party is seven grown-ups
and three near-adults of fourteen to seventeen. That is both what a group leaving
in the night looks like and a fix for a real problem: the founders' own children
are not eighteen until year eighteen, so without them a village's working
population barely moves for a decade and a half and then arrives all at once.

Measured across 24 seeds, a well-played settlement comes through its first year
without a death on only 2 of them, and most of the deaths moved from starving in
spring to failing in winter, which is the failure this game is about. See
[Difficulty](#why-they-die--measured-not-fixed) for what kills the rest.

**The rations they carried are fifteen days, not fifteen days of slack.** They were
raised from 120 to 156 to widen the opening, and the measured effect was much
smaller than the number suggests: food rots at a tenth a day and the camp's own
store is an open yard, so the pile decays as it is eaten and is gone in about ten days
whatever size it starts at. Thirty per cent more food moved the first death of a
do-nothing settlement by **one day**, and changed the outcome of a well-played or
half-played year on **not one seed measured**. Anything given to the opening
has to survive the night before it can help, which is a point about the Food
Storage rather than about generosity.

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

The settlers arrive with 156 food, 45 logs, 8 iron and **no stone** — see
[Where they came from](#where-they-came-from--implemented) for why each. On paper the food is fifteen
days' grace for ten villagers; in practice it is about ten, because it is sitting in an open yard
losing a tenth of itself every night.

---

## Buildings — Implemented

Definitions live in `src/data/buildings.ts`; the build menu is generated from them.

| Building     | Cost             | Slots | Effect                               |
| ------------ | ---------------- | ----- | ------------------------------------ |
| House        | 8 logs, 4 stone  | —     | 4 grown-ups + their children, heated |
| Storage Yard | 6 logs           | —     | stores logs, stone, firewood         |
| Food Storage | 6 logs, 2 stone  | —     | stores food, and keeps it            |
| Gatherer Hut | 10 logs, 2 stone | 2     | forages food, scaled by the season   |
| Woodcutter   | 8 logs, 4 stone  | 2     | 1 log → 4 firewood                   |

Later buildings are listed under the systems they belong to. Two of them serve
[Illness](#illness--implemented):

| Building        | Cost             | Slots | Effect                                     |
| --------------- | ---------------- | ----- | ------------------------------------------ |
| Herbalist's Hut | 8 logs           | 1     | gathers herbs while things grow; they keep |
| Healer's House  | 14 logs, 8 stone | 2     | shortens illness, spending herbs           |

A Healer's House needs both halves. Unstaffed, or with an empty shelf, it treats nobody — which is
what keeps the Herbalist's Hut from being decoration beside it.

The settlement is founded with one storage yard already standing, holding the settlers' supplies.
It accepts every resource, which is what a settlers' communal store would — but it is an open yard,
and food does not keep in one. See [Spoilage](#spoilage--implemented).

Nothing may be built on standing forest, and nothing stands on a road: a building takes the road up
beneath it when it is placed, and the founding camp clears its own nine cells when the settlers come
ashore. Nothing is salvaged from that clearing — they pushed the scrub aside dragging cargo up the
beach rather than stacking timber.

### What a building can make — Implemented

Every post filled, in the building's best season. **Shown in the building's own panel**, derived from
the recipe rather than written down, so retuning a recipe moves the figure with it. It is a ceiling:
real output falls short of it for travel, hauling and illness, and rises above it with tools and a
settled village.

| Building        | At best                  | Uses            |
| --------------- | ------------------------ | --------------- |
| Gatherer Hut    | 24 food a day (summer)   | —               |
| Crop Field      | 34.7 food a day (autumn) | —               |
| Orchard         | 52.8 food a day (autumn) | —               |
| Hunter's Lodge  | 17.5 food + 6.5 hides    | —               |
| Herbalist's Hut | 8 herbs a day (summer)   | —               |
| **Quarry**      | **10.3 stone a day**     | —               |
| Mine            | 2.7 iron a day           | —               |
| Woodcutter      | 16 firewood a day        | 4 logs          |
| Blacksmith      | 6 tools a day            | 4 iron + 2 logs |
| Tailor          | 4.4 clothing a day       | 6.5 hides       |

**The Forester's Lodge is not on that list, because it makes nothing.** It works on the map instead:
it plants saplings and marks surplus trees for felling, keeping about 110 trees standing inside a
radius of 10. Its yield is the wood still standing in ten years, which is not a number a day — so its
panel quotes no rate rather than a misleading zero.

Two figures worth comparing, since they are the ones the first winter turns on: a Quarry is 10.3 stone
a day from three workers, and a Woodcutter turns 4 logs into 16 firewood a day from two. Ten villagers
burn 10 firewood on a freezing day, so one Woodcutter covers a settlement of that size with room to
spare — provided it ever gets built. See
[Difficulty](#the-measurement-that-settles-it).

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

A House shelters a family, and **firewood only warms somebody who has one**.
A settlement with full yards and a healthy woodpile but no houses spends winter
outdoors: measured over a year, that settlement loses everyone on day 44 with
149 food still in store. Somebody sleeping rough gets a quarter of the fire's
benefit — there is a communal hearth, and standing beside it beats nothing.

### The four ages of a villager — Implemented

One number used to do three jobs, and separating them is what makes a household a
household:

| From | What changes                                                                |
| ---- | --------------------------------------------------------------------------- |
| 0    | A child. Eats, grows up, lives with its parents wherever they live.         |
| 14   | **Works.** Fetches, carries, takes a post — and is still a child at home.   |
| 18   | **A grown-up.** Marries, may take a house, occupies one of its four places. |
| 60   | **Retired.** Still eats, still needs a fire, does not work.                 |

A house holds **four grown-ups and as many of their children as they have**. That
is the change that matters: it used to hold four _residents_, so a couple with two
children filled a cottage and the settlement stopped having children at all.

Villagers age a year for every year of days, and each is born with a lifespan
between 64 and 76 drawn from the seeded stream — about seventy — so a founding
generation does not die together.

**Illness shortens a life.** Every twelve days a villager spends unwell costs them
a year off the end. This is the whole return on a Healer's House: it shortens
cases, shorter cases cost fewer years, so life expectancy is something the player
builds rather than something the seed decides. Measured on a well-tended
settlement, mean expected lifespan comes out at 69–70.

### Couples — Implemented

A pairing needs both people **18 or over** and **no more than six years apart**,
and it matches the closest in age rather than whoever arrived first — lining the
unattached up by id and matching them off married a nineteen year old to a forty
year old whenever that was the order they turned up in.

There is **no upper age limit**, because widowhood has none: a widow of fifty who
finds somebody her own age is a household, and refusing to model it left every
survivor of a long marriage alone for the rest of a seventy-year life. Bearing
children still stops at forty-two.

### Growth — Implemented

A settlement grows when it has earned it: a household with a roof of its own, two
healthy parents of an age, and twelve days of food per person in store.

**Every couple gets its own chance each day.** This used to be one roll for the
whole village, so eight households grew no faster than two and the ceiling was
about two children a year whatever the player did. A player reported the result
from a long game — _"year six, no trouble, and the population has settled at
twenty, so I have buildings with nobody in them"_ — and measured on a kept-fed,
kept-housed settlement it was exactly that: 24 people in year four, still 24 in
year twenty. Sixteen years flat.

Measured on the same fixture after the change: 35 people by year two, 63 by year
six, and thereafter limited by housing — grown children with nowhere to live show
up as homeless, which is the game asking for another house.

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
| normal   | felling, mining, laying roads    | raw material and improvements: the most abundant kind of work       |
| low      | demolition                       | tearing down is never more urgent than feeding anybody              |

That ordering is load-bearing rather than cosmetic. With production and hauling merely equal to
felling, a player who marked a stand of trees posted dozens of _nearer_ jobs, and the settlement
would starve with fifty food lying in piles beside the hut because nobody would stop chopping long
enough to carry it in. The harder the player worked, the worse they did.

A workshop reserves one slot per worker, not the whole building, so a two-slot hut really does work
two villagers.

---

## Land, and what it gives back — Implemented

The map used to be a resource that could only shrink. A felled tree was gone for
good and a worked-out deposit became grass, so a settlement of forty in its sixth
year ran out of everything with no move left to make — a failure that is
arithmetic rather than a decision.

The answer is an **asymmetry**, and it is the spine of the mid-game:

| Resource | How it lasts                                  | What it asks of the player                       |
| -------- | --------------------------------------------- | ------------------------------------------------ |
| Timber   | Renewable                                     | Manage it: leave stands standing, or run a lodge |
| Stone    | Finite on the ground, permanent from a quarry | Pay for it: a large piece of land, forever       |
| Iron     | Only from a mine                              | The same, and slower                             |
| Food     | Renewable, but seasonal                       | Time it: sow in spring, eat in winter            |

### Woodland — Implemented

A lodge keeps a **standing order** of a handful of felling jobs and posts no
more until somebody has worked them. Without that cap it added three orders
every couple of seconds for as long as it stood, villagers cut far slower, and
the marks piled up without bound — from the player's side it looked exactly as
though the trees were being felled on their own. Measured before the fix: 158
marks standing by day 30 with almost none of them being worked, and the wood
still growing faster than it was cut, so the orders were doing nothing but
covering the map.

Woods seed into ground beside them, once a day, slowly. A sapling needs **at
least two tree neighbours**, which is what makes it a wood rather than a weed:
clearings fill back in from the trees around them, and open meadow far from any
wood stays meadow. Nothing grows within two cells of a finished building —
cleared land stays cleared, or the player is being handed a chore rather than a
decision.

Natural spread stops at roughly a third of the map. Without a ceiling a wood's
edge advances one cell at a time forever and eventually there is nothing to build
on; it was measured over twelve simulated years before the ceiling went in.

A **Forester's Lodge** does the rest. Below its target density it plants; at or
above it it fells. Its felling is posted as ordinary work, so its timber flows
through the same fell → logs → haul → yard pipeline as anything the player marks
themselves. Crucially it **plants past the natural ceiling**: the wilderness
returns only so much, and anything beyond that is something you did on purpose.

### Stone and iron — Implemented

Surface deposits are consumed for good. The permanent supply is a **Quarry** or a
**Mine**, and both must be **dug into a rock face** — the footprint has to be
ordinary buildable ground, because people have to stand somewhere, but the
working face must be next to it. That is what makes them a decision about
_where_ rather than merely about _whether_. There is no demolition in this game,
so wherever one goes it stays.

Both are slower per unit than picking a deposit up off the ground. If a quarry
beat gathering, the deposits scattered over the map would be scenery.

### Clothing — Implemented

Warmth came from one place — a house with firewood in it — so a settlement short
of either had nothing to fall back on, and the loss curve was identical whether
they were a day short or a season short.

A **Hunter's Cabin** brings in meat _and_ hides, and a **Tailor** sews the hides
into clothing. Two goods from one hunt is what stops clothing being a chore
bolted onto an economy with no room for it — the cabin is worth building for the
food alone.

A coat does not replace a hearth. Its share of warmth is well under the fire's,
and the two add up rather than compete, capped so that being fully clothed _and_
fully warmed is no better than being fully warmed. What it buys is time:
measured, a settlement with an empty woodshed lasts **17 days** clothed against
**13** bare, against a season of 15. With coats an empty woodshed is a winter you
get through; without, it kills you before the thaw. Two winters without a fire
is not survivable however well dressed, or houses would be optional.

It is also the only thing that helps somebody with **no roof at all**, who gets
just a quarter of a fire's warmth.

Coats wear out only in the cold, and nothing is taken from a settlement that has
none — an unclothed village is exactly as warm as it always was.

**Hunting is the only work that still pays under snow.** Foraging, fields and
orchards all yield nothing in winter; game is lean in spring, fat before the
cold, and still there in January. That is what makes a settlement built on
foraging alone find winter so much harder than one that hunts.

### Tools — Implemented

Iron would otherwise be a number in the HUD that goes up, and a resource with
nothing to spend it on is clutter dressed as content. A **Blacksmith** forges
iron and logs into **tools**, and tools make every job in the settlement up to
half again quicker.

Deliberately a bonus and never a tax: a settlement with no forge works at exactly
the rate it always did. Wear is charged daily against working adults, and nothing
is taken from a settlement that has none.

### Fields and orchards — Implemented

Foraging is a steady trickle through the growing seasons. A **Field** is nothing
much until it is harvested. An **Orchard** is nothing at all until autumn, and
then the best yield in the game — and it takes far the longest to establish, so
planting one is a bet on a later autumn rather than a purchase.

|          | Spring | Summer | Autumn | Winter |
| -------- | ------ | ------ | ------ | ------ |
| Foraging | 0.8    | 1.4    | 1.0    | 0      |
| Field    | 0.25   | 0.8    | 1.9    | 0      |
| Orchard  | 0      | 0.7    | 2.4    | 0      |

A settlement that lives on foraging survives hand to mouth. One that farms has to
store what it brings in and make it last — which is the lesson winter teaches,
arriving a season early.

---

## Trade — Implemented

Every other system in this game turns land into goods. This one turns goods into
other goods, and it exists for one reason: **some maps do not have what a
settlement needs.** A seed with no rock within reach cannot build a quarry, and
no amount of good play makes iron appear. Without a way to swap, that is not a
hard start but an unwinnable one — and the player cannot tell which they have
been given.

- A **Trading Post** is a building like any other, hauled to and hauled from. It
  employs nobody: the merchant does the trading, and the settlement's part is
  having hauled a surplus into its yards.
- A **merchant calls** every twelve days for three, and never in winter. Trade is
  a road and a cart, and neither works under snow.
- While one is there, the post swaps the settlement's **largest surplus** for
  whatever it is **shortest of**, at **three to one**.

The rate is bad on purpose. Trade must never be the efficient way to get
anything: a settlement that trades its way through the game has stopped playing
it. This is the answer to "this map has no iron", not to "I would rather not
build a quarry".

Two safeguards, both of which exist because their absence would read as the game
working against the player:

- **Food and firewood are never sold**, however much of either is in the yards.
  Selling the last of the firewood in November because it outnumbered the iron
  would be indefensible. Both may be _bought_ — a merchant is exactly who you
  want to see in a bad autumn.
- **A surplus has to be a real one.** Below a floor, a settlement is not rich in
  something, it merely happens to have some.

The player may **name what to buy and what to sell** from the post's panel, or
leave either on automatic. Automatic is the default and stays useful — a
settlement rarely wants anything other than "get rid of the thing I have most
of, get the thing I have least of" — and naming it matters when the biggest
surplus is not the one the settlement is willing to part with.

Naming a good does not override the safeguards: it still has to clear the
surplus floor, and food and firewood are still never sold however they are
asked. Offering a choice the game then quietly ignores would be worse than not
offering it.

---

## How work is chosen — Implemented

Every job carries a priority, and a villager takes the highest-priority job they
are allowed to do, breaking ties on distance and then on job id so a settlement
replayed from its seed behaves identically.

| Priority   | Work                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| **urgent** | producing at a workshop — employees only                               |
| **high**   | building; hauling goods **in** from the field                          |
| **normal** | felling, mining, planting, paving; hauling materials **out** to a site |
| **low**    | demolition                                                             |

Two asymmetries in that table are deliberate and were each put there to fix
something measured.

**Hauling in outranks cutting more down.** At equal priority the nearest job
won, so a marked stand of trees buried the hauling and a settlement starved with
fifty food lying in piles beside the hut, because nobody would stop chopping
long enough to carry it in.

**Demolition sits below everything.** Tearing something down is never more urgent
than feeding the people who live there.

**Paving used to sit there too, and `low` turned out to mean never.** The idea was
that roads get built with the hours nobody else needed, and there are no such
hours: a running settlement always has a tree marked or a load to carry, so the
order sat on the board for ever. A player reported it from year six as "nobody
makes roads", and measured on a two-year-old settlement of nineteen people it was
nine roads ordered and **nought laid** in fifteen days. At `normal` all nine went
down. The rule `low` was protecting is kept by hauling being `high`: the
settlement still never paves while its dinner is in the field.

### Should the player set priorities? — measured, and no

The obvious next lever is a priority control on each building. It was measured
before being built, and the measurement says it is not needed.

- **Construction is not starved by hauling.** A house placed into a settlement
  running three gatherer huts at full tilt got its materials in 94–136 ticks
  against 82–119 in a quiet one, and was finished in about four days either way.
  Only ~1.4× slower under full load.
- **Concurrent sites do not deadlock.** Four houses ordered in the same breath
  all completed, staggered across 206–332 ticks. Materials are not spread one
  log per site until nothing finishes, which was the failure worth fearing.
- **The queue that builds up is the right one.** Under load the board held ~300
  available jobs, almost all felling and mining, with the high-priority hauls
  consumed as fast as they appeared. A player who marks three hundred trees
  should see them cut as hands free up; that backlog is the plan working.

So a per-building priority slider would be a third lever overlapping two that
already exist — worker quotas and postings — plus the biggest lever of all,
which is deciding what to designate. The brief says not to over-engineer the UI,
and knobs without decisions behind them are how a settlement game turns into a
spreadsheet.

**What would change this:** a measured case where the ladder produces an outcome
a player can see is wrong and cannot fix by staffing or designating. None has
been found yet.

---

## Who works where — Implemented

Every villager used to be a generalist. A produce job at a hut went to whoever
happened to be nearest, so a "worker slot" described nothing the player could
act on, and the settlement had no way to say _fewer people in the woods, more
carrying things_.

Villagers now take **posts**:

- A villager assigned to a building is **employed** there, and only its
  employees may work it.
- Everybody else is a **labourer** — felling, mining, paving, hauling and
  building, which is all the work that belongs to the settlement rather than to
  a workshop.

There is no separate profession list, because the buildings already carry the
trades: adding a workshop adds a trade, and a villager's profession is simply
the building they answer to. Tapping someone says "Gatherer · hauling".

**Each building has a worker quota** the player can turn down to zero, from the
building's own panel. That is the lever the settlement was missing.

Employment does **not** idle its staff. A workshop's own work is the highest
priority in the game, so employees are always at their post when there is work
there — and free to fell and haul when there is not. Nothing grows under snow,
so a gatherer hut posts no work at all in winter and hands its two people back
to the settlement for the season that needs them most.

### What it did to the difficulty

Committing people to workshops is a real cost, and the curve moved because of
it. Measured over a full year on the same seed:

| Settlement              | Before                 | After                       |
| ----------------------- | ---------------------- | --------------------------- |
| One hut for ten         | scraped through winter | starves on day 45           |
| Two huts                | —                      | survives with nothing spare |
| Three huts and a larder | survives               | survives and grows to 11    |

The difference between dying and living is one building, which is the decision
the game is asking for. Capping how far an employee will walk to help with other
work was tried and **measured**: no effect at 14 cells, and worse at 5. Their
travel is not what a short-handed village is losing to.

---

## Families — Implemented

Adults of childbearing age pair up on their own, and a pairing is always mutual.
A **couple** has the children, both partners go on cooldown together so one
household cannot produce two in a day, and a child records who it was born to
and joins its parents' household where there is room.

Pairing is deliberately **not** conditional on sharing a house. That was tried
when births were first written and produced no children at all across six
simulated years: whether the two people given the house with the spare bed
happened to both be of an age was a lottery, so a settlement could be sterile
because of the order beds were handed out. A pairing is a fact about two people;
the spare bed is checked when a child actually arrives.

Measured against the same six-year run without pairing, on two seeds: the same
final population and the same number of births. Families cost the player
nothing — they are there to make a settlement a set of households rather than a
headcount.

Parentage is **information and nothing else**. No system reads it, inheritance
does not exist, and nobody is stopped from pairing with a relative — that last
one is a real omission rather than an oversight. It is also not "mother and
father": the simulation has no notion of sex, and inventing one to fill in a
label would be a whole model added for a caption.

Couples formed young stay together as they age; only death separates them, and a
survivor may pair again.

---

## The people panel — Implemented

Everyone in the settlement, grouped by the roof they sleep under. A flat list of
thirty names sorted by id is a spreadsheet; the same thirty grouped by household
is a village. The people with **no roof** get their own group at the end, called
out in a different colour, because they are the ones the player most needs to
notice and winter reaches them first.

Per person: age, whether they are a child, what they do and where, how fed, warm
and healthy they are, whether they are ill, who they are with, who they were
born to, their children, and what is on their back right now.

**Tools and clothing are not there, and that is deliberate.** They are not
modelled per person: the survival system works out what fraction of the day's
demand the stores covered and applies that same fraction to everybody. A tick
beside one villager saying "has tools" would be an invention. The coverage is
reported once for the settlement, with a line saying so in as many words.

---

## Roads — Implemented

Every economic problem this settlement has had turned out to be a hauling problem. Priorities decide
_what_ gets carried; roads are the only thing that changes how long the carrying takes. They are the
first decision the player makes about the **shape** of a settlement rather than its contents.

- Tap any open tile and the panel offers to lay a road there. Tap again to cancel the order, or to
  lift a road once it exists.
- Laying one is a job like any other: a villager walks over and beats the track flat. Nothing is
  built by decree.
- It costs **labour and no materials**. A beaten track is work, not goods — so nothing here has to
  invent a resource transfer that never physically happened.
- It runs at the lowest priority in the game. A settlement must never pave a path while its food
  sits in the field, and this is the rule that guarantees it.
- A road cell is roughly **half** the cost to cross. Enough that a long haul along one is visibly
  quicker and worth planning around, and not so much that a settlement without roads feels broken —
  the game has to remain winnable by someone who never lays one.
- Roads cannot be laid on water, rock, or a cell with a tree still standing on it. Clear the ground
  first.

Lifting a road takes effect immediately rather than posting a job, because it is the player
correcting a route they no longer want — making them wait for somebody to come and un-beat a track
would be ceremony rather than a decision.

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

## Illness — Implemented

Health above has exactly one cause: it falls when somebody is starving or freezing. On its own that
makes it a second readout of hunger and warmth rather than a thing in itself, and it means a
settlement with full stores can never be in any trouble at all, however large or badly housed.

Illness is the thing in itself. It arrives on its own schedule and does not care how full the
granary is.

| Rule                  | Value                            |
| --------------------- | -------------------------------- |
| Chance of falling ill | 0.2% per villager per day        |
| With no roof          | five times that                  |
| Length of a case      | 8 days                           |
| Cost of a case        | the villager does no work at all |
| Full care removes     | 75% of the remaining days        |
| Herbs used            | 0.5 per patient per day of care  |

**Illness costs work, not health**, and that took three measurements to arrive at. Every version
that drained health did the same damage to the shape of the game: a settlement that would have
reached winter lost somebody in _autumn_ instead, because a villager who had been ill during the
good days met the bad ones with less to spare. Softening the numbers did not help, and neither did
a floor, and neither did suppressing the drain while somebody was already starving — the
front-loading was the problem, not its size.

An ill villager simply stops. In a marginal settlement that is still fatal, but it kills by
starvation in winter, which is the failure this whole game is about rather than a second one racing
it. It also scales the right way: a big settlement has more cases, loses more hands, and needs a
healer for reasons a small one does not.

The rate is small on purpose, and measured rather than picked. A case costs eight days of somebody's
work, and a ten-person settlement has only two or three pairs of hands not already committed to a
workshop — so the labour bill is far steeper than the case count suggests. At twice this rate, a
settlement playing well lost most of the food it had banked for winter, which made sickness the
game's dominant mechanic rather than its third one.

**Nothing is contagious.** Each villager is rolled independently. Modelling spread would make an
outbreak a curve to be studied rather than a problem to be answered, and the answer would still be
"build a healer".

---

## Who sleeps where — Implemented

A house holds four, and a couple takes one to themselves **on purpose**: the two spare beds are
their children's. A household split across two roofs is the thing `settleCouples` exists to prevent,
and it is why a settlement of five couples eventually wants five houses rather than three.

Unpaired adults have no such claim, and until recently they kept whichever house they were assigned
on the day it went up. A settlement of ten could end up spread across five four-bed cottages at half
occupancy — having paid for two houses it did not need, and leaving nothing free for the next couple
to move into. `gatherSingles` now pulls them together after the couples have settled: filled houses
first, never onto a family, and never a lodger left on a couple whose next child would then have
nowhere to sleep. A grown child still living with their parents is not a lodger and is left alone.

### The founding party — measured, not changed

Founders' sexes are an even coin each, so a party can come out seven to three and make three couples
where another makes five. Dealing a balanced five-and-five was built and measured: it is a real
improvement for the lopsided seeds and it costs nothing in difficulty — **1 of 8 seeds survive
either way** — but it moves _which_ seed survives, and the balance suite is pinned to one. It also
needs `FOUNDER_AGE_MAX` capped at the childbearing age, since a founder rolled at 43 can never pair
with anybody and is a settler born too old to help found anything.

The age cap shipped; the balanced deal did not. It belongs with the difficulty pass rather than
ahead of it.

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

**That table is one seed.** Running the same well-played script across **24 seeds**, the settlement
comes through its first year without a single death on **2 of them**, and buries 220 of its 240
villagers. The table above is not wrong — it is what that seed does — but it describes a scenario on
a knife edge, and the balance suite being pinned to a single seed makes it fragile in both
directions: a change that alters anything at all can flip which seed lives without changing the
difficulty.

> **Sample size, the hard way.** This figure was measured at 8 seeds and reported as 4 of 8. Widened
> to 24 it is 2 of 24 — the first eight were small round numbers and happened to be kind. The 8-seed
> figure was not wrong so much as meaningless, and both it and the **1 of 8** it replaced are best
> read as noise. Difficulty claims in this project need 24 seeds; 8 is a smoke test.

### Why they die — measured, not fixed

They fail the same way, and **not** the way it looks from outside. They reach the first freezing
day of autumn with two hundred logs in the yard, a full larder, and _nothing built_: no house, no
woodcutter, no Food Storage. Every site is waiting for stone. With no house standing, no firewood is
burned for anybody — warmth has nowhere to be spent — so all ten freeze to death in midwinter beside
food they could have eaten.

The cause is a job-priority accident rather than a balance problem. Felling and mining are both
`normal` priority, so the choice between them comes down to which is nearer, and **there is always
another tree nearer than the quarry.** On those seeds the nearest deposit is a long walk, so fifty
mining jobs sat unclaimed for thirty-two days while the settlement cheerfully chopped wood it had no
woodcutter to burn.

Raising stalled gathering above felling was tried and **backed out**, because measurement did not
support it: survival flat, and three seeds died _earlier_ — they starved in summer instead, because
diverting hands to the quarry left the food piling up at the hut uncollected. Two attempts at
limiting the diversion (a priority rung below hauling, then a cap of three gatherers) both left the
same three seeds starving. The economy has no spare labour, so anything taken out of hauling comes
straight off the settlement's food.

#### The measurement that settles it

**Mining is not broken; it is outcompeted.** Twelve deposits marked and nothing else asked of
anybody, ten days, eight seeds — then the identical run with forty felling orders added. Same worlds,
same deposits, same days. Stone delivered to the yards:

| Nearest deposit | Mining alone | With trees also marked |
| --------------- | ------------ | ---------------------- |
| 8 cells         | 64           | 6                      |
| 11 cells        | 50           | 0                      |
| 12 cells        | 60           | 12                     |
| **1 cell**      | **72**       | **72**                 |
| 14 cells        | 46           | 0                      |
| 30 cells        | 0            | 0                      |
| 21 cells        | 16           | 0                      |
| 14 cells        | 60           | 0                      |

Marking trees costs the settlement about three quarters of its stone, and on five of the eight it
takes it to **zero**. The single seed that is unaffected is the one whose rock is a single cell from
the camp — where no tree can be nearer. That is the mechanism, isolated: not distance, not hauling,
not the work rate, just the tie on priority being broken by proximity.

Pinned in `tests/stone-supply.test.ts`, written as characterisation tests that fail loudly when this
is fixed.

### Things tried on the opening that did not work

Four attempts, all measured, one shipped. Recorded so they are not tried again blind — and because
they agree on one thing: **the opening is not short of food, it is short of firewood.**

| Attempt                                    | Result                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| +30% starting food (120 → 156) — shipped   | Idle settlement dies 1 day later. No played year changed on any seed.  |
| Stalled gathering outranks felling         | Backed out. Survival flat; three seeds starved in summer instead.      |
| Food Storage for timber only (no stone)    | Backed out. Food banked 63 → 120, survival flat, reference seed worse. |
| Playing better — the `disciplined` opening | No change. 222 deaths against 220 over 24 seeds.                       |

The last one is not a code change at all: it is the best opening anybody has found, played by a script
that marks stone first, gets a larder up on day four, roofs everybody before the cold and adds a
Forester's Lodge and a Quarry afterwards — and orders felling **only when the yard is short of logs**,
so the mining is not buried. It works exactly as intended in every measurable way except the one that
counts: the larder finishes on day 8 instead of day 28, timber waste falls from 205 leftover logs to
50 — and it still reaches winter with an empty woodshed, because the Woodcutter needs 4 stone. On the
reference seed it is actually _worse_, burying everybody where `prepared` buries nobody.

The timber-only larder is the most instructive of the code changes, because it worked exactly as
designed and still did not help. Dropping the 2 stone means the wreck's timber buys a larder on the
first morning, and the settlers' rations stop rotting — food banked entering winter **nearly doubled**,
63 to 120 averaged over 24 seeds. Survival did not move (2 of 24 became 1 of 24; 220 deaths became
222), and on the reference seed the well-played settlement went from losing nobody to losing two,
which would have meant weakening the suite's central claim in exchange for nothing.

That is the whole finding in one line: **more food, better-kept food and better play do not save a
settlement that freezes.** The chain is

```text
no stone reaches the yard
  └─▶ the Woodcutter is never finished (8 logs and 4 stone)
        └─▶ no firewood is made at all
              └─▶ nobody is warmed, and winter kills everyone
```

and every lever tried so far pushes on the wrong end of it. A well-played settlement enters winter
with **zero firewood on every seed but one**, and that one is the seed whose rock is a single cell
from the camp.

So the finding stands and the fix does not. The reason the opening is hard is now known rather than
guessed, and it belongs to a difficulty pass that has not been done.

---

## Guidance — Implemented

The simulation reports the single most urgent thing wrong; the HUD shows it as one banner. One
warning at a time on purpose — the player needs to know what to do next, not everything that could
ever go wrong.

In order of precedence: people starving, people freezing, people with no house as winter approaches,
**building work stalled for want of a material**, **goods lying in the field with nowhere to go**,
nobody gathering food, one hut for too many mouths, food rotting with nowhere to keep it, no
woodcutter with winter in sight, not enough firewood to last it.

### The two silent dead ends — found by playing

Both of these look identical from outside: villagers walking about, work apparently happening, and
nothing getting built.

**A site waiting for a material the settlement has none of.** Reported from a real game — a dozen
houses ordered, every one short of stone, a settlement carrying none, and the banner still advising
the player to _build Houses_. That last part was the worst of it: the game was answering a question
nobody had asked while the actual problem went unmentioned. The warning now names the material, and
`noShelter` no longer fires while housing is already going up.

It deliberately only triggers on **zero in store**. A site short of stone while a quarry is cutting
it is not stalled, it is waiting, and saying so would be crying wolf.

**A pile with nowhere to go.** `createHaulJobs` leaves a pile alone when no yard will accept it —
correctly, since there is nothing to be done — and did so in silence, so the settlement quietly
stopped carrying anything in.

The first is not a bug in the simulation: a house genuinely cannot be built without stone, and what
was broken is that the game knew and did not say.

**The second one got a real fix as well.** When no yard will take a pile, the settlement now looks
for a **building site that still needs that material** and carries it straight there. A settlement
whose yards were full of stone used to stop carrying timber in altogether — the pile sat where it
fell, the sites waited for that timber, and nothing moved again, because the yard was never going to
empty itself.

Deliberately a **fallback rather than a preference**. Routing every pile through construction first
would reroute the whole economy and starve the yards the settlement lives out of; this only ever
fires where the alternative is nothing happening at all. A site's materials inventory holds exactly
what it still owes, so it cannot be over-filled, and any remainder goes back on the ground.

`tests/stalled.test.ts`.

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

## Spirit — Implemented

The fourth need, and the only one that **cannot kill anybody**. The whole
design rests on that.

Spirit sits at **50, which is neutral and worth exactly nothing**. Above it the
whole settlement works faster, up to +25% at 100. Below it _nothing happens at
all_. A settlement that never builds a Cemetery or a Temple therefore plays
precisely the game it played before either existed — it collects no bonus and
pays no penalty, which is the same bargain tools already make.

That asymmetry is not squeamishness. A fourth need that could kill would be a
fourth way for a first winter to end, on a game whose opening already kills a
well-played settlement on seven seeds out of eight. Adding depth must not be a
way of quietly adding difficulty.

| Building     | Share of solace | Needs a keeper |
| ------------ | --------------- | -------------- |
| **Cemetery** | 0.35            | no             |
| **Temple**   | 0.65            | yes            |

Solace is the fraction of the settlement's need for it that its buildings
answer, capped at 1. Both together reach the top; either alone is worth
building, which is the point of splitting it. The Cemetery is cheap, unstaffed
and mostly stone — a wall round a piece of ground. The Temple costs real timber
and a villager's whole working life, and is worth nearly twice as much, because
sitting with the dead takes somebody who is not doing anything else.

**Spirit moves slowly** — 2.5 a day towards where solace would hold it — because
it is the one need that is about how long people have been living somewhere. A
Temple finished today lifts the settlement over the following weeks.

**Only death pushes it down**, by 6 for everybody per villager buried that day.
It can go below neutral, where it still costs nothing; what it costs is the
_climb back_, which a settlement with a Temple makes and one without does not.

Everybody shares one number. That is honest as well as simple: what raises it —
ground to bury the dead in, somewhere to sit with them — belongs to the
settlement rather than to any villager, exactly as tools and coats do.

**Not measured in play.** The bonus size, the climb rate and the grief per death
are considered numbers, not tested ones. What _is_ tested is the property that
matters: a settlement with neither building runs at exactly the old speed, for
ever. `tests/spirit.test.ts`.

---

## The chronicle — Implemented

The ledger's last tab, and the only page in the game about the past: years settled, who was born here,
who was taken in, who is buried here, the peak population, buildings raised, meals eaten, firewood
burned, the coldest night and the nights somebody slept in the open.

Recorded as it happens rather than reconstructed, because **the present cannot be asked what the past
was**. By year thirty most of the people a settlement is made of are dead and most of its winters are
decades gone; a village of twelve tells you nothing about the forty who lived there. That is also why
it is written into the save rather than derived from it.

The coldest reading starts at positive infinity and the row is hidden until there is a real one, so
the panel does not talk nonsense on the first morning.

> **This replaced the rescue arc.** The game used to have a win condition: raise a School, carry a
> bottle to the tideline, and a ship comes about forty years later. It went when the shipwreck did —
> see [Where they came from](#where-they-came-from--implemented) — and the chronicle inherited its
> figures, which were always the interesting part of that ending. The **School** is still buildable
> and currently does nothing; it is kept because settlements already have them standing and because
> a school is the right building for the specialisation system that is coming.

---

## The endgame — Planned

Nothing below is built.

The settlers left because something came out of the dark. The intended endgame is that it finds them
again: past some point, a settlement needs **walls** and a **watch** — villagers posted to defend
rather than to produce — to hold off incursions. That is what makes a guaranteed coastline worth
having, and what turns a peaceful village into a decision about how much labour to keep out of the
fields.

None of it exists yet: there are no walls, no guards, no attackers and no combat.

---

## Open questions

- **A do-nothing settlement dies in autumn, not winter.** Defensible — doing nothing for
  twenty-five days should be fatal — but it means the first failure most players see is not the one
  the game is named for.
- **Villagers idle around 30% of the time** in the measured runs, mostly when the player has not
  designated enough work. Whether that reads as calm or as broken is a question for a real playtest.
- **No professions.** Villagers take whatever the job board offers rather than holding a trade, so a
  "worker slot" is a post rather than a career.
- **There is no win condition.** The rescue arc was the only one and it has been removed; walls and a
  watch are meant to replace it and are not built. A settlement that survives its first winter can be
  played indefinitely, and nothing tells the player they have finished.
- **A long game has never been played at real speed.** Fifty years is around three hours at 1x.
  Growth over the generations is tested headlessly, but whether a settlement at year thirty still has
  anything to decide is unknown.

---

## Trades and experience — Implemented

**A trade is a building.** That is already how a profession works here — a
villager's profession _is_ the workshop they answer to, so adding a workshop adds
a trade and nothing has to learn its name — and experience follows the same rule.

| From              | Level      | Works at |
| ----------------- | ---------- | -------- |
| first year        | beginner   | 1.0      |
| 1 year at a trade | apprentice | 1.1      |
| 2 years           | expert     | 1.25     |
| 5 years           | master     | 1.5      |

Experience buys **speed at that trade and nothing else**: one number, multiplied
into the labour a tick is worth, in the same place tools and spirit already
multiply. Not better yields, not a wider range. Anything more would need the
player to understand a second system before they could read the first.

Four properties are deliberate, and each is tested:

- **A beginner is exactly ordinary.** 1.0 is the rate every villager in this game
  has always worked at, so a settlement that never keeps anybody in one job is not
  punished — it is simply not collecting. The same bargain tools and spirit make.
- **Counted in days at a post, not jobs finished.** A woodcutter who spent the day
  walking to a distant stack still learned something about being a woodcutter.
  Counting finished jobs would have made experience a second measure of how well
  the settlement is laid out, which it already measures elsewhere.
- **Nothing decays.** A master moved to a quarry keeps her woodcutting for the day
  somebody builds another woodcutter. The cost of moving a specialist is already
  the five years it took to make one.
- **A yard teaches nothing.** Only a building with worker slots, so "storage-yard"
  cannot become a profession somebody masters.

**Employment hires the specialist.** A vacancy goes to the most experienced free
hand at that trade, and among equals — which is everybody, for a village's first
year or two — to the nearest, exactly as before. A posting the player made still
beats both: their instruction is not the settlement's to overrule.

**A master's children start as apprentices.** At working age, a child born here
whose parent has mastered a trade begins with a year of it, having never worked a
day — they grew up in the workshop. Only from a master, and only to a child born
here, which is what keeps five years a milestone rather than a formality. Given at
fourteen rather than at birth, so a parent who masters the trade while the child
grows up still passes it on.

**Not measured in play.** The bonus sizes are considered numbers, not tested ones.
What is tested is the property that matters: a settlement that never specialises
runs at exactly the speed it always did, for ever. `tests/skills.test.ts`.

Shown in the people panel as "Woodcutter (master, 5 yrs)", best trade first, and
only for trades actually learned — a row reading "none" would say a villager has a
trade and then take it back.
