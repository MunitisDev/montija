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

**And they are Castilians.** The game is named after Montija, a valley in Las
Merindades north of Burgos, so the people are named out of the same hills: given
names Castile actually used in these centuries — Sancho, Jimena, Nuño, Urraca,
Fernán, Mencía — and family names that are half patronymics (Fernández, Gutiérrez,
Sáinz) and half toponymics from the valleys next door (de Espinosa, de Sotoscueva,
de Valdivielso, de Losa, de Mena). Velasco and Salazar are in the table too, which
were the two great houses of the Merindades and are a quiet joke in a village of
ten. Generic-medieval names put the settlement nowhere; these put it somewhere the
rest of the game already agrees with — beech and oak, high pasture, hard winters.

The naming convention is "given name, then everything else", so a surname with a
space in it is inherited whole: a child of Domingo de Valdivielso is a
Valdivielso.

> **The shipwreck this replaced.** The settlers used to be castaways, and it read
> well until the rest of the game caught up with it: strangers walk in to join a
> settlement and a merchant calls every twelve days, neither of which happens on
> an unreachable coast. A premise that the systems contradict is worse than a
> plainer one they agree with. The rescue arc it existed to support — a School, a
> bottle on the tide and a ship forty years later — went with it.

### The river — Implemented

Every map has a river, running the whole way across it, in one of two directions
chosen from the seed. Its course meanders out of the same kind of noise as
everything else, so no two seeds bend the same way, and it is two or three cells
wide with the odd wide reach.

> **The sea this replaced.** One edge of the map used to be ocean. It gave every
> settlement a horizon and nothing else: water you cannot cross, cannot dig from
> and cannot farm beside is scenery. A river through the middle is a _decision_ —
> it splits the ground the settlement lives on, it is what an orchard needs, and
> it is where the ditches come from. Inland ponds got rarer at the same time
> (`WATER_LEVEL` came down from 0.34 to 0.28): with the river carrying the water,
> the old threshold put a quarter of some maps under standing water.

**The map is in two pieces until the settlement bridges it**, and the game says
so rather than letting the player find out by watching villagers refuse work: a
plot on the far bank is refused with _nobody can walk there — bridge the river
first_. The navigation grid labels connected patches of ground for this, which is
also what stops a job on the far bank costing a full pathfinding search to reject.

The settlers make camp on the bank, a few paces back so there is ground on every
side of them, and **the starting yard is what they carried**. The camera opens on
it, so the first thing anybody sees is their own people.

### Bridges — Implemented

Five logs and one cell of river. A bridge is placed from the build menu like
anything else, its timber is hauled and laid by a villager like anything else, and
what makes it interesting is what it _is_: **a road over the water**. Nothing in
the navigation grid knows what a bridge is — only that boards can be laid over
water and not over rock — so a bridge is preferred by pathfinding, walked at road
speed, drawn joined to the tracks on both banks, and saved, all without a line of
special-case code.

Cheap on purpose, in materials. A settlement that has to save up for a crossing
simply ignores half the map for a year, which is not a decision at all — but the
**labour** is a house's worth per cell, because crossing a river is the biggest
thing a small settlement does to its own map.

### Ditches, and the orchard — Implemented

An orchard has to stand on water: the river, or a channel dug from it. It is the
one building whose place on the map is a real decision rather than "anywhere there
is room".

**And the larder wants to be next to it.** Fruit is the one harvest that will not
wait and the heaviest to shift: an Orchard in autumn makes about fifty food a day,
which is more than the pickers' own hut can absorb, so the crop stands in the field
while haulers walk it in. A Food Storage next door is a short walk repeated all
autumn; one across the settlement is a long one, and the difference is most of the
harvest.

> **Two versions of this were built and taken out again.** The first doubled the
> orchard's yield when a larder stood within ten cells. The second had the larder
> preserve whatever was lying within six cells of its door. Both were favours
> granted by proximity — invisible on the map, impossible to point at, and needing
> to be explained before a player could use them. What is left is the plain thing:
> goods keep where they are stored, they are carried by people, and a shorter walk
> means more of them arrive. Each thing in its own building.

The ditch is what turns the water requirement into a decision. A cell of open
ground next to water can be dug into a channel — labour, no materials, like a road
— and each new channel is itself water, so the player leads the river inland one
cell at a time. A ditch is water: nobody wades it and nothing is built in it. It
can be filled in again immediately, like taking up a road.

**Both earthworks are real work.** A ditch is about two days of one person's time
per cell, and a bridge is a house's worth of labour per cell of river. A decision
that costs an afternoon is not a decision; these are the two things a settlement
does to the shape of its own map, and they should be felt.

Roads and ditches are both drawn from what joins them: sixteen shapes per kind,
one for every combination of the four neighbours, so a track turns corners and
makes crossroads instead of being a scatter of identical patches.

What is in that bundle says the same thing the premise does:

| Carried      | Why                                                           |
| ------------ | ------------------------------------------------------------- |
| 45 logs      | Worth the weight: the first two or three buildings            |
| 156 food     | Fifteen days for ten mouths, most of which rots first         |
| **10 stone** | One each. Enough for the first building that needs any        |
| 8 iron       | Taken because it was valuable, useless until there is a smith |

**What they carried is set down where they stop.** The food goes into the camp
store, because that is what a store is for and because people eat out of one;
everything else is stacked on the ground beside it in bundles. That is both what
ten tired people do and a perfectly good place to build from — a site takes its
materials from the nearest source it can walk to, shelf or ground alike, so nothing
has to be tidied away first.

**The stone is the interesting one, and it used to be none at all.** No stone made
the first morning a search rather than a shopping trip, which was the right
instinct and turned out to be the single thing every settlement died of: the
Woodcutter costs four stone, no stone arrived, no firewood was made, and winter
took everybody. Measured with ten in the bundle, **firewood exists at winter for
the first time** — 91 units across twelve seeds of the reference opening, against
zero on every seed before. It is not a rescue: the deaths barely move, because
seven days of firewood is not a winter. But the chain now starts.

Ten is deliberately not enough for a second building, so the search is still the
opening move. It also forced a change: the Gatherer Hut
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
| Feller's Hut | 6 logs, 2 stone  | 1     | fells the wood: logs on the ground   |
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
| Feller's Hut    | logs, at the wood's pace | —               |
| Woodcutter      | 16 firewood a day        | 4 logs          |
| Blacksmith      | 6 tools a day            | 4 iron + 2 logs |
| Tailor          | 4.4 clothing a day       | 6.5 hides       |

**The wood is two buildings and a clock — Implemented.** A **Feller's Hut** cuts, a **Woodcutter**
splits, and nobody plants: the wood grows back on its own, in the open, over three years — see _What
the ground remembers_ below. Felling used to be the Woodcutter's second trade, and that was
one building doing two unrelated jobs where the player could see neither: a settlement with a
Woodcutter standing and no timber had no way to tell whether it wanted more cutters, more splitters or
more trees, and one with logs already on the shelf quietly stopped felling altogether — because a
splitter with a full woodpile has no reason to cut, which is exactly the wrong rule for the
settlement's only source of timber. It was reported from a real game as "nobody makes logs, do they?".

