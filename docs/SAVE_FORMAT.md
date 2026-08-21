# Save Format

Status labels: **Implemented**, **Prototype**, **Planned**.

**Implemented.** Saves are versioned JSON-compatible documents held in IndexedDB, written by
`src/simulation/save/serialise.ts` and described by `src/simulation/save/SaveGame.ts`.

---

## What is saved

The **authoritative simulation state**, and nothing from Phaser. No sprite, camera or scene object is
ever serialised: the renderer is rebuilt from the restored simulation, which is what makes the
renderer replaceable.

```text
SaveGame
├── version          format version, currently 1
├── worldSeed        so the world's identity survives
├── simulationTime   the tick, which fully identifies season, day and year
├── world            terrain buffer, trees, stone, resource piles, roads
├── villagers        position, needs, inventory, job, path, activity
├── buildings        definition id, origin, construction progress, stores, yard opened
├── storages         cells, capacities, contents, and how well each keeps food
├── jobs             the whole board, verbatim
├── deaths           the settlement's toll
├── chronicle        lifetime tallies, for the settlement's own history page
├── necrology        every death: name, age, cause, year — the closing page's roll
├── wear             fractional wear the settlement still owes
└── random           each seeded stream's position
```

### Why the chronicle and the roll of the dead are stored rather than recomputed

Every figure in it is about the **past**: who was born, who was buried, how many walls went up, the
coldest night anybody stood through. A snapshot of the present cannot be asked what the past was —
by year thirty most of the people the chronicle counts are dead and most of its winters are decades
gone. Recording it as it happens is the only way to have it at all.

The roll of the dead is the stronger case of the same argument: a name and an age at death cannot be
recomputed from _anything_, because the person they belong to is gone. A settlement that forgot its
dead on every reload would show a clean history beside an unexplained population.

A save written before the rescue arc was removed may still carry a `rescue` field. Nothing reads it,
and an unknown field is ignored rather than rejected, so those settlements load exactly as they were
apart from a bottle nobody is waiting on any more.

`chronicle`, `necrology` and `wear` are all optional fields, so a save from before any of them
existed still loads: it restores with an empty history and an empty roll, which is the honest reading
of a settlement whose past was never written down.

### Why terrain is stored rather than regenerated

World generation is deterministic from the seed, so in principle the terrain could be rebuilt from
`worldSeed` alone. It is stored anyway, because villagers reshape it: trees are felled, stone is
mined, ground is built on. Regenerating would restore a pristine wilderness around a settlement that
had spent a year clearing it.

### Why a ditch needs nothing new, and a bridge needs nothing at all

Terrain is one byte per cell, indexed into `TERRAIN_TYPES` — so that list is **append-only**.
`ditch` was added at the end, which leaves every existing index meaning what it always meant; a save
written before ditches existed loads with no ditches in it, which is true.

A bridge is a building standing on a cell of water, and the boards it carries are a road: both were
already saved. The one thing the loader has to know is that a finished crossing **opens** its cell
rather than blocking it, or a settlement would load with bridges nobody could walk over.

### Why the settlers' landing place is stored

`landfall` is the cell the ten settlers arrived on, and everything about where the settlement _is_
hangs off it: the founding yard's radius, the reachability check that decides whether a site can be
built, and where the camera looks when a save opens. The world memoises it from the terrain the
first time anything asks, which is right for a new valley and wrong for a loaded one — a settlement
loaded over another world anchored itself on the previous valley's camp. It is written into the save
and restored before anything reads it. Older saves have no `landfall` field and fall back to
recomputing, which is what they were doing anyway.

### Why the seed is restored as well as stored

`worldSeed` was written into every save from the first version and read by nobody: loading replaces the
contents of an existing simulation, and that simulation kept the seed it was _founded_ with. Every
random stream is restored with its own position, so almost nothing noticed — except the one thing that
asks the seed directly, which is what kind of year a given year is. A loaded settlement inherited the
hard and bitter years of whatever world the player happened to have open, so the same file had a
different future in every session, and saving it again wrote that wrong seed into the file. The seed is
now adopted before anything asks the world a question about itself.

### Why loading counts as a new world for the renderer

The presentation layer refreshes off version counters, and a load bumped only the load counter — so
the buildings, trees, villagers and roads all reloaded while the ground stayed painted as the valley
the player had just left. Saved houses stood in rivers that were no longer there. A load replaces
the world's contents wholesale, which is exactly what `worldVersion` means, so loading bumps it and
the scene is rebuilt rather than re-synced. The terrain is the reason: its ~9,200 tiles are painted
once when the scene opens and repainted only for a season or a felled tree, never for a whole new
map.

### Why the RNG position is stored

A seeded stream is only reproducible from its **position**, not merely its seed. Saving the seed but
not the cursor meant a loaded settlement replayed numbers the original had already consumed, so the
same save diverged from the game it came from. Each system's stream records where it had got to.

### Why paths are stored

Villagers carry their current path, destination and activity. Without them, every villager on a
loaded map forgot the errand it was running and planned a fresh one, so the settlement visibly
lurched at the moment of loading.

---

## Versioning

`SAVE_VERSION` is a single integer. A save whose version does not match is **refused**, and the UI
says so — "Save is from another version" — rather than loading something it does not understand and
corrupting a settlement.

Bump the version when a change would make an existing save load _incorrectly_. Additive changes that
restore sensibly from a default do not need a bump, and there have been four:

- jobs gained a `reservationSlot` when workshops learned to staff more than one worker, and an older
  save restores with slot 0 — right for every job that existed then;
- storages gained a `preservation` figure, defaulting to 1, which is the open yard every storage in
  an older save was behaving as;
- buildings gained the id of the yard they opened, and a finished storage building without one
  simply opens its yard on the next tick;
- the world gained a list of paved cells, and a save written before roads existed restores as a
  settlement with none — which is the correct reading of it.

Roads are stored as a **list of cells** rather than a second full-map buffer, because they are
sparse: a well-connected settlement has tens of them on a map of some nine thousand cells. They are
restored _before_ the navigation grid is rebuilt, not after — the grid reads them while it re-costs
every cell, so the other order would leave a settlement whose roads were drawn but not routed over
until the next one was laid.

Doorways are the exception to storing things: a building's access cell is **recomputed** on load
rather than saved, because which cell is standable depends on what every other building blocks, and
that is only known once the whole save is in place.

---

## Where saves live — Implemented

IndexedDB, and **one record per settlement**: the slot key is derived from the settlement's own name,
so `Peñalba` lives under `settlement:peñalba` with a small `summary:` record beside it. When the
browser has no IndexedDB the game falls back to an in-memory store, so it still runs — saves simply do
not survive a refresh, and the game does not pretend otherwise.

The summaries are what the menu lists. They exist because a save is a megabyte of terrain and a menu
row is a name and a year: reading four saves to draw four buttons would be four megabytes of parsing
for a screen the player looks at for a second.

### A name is the file

One autosave in one slot is right for a game with one settlement and wrong for a game about founding
them. A player who begins again after a hard winter wants _their_ valley back — the one with the bridge
in the wrong place — not whichever run was saved last. So:

- **A settlement is named when it is founded**, in the main menu, from a box that opens with a
  suggestion already in it (taken from the world seed, so the valley reads as already having a name).
- **Nothing is written before it has one.** An unnamed run is deliberately unsaveable: there is nowhere
  to put it.
- **Two settlements never share a name.** The second Peñalba is _Peñalba II_ — roman numerals, because
  this is a game about medieval settlements and that is where roman numerals belong. Clashes are
  judged by slot, so `Peñalba` and `peñalba` are one village rather than two.
- **The name is tidied, not rejected.** Double spaces, trailing spaces and a paragraph pasted into the
  box are things a player did by accident, and an error message is a worse answer than quietly fixing
  it.

### Permadeath

**A settlement's file is written as each year turns, and deleted when the settlement dies.**

That is one file, always holding the last new year. There is no going back to a better winter, so the
only honest moment to write is the turn of a year — where the player can see it happen and knows what
they are keeping. And when the last villager is gone the record goes with them: leaving the final
autosave behind would quietly hand the player a way to un-lose the run, which is the whole thing
permadeath is for. The name is dropped at the same moment, so the next valley has to be founded and
named like any other rather than inheriting a dead village's file.

The check runs every frame rather than only on the frames that advanced the clock: a settlement can
die on the tick the player pauses, and the file has to go either way.

Saves written before settlements had names are still listed, under a placeholder — those settlements
were founded before anybody asked, and refusing to show them would be the update eating a player's
village.

---

## Planned

- Migration rather than refusal for old versions, once the format is worth migrating.
- Export and import to a file, so a settlement can outlive a browser profile.