The Feller's Hut costs **one pair of hands**, deliberately. Two was measured and it is the wrong
price: three gatherer huts, a Woodcutter and a two-hand Feller is nine of ten villagers holding a post
and nobody left to carry anything, and a settlement that cannot haul dies with full fields. One cutter
fells about thirty trees a year at four logs each, several times what a settlement of ten burns and
builds with.

Its standing orders are **its own workers' work**, at the priority a workshop's own recipe gets.
Posted as open work at ordinary priority they were never done at all: a settlement with a hundred loads
on the ground always has something more urgent than cutting a tree, so four standing orders sat
unworked for a measured two years and no timber ever came in.

Two figures worth comparing, since they are the ones the first winter turns on: a Quarry is 10.3 stone
a day from three workers, and a Woodcutter turns 4 logs into 16 firewood a day from two. Ten villagers
burn 10 firewood on a freezing day, so one Woodcutter covers a settlement of that size with room to
spare — provided it ever gets built. See
[Difficulty](#the-measurement-that-settles-it).

---

## Improvements — Implemented

**A settlement's spare stone and iron had nowhere to go but more buildings.** The most useful thing to
spend them on is a house that is warmer for ever afterwards, so a house can be given a **stone hearth**:
6 stone and 2 iron, and the household burns **a third less firewood** — about a winter's cutting, paid
once.

Three decisions worth recording:

- **One improvement, not a tech tree.** A settlement game turns into a spreadsheet the moment every
  building has three tiers and a menu. There is exactly one, it is ordered from the building's own
  panel, and the button doubles as the way to take the order back.
- **It is _built_.** The house drops back into `underConstruction` for the duration and borrows the whole
  of the machinery that already exists: the stone and the iron are hauled there by hand, somebody spends
  labour on the roof, the panel shows the progress. Nothing about hauling or building had to learn a new
  kind of work — the building is simply asked what it owes (`requiredMaterials`) rather than told.
- **Iron makes it a later decision.** Stone alone would make it an obvious first move; iron means a mine
  and a blacksmith, so the settlement has to be standing before it can start being comfortable.

The family goes on living there while the masons work — putting a household into the snow to give them a
warmer hearth would be a bitter joke — and finishing an improvement is not counted in the chronicle as a
building raised, because the walls stood the whole time.

An improved house **shows it**: the same silhouette with dressed, pale masonry where the plain one has
field stone, which reads on the chimney. A player with eight cottages has to be able to see which ones
they have already paid to warm.

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

A **Feller's Hut** is where the settlement's timber comes from: standing orders inside a radius of
14, capped at two unworked at a time, and it stops cutting once the yards hold 200 logs — a store
figure rather than a rate, because at 200 the settlement has a year of building and splitting in hand
and the wood is better left standing. What it crops grows back; only the player's own marks clear
ground for good.

Nothing plants deliberately any more. **A tree a workshop cuts is replaced by a
sapling on the cell it stood on**, the same afternoon, and that sapling takes
three years to be worth cutting again — so a hut that works a stand at a time
never runs out, and one that clear-fells its whole radius waits three years for
its own nursery. That sapling is not wild spread and the ceiling does not bind
it: the same wood being worked is not the map getting greener.

### The region map must agree with the pathfinder — Implemented

**The most expensive disagreement this project has had, and it was invisible.** `AStar` refuses to cut
a corner: a diagonal step is legal only when _both_ orthogonal cells it passes between are clear,
because the looser rule reads as walking through a wall. The region map — the thing that answers "can
somebody standing here reach there" in one array read — counted that diagonal squeeze as a way through.

So `connects()` lied. Every consequence followed from that one lie:

- Villagers claimed errands they could not finish. The route failed _after_ burning the whole search
  budget, the load was set down where they stood, and the pile they had just made posted the same
  errand again. Measured on a settlement of fifty: **twenty-nine thousand six hundred material errands
  completed carrying nothing**, nineteen sites had not moved in a hundred days, and the ground filled
  with heaps nobody could deliver — which is exactly the screenshot a player sent.
- The sealed-pocket rule was wrong, because a diagonal pinch counted as a way out.
- The rescue for stranded villagers was wrong for the same reason.
- The check that stops a villager claiming work across a wall passed work it should have refused.

The rule lives in one place now — `stepAllowed` in `NavigationGrid` — and the region map, the sealing
test and the pathfinder all use it. Deaths across twenty-four seeds fell from **162 to 39**, seven of
eight settlements now survive their first winter and grow while doing it, and material errands went
from twenty-nine thousand to two hundred and eleven.

The lesson is worth keeping: **a cache of an expensive answer must be computed by the same rules as the
expensive answer.** A connectivity map that is more permissive than the pathfinder does not merely
mislead — it converts every wrong answer into wasted work at the worst possible moment, when somebody
is already carrying a load.

### A settlement may not wall itself in — Implemented

**Reported from a real game, and the worst class of defect this project has had.** The screenshot
showed materials all over the ground, villagers shuffling between two cells, and a banner saying the
works had stopped for want of timber. Reproduced headlessly on an ordinary opening: by day twenty-four
every villager in the settlement _and_ its only store were sealed into a four-cell pocket by the
settlement's own buildings. Nobody could reach a job, a pile or a post ever again — the haul board grew
from twelve jobs to a hundred and ninety-one, six hundred and seventy-six logs lay in the wood, and
they starved with three hundred food in sight of the larder.

Three separate things had to be true for that, and all three are fixed:

- **Buildings could seal ground.** Placement now refuses a plot whose footprint would cut the ground
  into pieces. The test is local and exact: blocking a set of cells can only separate two cells if
  they were joined _only_ through that set, so it is enough to ask whether every walkable neighbour of
  the footprint still reaches every other one once the footprint is gone. A flood fill that stops as
  soon as it has found them all, which for a plot in open ground is a dozen cells.
- **Nothing noticed anybody stranded.** A villager whose region holds no store's doorway now steps out
  to the nearest cell that does — the sibling of the rescue that already existed for somebody standing
  _inside_ a wall. Kept because a pocket can arise by other routes: a demolished bridge, a save from
  an older version, any future change to the terrain.
- **A site does not block traffic until it is finished**, so two placements could each pass the test
  alone and seal a pocket between them the day both were done. The test counts every unfinished
  footprint as already closed.
- **A store inside the pocket made it look like part of the settlement.** The settlement is the
  _largest_ region holding a store now: size is a structural fact, and the pocket had more villagers
  in it than the settlement did, because children are born at home and home was inside it.
- **A villager offered work they could not walk to was offered the same work for ever.** The job board
  is deterministic — same villager, same board, same answer — so one unreachable job is not a job
  skipped but the only job that person will ever see. Reachability is now checked before a job is
  offered, by region comparison rather than by pathfinding, and for **both** legs of a haul: checking
  only the pickup produced a villager carrying a load to a yard behind a wall, failing to deliver,
  putting it down where they stood, and being handed the same errand by the pile they had just made.

**Nobody walks around full.** A villager can end a job still holding goods — they fall ill mid-errand,
or they are rescued out of a pocket, or the load they fetched turned out not to be wanted — and a full
pack means every future errand loads nothing at all. They were then useless for the rest of their lives
while still claiming work. Measured on a settlement of sixty-seven, eight of its haulers were walking
about with forty logs each. A villager with no job and goods in hand puts them down, and the heap posts
its own haul job like any other.

**Three destinations can share one doorway, and the order between them is the whole of it**: a site
that owes some of what is being carried, then a yard whose doorway is here, then a finished building's
input buffer. A free cell beside one building is a free cell beside its neighbour, so sharing is legal
and has to keep working — and every wrong ordering of those three has been shipped and measured. One
put a house's delivery into a finished neighbour and the site stood unbuilt for ever; one asked a
finished building how much the _site_ wanted, got nought, and had haulers pick up nothing forty
thousand times; one tipped a passing load of firewood into a house's materials, filled the room its
stone needed, and killed the building outright.

**Nothing is left standing on a site's doorstep.** A load the site cannot take used to be set down
where the hauler stood, which is the site's own doorway — and it only happens because somebody else's
load arrived first while this one was walking. A heap of stone outside a half-built house is exactly
what a player reads as the works being stuck. The remainder goes on to a yard in the hauler's hands
instead: measured before the fix, a heap sat on some site's doorway for one tick in forty of an
ordinary year, and now for none.

**And a site takes only what it still owes.** A site's materials hold exactly its cost, so a load
tipped in whole could fill the room another material needed: a Feller's Hut costing six logs and two
stone was measured holding _eight logs_ and full, with its two stone lying on the doorstep and
re-fetched for ever. The building could never be finished and nothing on screen said why. Deliveries
are now bounded per resource at both the pickup and the doorstep, and when several buildings share a
doorway — a free cell beside one building is a free cell beside its neighbour — the load goes to the
one that actually owes it.

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

An orchard also has to **stand on water** — the river, or a ditch dug out to it — and wants its larder
built beside it, because fifty food a day is more than a hauler can walk across a settlement. Those
two together are the first time the game asks _where_ rather than _whether_.

A settlement that lives on foraging survives hand to mouth. One that farms has to
store what it brings in and make it last — which is the lesson winter teaches,
arriving a season early.

> **And the Food Storage is currently not worth its cost, which is a defect.**
> Measured over twelve seeds: 661 food banked by winter with a larder against 690
> without it, 201 left at the end of winter against 190, **4751 food spoiled over
> the year against 4804** — one per cent — and 100 deaths against 103. It costs 6
> logs, 2 stone and four hundred ticks of labour to build.
>
> The reason is that the loss is **in the field, not in the stores**: gatherers
> out-run haulers, so most of what rots is lying where it was picked, at a rate no
> building changes. Two answers are available and neither is taken yet — stop the
> open founding yard accepting food at all, which is the settlement's own "each
> thing in its own building" rule applied honestly, or raise hauling throughput so
> the field empties. Pinned in `tests/balance.test.ts`, written to fail when it is
> fixed.

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

| Priority    | Work                                                                     |
| ----------- | ------------------------------------------------------------------------ |
| **overdue** | a workshop's own output, left on the ground beside it for a season       |
| **urgent**  | producing at a workshop — employees only                                 |
| **high**    | building; hauling goods the settlement still wants; delivering to a site |
| **normal**  | felling, mining, planting, paving                                        |
| **low**     | demolition; hauling more of something the settlement has plenty of       |

Four asymmetries in that table are deliberate and were each put there to fix
something measured.

**Hauling in outranks cutting more down.** At equal priority the nearest job
won, so a marked stand of trees buried the hauling and a settlement starved with
fifty food lying in piles beside the hut, because nobody would stop chopping
long enough to carry it in.

**A haul is worth what the settlement lacks, not what it is carrying.** Every
haul used to be worth the same, so a hundred and seventy logs in the yard bought
exactly as much attention as the harvest rotting beside the hut — and since the
log piles stood nearer, the log piles won. A third of the settlement's waking
hours went on carrying timber it already had, all year, while people starved a
hundred paces away. Above what the settlement wants of a good — `wantedPerVillager`
in `data/resources.ts`, so it grows with the population — carrying more of it
drops to the bottom of the board. Measured over twelve settlements playing the
`prepared` line for a year: **120 deaths before, 80 after**, and food banked at
the first frost up by a fifth. It is not the goods that are worthless, it is that
particular trip, and the hands it frees go to the harvest and to the rock.

**A workshop's own output, left where it fell, outranks making more of it.** The
one thing in the game above `urgent`, and it exists because of a shape a player
photographed: the ground covered in goods. A settlement can employ every pair of
hands it has, and then nothing is left to haul — and because a workshop's own work
is urgent, its people go on producing onto a heap that never moves. After
twelve days — a season, `STALE_PILE_DAYS` — that heap becomes the most
important thing on the board, and the nearest pair of hands is almost always the
pair that made it: the forager is standing beside her own harvest, so she carries
it in and goes back to work.

**Beside its maker, and not every old heap anywhere** — which was tried first and
measured. Escalating _any_ twelve-day-old pile sent whole settlements across the
map for the log heaps a player's felling orders had left in the wood: food banked
before the frost fell from 181 to 92 and eighteen more people died across
twenty-four worlds. Timber lying in a wood nobody has reached yet is a backlog; a
heap outside the hut that is still making more of it is a deadlock, and only the
second is worth breaking a day for. Restricted to the maker, over the same
twenty-four worlds: **57 deaths to 54 and 73 to 72**, food banked up from 189 to
235 and from 181 to 193, and the food left lying on the ground at the year's end
down from 31 to 5.

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
- **Laying draws a run, not a cell.** Pressing Lay road opens a run at that cell; tapping where the
  road should end draws the whole line in green and reports its length, and a second tap on that end
  cell — or the Confirm button — orders the lot. The run begins one cell long, so tapping the cell you
  started on paves exactly that one. A diagonal run takes the corner cell between each step, because
  the pathfinder will not cut a corner and two cells joined at a corner are not a road.
- **The run bends round what is in the way.** A house, a rock face, the river: the line is routed over
  ground a road can actually take, preferring the fewest bends so it comes out the shape a person would
  lay. A straight line is honest and useless in a dense settlement, which is exactly where roads are
  worth having — the cells between two points are the ones with buildings on them. The detour is bounded
  to twelve cells outside the two ends, because a road that comes back from the far side of a lake is
  not the road the player drew; past that the straight line is shown instead, and the cells no road can
  go on show red and are left out of the order rather than refusing the whole line.
- Laying one is a job like any other: a villager walks over and beats the track flat. Nothing is
  built by decree.
- It costs **labour and no materials**. A beaten track is work, not goods — so nothing here has to
  invent a resource transfer that never physically happened.
- It is posted at **normal** priority, alongside felling. At `low` it was never picked up at all — a
  running settlement always has a tree marked or a load to carry, so not one road was ever laid, and
  it was reported as "nobody makes roads". It still loses to hauling, which is the rule that actually
  mattered: a settlement must never pave a path while its food sits in the field.
- A road cell is roughly **half** the cost to cross. Enough that a long haul along one is visibly
  quicker and worth planning around, and not so much that a settlement without roads feels broken —
  the game has to remain winnable by someone who never lays one.
- Roads cannot be laid on water, rock, or a cell with a tree still standing on it. Clear the ground
  first.

Lifting a road takes effect immediately rather than posting a job, because it is the player
correcting a route they no longer want — making them wait for somebody to come and un-beat a track
would be ceremony rather than a decision.

---

## Water, and fire — Implemented

The river already decided where an orchard could go. Water now decides rather more, and a **Well** is how
a settlement puts it where the river is not: eight stone and two logs, unstaffed, serving ten cells.

**Water is comfort every day.** A house with water within reach is a household not carrying every bucket
from the bank, and the share of the settlement's people living that way is worth up to **25%** of its
spirit — beside a Cemetery's 35% and a Temple's 65%. Collected, never owed: a village built on the dry
side of the valley is not punished, it simply has not taken a comfort that was there for eight stone.
It is deliberately the cheapest of the three, so the early settlement has a comfort it can afford and
the Temple is still worth an autumn later on.

**And insurance on the bad day.** A lit hearth can set its own roof alight on a freezing night, and a
working forge on any day of the year. Nothing else in the settlement starts a fire, which is the whole
point: a summer village cannot burn down, and a village with no forge and no winter has no risk at all.

Every part of a fire is a decision the player made:

| What                      | Decided by                                                              |
| ------------------------- | ----------------------------------------------------------------------- |
| Whether one starts        | What the buildings do — hearths in winter, a staffed forge any day      |
| How likely                | How tightly it is built: every neighbour within 2 cells adds half again |
| Whether it costs anything | Water within 10 cells — the river, a channel, or a Well                 |
| How far it goes           | What lies between: a road, a ditch or the water breaks the line         |

A fire burns for a whole **day**, so the player watches it happen rather than reading about it
afterwards — and there is nothing to do in that moment, because what settles it was decided seasons ago.
At the next day boundary: water in reach and the building stands, having lost only what was stored
inside it; no water and the building and its contents are gone, and the fire may take **one** neighbour,
which burns the following day. One ignition a night, and never while something is already alight: a
settlement that could lose three buildings in a night is one nobody can plan against.

**Nobody is ever hurt.** This game has enough ways to kill people and none of them is a dice roll. A fire
takes buildings, which can be rebuilt.

Measured over twenty simulated years with six houses: **five fires, all of them put out**, because that
settlement stood by the river. That is the intended shape — the river is safety, and building away from
it is the decision a Well answers.

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
| builds one hut for ten villagers    | survives, fed exactly, with a few days in store    |
| builds three huts and a larder      | survives comfortably, ending winter with food left |

**One Gatherer Hut now feeds exactly ten villagers, and does not fill a store.** Measured at 10.00
food a day eaten through the summer against 10 needed — which is a hut that keeps a settlement alive
and leaves it nothing to spend on a winter. What the second hut buys is the margin: over 24 seeds a
settlement on one hut banks 643 food by winter and a settlement on two banks 1799.

> **That changed when a villager's load doubled** (Phase 40: ten units to twenty). Before it, one hut
> could not feed ten, and twelve seeds of the reference opening banked 461 against 857 after. Nothing
> about foraging moved; the hauling did.
> Every economic problem in this game has turned out to be a hauling problem, and the load is the one
> lever on it that costs the settlement nothing at all — the same twenty-four seeds bury the same
> hundred villagers either way, because what kills them is cold.
>
> A **third** hut is not worth a second larder-day: `prepared` raises its third hut on day 16 and its
> larder on day 20, banks 1685, and is beaten by the two-hut line that has its larder up on day 14.

The intended shape is that a prepared settlement survives its first winter _narrowly_: in the
measured run above, the well-played settlement ends winter with six food in store and its firewood
already gone.

**That table is one seed.** Running the same well-played script across **24 seeds**, the settlement
comes through its first year without a single death on a small handful of them, and buries 200 of its
240 villagers. The table above is not wrong — it is what that seed does — but it describes a scenario on
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

#### And a second mechanism, found when the river arrived

The exception in that table — the seed whose rock sat one cell from the camp — was also the seed the
balance suite used as its reference, which is the only reason a well-played settlement there ever got
the four stone a Woodcutter costs. The river re-cut every map and took the luck away, and what came
out of the re-measurement is a _different_ mechanism sitting behind the first:

**In a settlement with three huts, a Woodcutter and a Forester's Lodge — the building the game had at
the time — every adult is employed** — and an
employee's own workshop always has an `urgent` job waiting, so ordinary `normal`-priority work never
comes up at all. Two hundred and twenty-three standing mining orders were measured sitting on the
board, unclaimed by anybody, for forty days, while the player was told nothing was wrong.

Two fixes were measured and backed out, because neither touches it:

- **mining above felling** (and then at hauling's own priority): 80 of 80 dead across eight seeds,
  no firewood anywhere. Priority cannot help work that nobody is free to take.
- **ageing the board**, so an order nobody has taken rises: worse — 70 of 80 against 63. It pulls the
  few free hands off hauling onto stale orders, and the food stops moving.

The lever that does work today is the **labour panel**: take a gatherer off a hut and the stone
arrives. That the player has to know to do it by hand is the real defect.

**And the cheapest answer turned out to be the bundle.** The settlers now carry ten stone — one each —
which is not a fix for any of the above but does buy the _first_ building that needs stone. Measured
over twelve seeds of the reference opening, that is the difference between **no firewood on any seed**
and 91 units of it standing at the first freezing day. The mechanism above is untouched and still
kills settlements; what is gone is the settlement that stood at a half-built Woodcutter on day three
with nothing it could do.

### Things tried on the opening that did not work

Four attempts, all measured, one shipped. Recorded so they are not tried again blind — and because
they agree on one thing: **the opening is not short of food, it is short of firewood.**

| Attempt                                         | Result                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| +30% starting food (120 → 156) — shipped        | Idle settlement dies 1 day later. No played year changed on any seed.      |
| Stalled gathering outranks felling              | Backed out. Survival flat; three seeds starved in summer instead.          |
| Food Storage for timber only (no stone)         | Backed out. Food banked 63 → 120, survival flat, reference seed worse.     |
| Playing better — the `disciplined` opening      | No change. 222 deaths against 220 over 24 seeds.                           |
| **The founding yard's doorway** — shipped       | **Two real defects, not balance.** See below.                              |
| **Hauling priced by what is lacking** — shipped | **120 deaths → 80** over twelve seeds. See "How work is chosen".           |
| Mining above felling                            | Backed out. 121 deaths against 100; felling then stopped entirely instead. |
| Felling below mining when timber is plentiful   | Backed out. 93 deaths, and almost no food banked before the frost.         |
| Three standing orders of each kind at a time    | Backed out. 100 deaths at three, 110 at six — but **163 firewood**.        |
| A House costing no stone at all                 | Backed out. 97 deaths. Houses are not the binding constraint.              |

### The founding yard's doorway — the one that was a defect

Worth separating from the balance attempts, because it was not a balance question at all and it had
been quietly wrecking every settlement.

A store is fetched from at exactly one cell. A building's yard uses the building's own doorway, and
the registry already re-finds that when a neighbour is raised over it — but **the founding yard's
doorway is the bare patch of ground the settlers stopped on, and nothing stopped the player putting
their first house squarely on top of it.** The moment that happened, every question of the form "can
somebody fetch logs from here?" answered no.

What made it invisible is that goods still went _in_: a hauler delivers from the next cell over. So
the HUD showed a yard filling steadily to a hundred and seventy logs while every building site and
every workshop starved beside it. On the reference settlement a Woodcutter ordered on day 8 was still
half-built on day 24, the settlement made no firewood in the entire year, and all ten froze — and the
whole diagnosis looked like a balance problem with stone.

Three things came out of it. A store whose doorway is walled in now moves it to reachable ground once
a tick, the same reconciliation a building's doorway already gets. A delivery now prefers a source that
can fill the whole trip: the old rule was nearest-first and nothing else, so a pile holding _one_ log
three cells away beat a shelf holding a hundred and seventy ten cells away, and a site costing eight
logs took a trip per log.

And the rehousing itself had to learn one rule, because the first version of it introduced a worse bug
than the one it fixed: **a store's doorway may never be another building's doorway.** Deliveries are
routed by cell and a building answers for its own doorstep before any yard does, so a founding yard
rehoused onto a House's doorway had every basket carried to it disappear into that house's own
store-cupboard, where nothing could eat it. That settlement starved from day twelve with a hundred and
twenty-five food lying in the field and its shelves reading nought — the same symptom as the original
bug, by an entirely different route.

Together the three are worth more than every balance lever tried before them put together: over twelve
settlements playing the `prepared` line for a year, **120 deaths became 63**, firewood on the shelves
at the year's end went from 0 to 57, food banked at the first frost from 701 to 1219, and five of the
twelve now come through their first winter without a single grave. Time lost to standing idle fell from
22% of the settlement's waking hours to 14%.

### What is left, and it is a scheduler

The remaining wall is that **felling and mining cannot both progress**, and no ordering of the two
fixes it — the table above records three attempts, and each one simply reversed which of them starved.
At equal priority the nearest job wins, and a player who marks forty trees and twenty deposits has put
four hundred cells of woodland on the board against twenty of rock. Villagers were measured spending
13% of a year walking to trees and **0% cutting stone**.

The answer is a scheduler that shares hands between _kinds_ of work rather than any ranking of them.
The standing-order experiment is the strongest hint about its shape: holding each queue down to three
live orders put real firewood on the shelves for the first time — 163 units across twelve seeds against
10 — while costing lives elsewhere, which says the mechanism is right and the tuning is not.

The last one is not a code change at all: it is the best opening anybody has found, played by a script
that marks stone first, gets a larder up on day four, roofs everybody before the cold and adds industry
afterwards (a Forester's Lodge in the measurement, before the wood learned to grow back on its own, and
a Quarry) — and orders felling **only when the yard is short of logs**,
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

**The MVP's headline goal — survive the first winter — is met on some worlds and not on most.** It was
believed to be met outright for a while, because the balance suite asserted survival on the reference
seed alone and that one settlement scraped through by a single villager's worth of firewood. Played
across a dozen worlds, a well-played settlement now comes through cleanly on five of them and loses
everybody on the rest. The suite judges the aggregate as well as the reference seed and says so out
loud; see `tests/balance.test.ts`.

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

---

## Stores hold whole things — Implemented

A resource in this game is a physical object somebody carried up a hill, and there
is no such thing as 0.35 of a tool. `Inventory` enforces it: both `add` and
`remove` floor to whole units, so nothing anywhere can put a fraction into a yard.

Three things wear out at less than one a day, which is what made this a problem
worth fixing:

| Wears at                   | Rate | A village of ten owes |
| -------------------------- | ---- | --------------------- |
| Tools, per worker per day  | 0.05 | half a tool a day     |
| Coats, per villager, cold  | 0.05 | half a coat a night   |
| Herbs, per patient per day | 0.5  | half a bundle a day   |

Those fractions used to come straight out of the yard, so a settlement held 99.5
tools, then 99, then 98.5 — and a player reported seeing decimals in their stores.

**The fix is a running tab, not a rounding.** Each day's fraction is added to what
the settlement owes and whole units are taken when the tab reaches one:

```text
day 1   owes 0.5   takes 0   stock 100
day 2   owes 1.0   takes 1   stock  99
day 3   owes 0.5   takes 0   stock  99
```

The long-run rate is therefore exactly the rate the data states. Rounding each day
to the nearest unit would have made a village of ten spend either nothing or twenty
times too much, depending which way it fell. What the settlement cannot pay it goes
on owing, and pays the moment it forges some — the work happened and the tools took
the punishment. The tab is saved, because dropping it on load is free tools.

**Coverage is read off the shelf, not off the withdrawal**, and that is not a
detail. Tool coverage drives the work bonus; based on what was taken it would read
"unequipped" on every other day and the bonus would flicker between nothing and
double. What the number means is "is this settlement equipped today", and the
honest answer is whether the yard could cover the day's wear.

`tests/wear.test.ts`, including a fortnight of a real settlement with tools, coats
and herbs on the shelf, asserting every stored total is a whole number on every
tick.

---

## Rates are quoted by the season — Implemented

Whole stores were the smaller half of that problem. Every _rate_ the interface
quoted was still a fraction, because a day is too short a window for these numbers
to come out whole:

| The panel used to say  | It now says          |
| ---------------------- | -------------------- |
| At best 10.3 stone/day | At best 123 a season |
| Tools -0.5/day         | Tools -6 a season    |
| net +0.4/day           | net +5 a season      |

A season is twelve days, it is the unit the calendar and the whole survival loop
already run on, and it is long enough that the same rates land on whole numbers a
player can compare against what is on the shelf. "Is 10.3 enough?" is arithmetic
the game already knows how to do.

**The conversion is a display one and lives in exactly one place**,
`src/ui/format/rates.ts`. Everything behind it stays per-day: the simulation spends
by the day, `estimateFlows` estimates by the day, and `productionSummary` now
returns the _unrounded_ per-day rate so the seasonal figure rounds once rather than
twice. A rate that is real but smaller than a season keeps its sign instead of
rounding to nothing — `0` beside a red row would be the sheet contradicting itself.

**One figure stays in days on purpose.** "Stores last about 4 days" is the one
number a player has to act on tonight, and "about 0 seasons" would bury it. So does
the ledger's "Yesterday, actually" section, which is a measured fact rather than a
projection and is worth reading precisely because it sits next to a seasonal
estimate.

`tests/rates.test.ts` pins the conversion, that the model keeps its rate exact, and
that no figure the ledger prints contains a decimal point.

---

## The closing page — Implemented

When the last villager went, the game said four words and offered a button. That is
the wrong amount of ceremony for something a player spent an hour on, and worse, it
withheld the one thing they wanted: **why**. A settlement that starves in its second
winter and one that quietly ages out over thirty years ended with the same sentence.

Every death is now written down as it happens — name, age, season, cause, the trade
they had reached and whether they were ill at the end — in `Necrology`, beside the
chronicle. The end screen shows the settlement's totals, a count by cause, and the
roll of everyone who ever lived here, most recent first: the deaths that ended the
settlement are the ones that explain it, and the founders are history that can wait
further down the list.

| Cause         | What it means                                               |
| ------------- | ----------------------------------------------------------- |
| Hunger        | health reached zero with the larder empty                   |
| Cold          | health reached zero with no fire, or no house to burn it in |
| Hunger & cold | both had run out — the settlement failing at both           |
| Old age       | they reached the end of their span                          |

**Illness is deliberately not a cause**, because in this game it does not kill
anybody: a case costs the settlement somebody's working days, and the starvation
comes in winter. Naming it on the one screen whose whole job is to explain what
really happened would be inventing a mechanic. Each line says whether that person
_was_ ill instead, which is true of them, and the roll notes how many at the foot.

`hungerAndCold` is its own cause rather than a coin toss between the other two.
Picking one would tell a player to fix half of what went wrong.

The same count, by cause, appears on the ledger's chronicle page while the game is
still running — the same question asked where the player can still answer it. Only
causes that have actually taken somebody are listed: four zeroes on a settlement
that has never lost anybody reads as a forecast rather than a record.

The roll is saved. `tests/necrology.test.ts` covers the attribution, one record per
death, agreement with the chronicle's own count, and survival through a save.

---

## The labour panel — Implemented

A player with nine workshops and a settlement that had stopped growing asked for
"a menu that shows the buildings, their worker occupancy and the labourers going
spare, with +/- buttons on screen". They were right that the game could not answer
it: the only way to find out who was working where was to tap each building in
turn, and moving one person meant tapping the building they should leave, then the
building they should join, with the map in between. On a tablet that is a dozen
taps for one decision.

Every workplace is now on one page, with the labourers counted at the top —
because every post filled is one of them gone, and that trade is the whole
decision.

**The quota and the staff are different numbers and both are shown.** A workshop
can ask for three and hold one, because there is nobody spare or because a hut
asked first. The buttons move the quota; the figure reads `staffed/asked for`, and
goes amber when they disagree. Hiding the difference behind one number would make
the panel lie on exactly the settlements that need it.

Each row names who is actually there and their level at that trade, specialists
first. Workshops the settlement has more than one of are numbered in the order they
were built, because two rows both saying "Gatherer Hut" leave the player choosing
between two things they cannot tell apart.

A quota change re-runs employment immediately, so the page shows the result of a
press without waiting for a tick — which it has to, because the clock is stopped
while the panel is open. That is also why the whole page is redrawn on each press:
taking a hand off one workshop can fill a vacancy at another.

Who gets the post was already decided: whoever has the most experience at that
trade goes first — see the trades section above. This panel is where that becomes
visible.

`tests/labour.test.ts`.

---

## The card under a building — Implemented

Asked for in the same report as the labour panel: "the character's portrait, age,
sex and trades with their level, on or beside the building."

A workshop used to be a number. "Workers 2/2" answers how many and nothing else —
not who, not that one of the two is fourteen, not that the settlement has just put
its only master forager on a woodpile. Tapping a building now lists the people
under it, a card each: portrait, name, age, which of the two, and their level at
_that_ trade. Under a **house** the same cards are the family that sleeps there,
because "Residents 3/4" has exactly the same problem.

**Four faces rather than two.** Child, woman, man and elder, picked by age first
and sex second, because age reads at a glance where a number does not: a
settlement whose panels are full of children and elders looks like one, and that
is the thing to notice about a population that has stopped working. The
silhouettes are drawn to differ at thirty-two pixels — a big head on small
shoulders, long hair, broad shoulders, a stoop — rather than by features, because
at that size a face is two dots and a smudge.

**Each villager has a colour, and keeps it for life.** Taken from their id out of a
muted, earthy set — dyed wool, not highlighter pens. It is what tells two foragers
of the same age apart at a glance, and it is the idea the world sprites will use
when they get their own clothes.

The level is named only once it has been earned. A forager three days in is not an
apprentice, and the card says nothing rather than flattering her. Experience at
another trade never appears: a master mason foraging is a forager, whatever else
she can do.

These are placeholder portraits, in the sense the art brief means: correct
dimensions and anchors, no production artwork. `tests/cards.test.ts`.

---

## Children and elders, seen — Implemented

The last of the report that asked for trades and the labour panel: "children
should have a little figure on screen too, and from 2 to 14 go about the village
playing or going to school; elders over 60 who no longer work should walk about
the village consuming resources like anybody else but producing nothing."

Most of that was already true and invisible. Nobody under fourteen or over sixty
is ever put to work, and everybody with no work to do wanders — so the children
and the elders have always been walking about the settlement, drawn as the same
hooded adult as everybody else. Making them _look_ like themselves is the
[art bible's](./ART_BIBLE.md#four-villagers-and-a-colour-each--implemented)
half of the answer. Two things in the simulation needed fixing to go with it.

**A two-year-old crossed twelve cells of wilderness alone.** Under four they now
keep within about three cells of their own front door. Over four they have the
run of the village, which is what children in a village do.

**The school did nothing, including nothing to look at.** School-age children now
head for it about half the time, when one has been built — the rest of the time
they are somewhere about the place, because a child who only ever walks between
home and school is a commuter. It still teaches them nothing and its description
says so; a building children visibly walk to is a different thing from a
sentence in a menu.

**Neither change moved the random stream**, and that shaped both of them. The
toddler draws exactly as many numbers as any other wanderer — only the radius
differs — and the school die is rolled only once a school actually stands. A
settlement without one consumes the numbers it always did, so no seed was
re-rolled and no balance figure measured on one became a lie.
`tests/childhood.test.ts` pins the villagers' RNG cursor after six days of the
reference settlement for exactly that reason.

---

## Cropping, clearing, and the five-year wood — Implemented

Every felled tree used to be the same felled tree. That made the two things a
player fells for indistinguishable — **clearing a site** and **cutting timber** —
and it left them marking trees one at a time, every winter, to keep a Woodcutter
fed. Two rules replace it:

| Who felled it                    | What the ground does                     |
| -------------------------------- | ---------------------------------------- |
| A workshop, under its own orders | A sapling, standing on the cell that day |
| The player, marking a tree       | Cleared for good                         |

**A tree comes back where you can see it — Implemented.** What was here before was a ledger of stumps:
a felled cell owed a tree five years later, and the difference between a wood being cropped
sustainably and a wood being emptied was two numbers only the save file knew. A sapling standing on the
cell says the same thing on the map, at a glance, and it is why the Forester's Lodge is gone — its
whole job was to make felled ground come back, and the ground does that itself now.

**Three sizes, three years.** A sapling at nought, a young tree at eighteen months, a full tree at
three years — and **only a full tree gives timber**. Cutting a young one is not a smaller harvest, it is
no harvest, which is what makes "leave that stand another year" a decision rather than a rounding
error. A Feller's Hut only ever marks grown wood; a hut whose whole radius is nursery posts nothing and
waits.

**A growing tree is still in the way**, and can be **cleared**: gone for good, no timber, and about a
third of the work of felling — an axe and a wedge against a spade. Clearing ground for a house should
not cost what harvesting the timber to build it does.

**Ground the player clears stays cleared**, and refuses both the wild spread and a sapling of its own.
Marking a tree is how you make room to build, and a sapling appearing where you meant to put a house is
the game undoing your work. A workshop cutting timber on ground somebody once cleared reclaims it,
because the last thing done to a cell is what it remembers.

The cleared cells are saved, and so is the day each tree took root: a cleared cell and a cell that
never had a tree look identical, and a reload that turned a spent wood back into a working one would be
a worse lie than forgetting either.

### What it did to the opening — measured

The disciplined opening, 24 seeds, a year each:

| Line played                                      | Deaths | Seeds with none | Firewood at winter |
| ------------------------------------------------ | ------ | --------------- | ------------------ |
| Marking trees by hand, as before                 | 222    | 2/24            | 0 on all 24        |
| Leaving the felling to the Woodcutter            | 210    | 3/24            | 0 on all 24        |
| …and a Woodcutter costing no stone (not shipped) | 202    | 4/24            | 20, on one seed    |

**It is a convenience, not a fix.** Letting the workshop do the felling is worth
about a dozen lives over 24 settlements, and every one of them still enters winter
with no firewood at all — because the Woodcutter is 4 stone and
[the stone still does not arrive](#why-they-die--measured-not-fixed). The third row is
a measurement, not a change: dropping the stone cost gets firewood onto exactly
one seed, which is not enough to ship a balance change for.

`tests/woodland.test.ts`.

---

## How full the stores are — Implemented

Asked for after a settlement died with food lying in the field: **the room left in
the sheds, and a warning before it runs out.**

The figure is asked **by resource rather than by building**, because that is the
question with an answer: a Storage Yard takes eight goods and a Food Storage takes
one. "Have I room for this harvest" is about the pool, not about one shed. It
appears in the stock drawer's foot, on the ledger's buildings page — amber from
nine tenths — and under any store the player taps.

**A warning at nine tenths**, in `STORAGE_WARNING_FRACTION`, shared by the banner
and the sheet so the two cannot disagree on screen. Nine tenths because the
warning has to arrive while there is still time to raise another shed; a yard that
has actually filled is already turning goods away.

**The larder line only appears once a larder is built.** The founding yard takes
everything, so before that both figures are the same number under two names, and
"your larders are full" to a settlement with no larder reads as a bug.

### The bug it turned up

`Storage.accepts(resource)` meant two things at once — _is this the kind of thing I
take_ and _have I room_ — so a full yard answered "no" to "do you take logs" and
**dropped out of the count of how full the yards were**, at exactly the moment the
figure mattered. Split into `accepts` (a hauler's question) and `isFor` (a
bookkeeper's).

### And a correction to what kills a settlement

The opening was re-measured on a leaner line than the one in
[Why they die](#why-they-die--measured-not-fixed): eight stone marked on the first
day and small top-ups when short, rather than thirty marked up front. Over 24
seeds it is **220 deaths against 222** — no better — but it fails in a completely
different way, and the old explanation does not describe it:

|                  | The line above | The lean line                             |
| ---------------- | -------------- | ----------------------------------------- |
| Buildings raised | almost none    | 3 houses and a Woodcutter on all 24       |
| Deaths by hunger | —              | **120**                                   |
| Deaths by cold   | —              | 90                                        |
| First death      | midwinter      | **day 23, in summer**, on a third of them |

At day 22 a failing settlement holds **126 food lying in the field, none in
store**, ten people starving beside it, four labourers, and a job board carrying
**99 felling orders and up to 112 mining orders**. The food is made and never
carried: the settlement out-produces the hands it has to carry, while those same
hands are spread across two hundred standing orders.

That is a **hauling** failure, not a storage one and not the stone one. It is not
fixed, and it is not the same problem as the one above — both are real, and the
one a player meets first depends on how they open.

## Stock limits — Implemented

The player can say **enough**. Open the stores from the resource strip and every good carries a
stepper: _Keep at most_ — no limit, or a rung on a coarse ladder from nothing to two thousand.

What a limit does is deliberately narrow:

- a workshop whose **every** output has reached its limit posts no work, so its staff are handed back
  to the settlement exactly as they are when a crop is out of season — and pick the work up again on
  their own when the stores fall;
- carrying more of that good into a store drops to the bottom of the job board, the same way it does
  above the settlement's own appetite for it;
- a Feller's Hut cropping its own timber stops at the lower of its own target and the player's.

What it does **not** do is touch anything the player asked for by hand. A tree marked for felling is
an order, not a suggestion, and a limit that quietly cancelled orders would be the game arguing with
the player rather than carrying out a standing instruction.

Every output rather than any: a recipe that yields two goods is worth running for either of them, so
a Hunter whose meat is capped keeps hunting while it is the settlement's only source of hides.

The figure is measured against what is **on the shelves**, because that is the number the player was
looking at when they set it. Four hundred logs lying in the wood are not a reason to stop the sawmill;
they are a reason to carry them in.

A capped workshop says so in its panel — _Stopped — the settlement has enough stone_ — because on the
map a building the player told to stop and a building nobody is working look identical, and they want
opposite responses.

## Five foods, and a varied table — Implemented

One good called _food_ was the last place in the economy with no decision in it. Every building that
fed the settlement made the same interchangeable number, so a village with four gatherer huts ate
exactly as well as one with a field, an orchard, a fishing hut and a hunter — and the second had gone
to far more trouble for it.

| Building     | Brings in      | When                                                    |
| ------------ | -------------- | ------------------------------------------------------- |
| Gatherer Hut | **Spices**     | the growing seasons; nothing under snow                 |
| Field        | **Vegetables** | sown in spring, worth having in autumn                  |
| Orchard      | **Fruit**      | nothing until summer, then the best harvest in the game |
| Fishing Hut  | **Fish**       | every month of the year, best when the meltwater runs   |
| Hunter       | **Meat**       | lean in spring, fat before the cold — and hides with it |

**The calories are identical.** A fish feeds somebody exactly as well as a cabbage, and a settlement
living on one thing does not starve for it. All five carry and stack alike, too — that was measured:
a smaller basket for the smallest harvest cost twenty lives across twenty-four worlds, because
foraged food is what the whole opening runs on and carrying it at twenty a trip rather than thirty is
a hauling tax on the entire first year. **Foods differ by the season that brings them in**, which is
the axis worth having, and by how fast they turn.

### What variety is worth

A kind counts once the larder holds **half a day's ration of it per villager** — a token fish on the
shelf is not a diet. Every kind after the first is worth the same again, so the fifth is as welcome as
the second.

- **Spirit.** A full spread is a fifth of the way to contentment on its own, alongside water, the
  cemetery and the temple. Smaller than water, because it is a comfort collected for doing what the
  settlement was going to do anyway: nobody raises an orchard _for_ the variety.
- **Health, and so life expectancy.** A varied table takes a third off the chance of falling ill. A
  day spent unwell is already a day off the end of a life, so this is how food becomes life
  expectancy — and the population system never learns that food had anything to do with it. Well
  below the five-fold risk of sleeping rough: a settlement must never be able to eat its way out of
  homelessness.

Both are **collected rather than owed**. A settlement eating nothing but foraged roots plays exactly
the game it always played; it is simply not collecting.

### Two rules about which food comes off which shelf

**The exposed stock is eaten first** — the open yard before the larder. Food in a yard is food that is
about to rot, and a settlement that ate its way through the larder while the harvest spoiled outside
would be wasting the very building the player raised to stop that. Within one store the meal is drawn
**in proportion to what is held**, so a settlement eats mostly what it has most of and a varied larder
stays varied rather than having its smallest kind drained first.

### The Fishing Hut — Implemented

A jetty and a drying frame, on the river or on a channel dug to it — the second building whose place
on the map is a real decision. Cheap, like the Gatherer Hut, because the settlement that needs it most
is the one that has just found out its first spring is longer than its stores. It is the flattest yield
curve in the game: no harvest, worth about the same every month, best in the meltwater and still worth
something through the ice. The price is that fish keeps worse than anything else the settlement stores.

The HUD's strip still carries **one Food figure**, because "have we enough to eat" is still the
question; the stores drawer breaks it into the five.

## The one line of advice — Implemented

The HUD shows **one** warning at a time, the most urgent thing wrong. A stack of advice is noise, and
what the player needs to know is what to do _next_, not everything that could ever go wrong.

**Advice that cries wolf is advice a player stops reading**, and the food warnings had been doing
exactly that. They counted buildings — "is there a Gatherer Hut, and is there one for every six
people" — so a settlement eating comfortably off a field, an orchard and a fishing hut was told nobody
was gathering food, and a settlement with three hundred in the larder was told to build another hut.
Both were reported from a real game and both were fair: the player could see the food on the screen
while the banner said otherwise.

The rule now is that **the stores decide, not the buildings**:

- _Nothing is bringing food in_ — no standing building makes any of the five foods. Asked of the
  recipes rather than of a list of ids, so a sixth kind of food building later is a row in a data file.
  Still said on the first morning with a hold full of roots, because having food today is not having a
  food supply.
- _The food is running out_ — under a fortnight of food per villager **and the stores are not
  growing**. Days rather than an amount, so it holds as the settlement grows; the trend, because a low
  store that is filling is a harvest coming in rather than a famine. One remembered number — what the
  larder held at the end of yesterday — is the whole mechanism.

The firewood advice had the same defect and got the same treatment: it warned about having no
Woodcutter whatever was in the store, so a settlement that had salvaged or bought a winter's firewood
was nagged all autumn about a building it did not need. Nothing is said now until the woodpile is
actually short, and only then does it name what is missing — a Woodcutter, a Feller for it, or simply
more of it.

Measured over two years of a properly played settlement: **no food warning while there was food**, and
the two that do appear appear on the days they are true.

## What kind of year it is — Implemented

**The granary was never the decision it should have been.** Every year was the same year — the same
fourteen freezing nights, the same harvest — so a settlement that got through one winter got through
all of them, and a full larder in autumn was tidiness rather than insurance. Nothing in the game ever
asked the player why they were keeping two hundred food they did not need.

A year now has a character, and everything about how it is built is aimed at it being the opposite of
bad luck:

| Year         | Cold        | Harvest | How often |
| ------------ | ----------- | ------- | --------- |
| **kind**     | 1.5° milder | +15%    | ~1 in 5   |
| **ordinary** | —           | —       | ~2 in 5   |
| **hard**     | 2.5° colder | −20%    | ~1 in 4   |
| **bitter**   | 5° colder   | −38%    | ~1 in 7   |

- **Derived, not rolled.** From the world's seed and the year's number, so the same valley has the same
  history twice and a settlement replayed from its save meets the winter it met before.
- **Announced.** It is settled the moment the year begins and shown in the calendar all year — _Autumn ·
  Y4 · bitter year_ — which gives the player three seasons to answer it. A hard year the player was told
  about in spring is a plan; the same year sprung on them in December is a dice roll.
- **The first year is never hard.** A settlement's opening is already the hardest thing in the game, and
  a bitter first winter would be the game killing beginners for something they had no way to see coming.
- **Kind years exist**, and that is deliberate. A game whose weather can only be neutral or worse
  teaches the player to read every announcement as a punishment.

The cold is expressed as **degrees off the whole year** rather than as a count of freezing nights,
because the thermometer is already on the HUD: a bitter year _reads_ as bitter every day of it, and the
extra nights of fire fall out of the same number rather than being a second rule.

## Where the difficulty actually is — Measured

Worth writing down, because it was not what anybody assumed. Eight worlds, eight years, a player who
keeps a third of the adults free to carry:

- **Every single death is cold.** 149 of them, and not one from hunger or old age.
- **Food is solved.** 150–300 in store at every year's end, and one or two hungry days a year.
- **The settlement does not grow.** Ten people in year one, ten in year eight, with three dying and
  three being born each year. A churn, not an arc.

So the game has exactly one difficulty and it is firewood. Hard years sharpen it — the cold half lands
squarely on the thing already killing everybody — while the harvest half is currently decorative,
because a settlement with three hundred food does not notice losing a fifth of a harvest. Two things
follow, and neither is done yet: food has to be capable of being tight again for the harvest to mean
anything, and the population needs a reason to grow.

## The harvest nobody is carrying — Implemented

Measured on a settlement that built the obvious things: by its fourth autumn it had **forty-three food
on the shelves, two hundred and ninety-two lying in the fields**, and every adult inside a workshop. It
starved to death with four years of harvest on the ground.

Nobody was carrying anything, and the banner said _the food is running out_ — which is true, and sends
the player off to build another hut, which takes two more pairs of hands off the road. The intuitive
answer made it worse.

The settlement does **not** fix this itself. Who works where is the player's decision and the game
handing it back to them would be the game playing itself. What it owes them is the sentence: _the
harvest is lying in the fields — take somebody off a workshop_, said before the starvation warning
because it is the reason for it.
