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
└── random           each seeded stream's position
```

### Why terrain is stored rather than regenerated

World generation is deterministic from the seed, so in principle the terrain could be rebuilt from
`worldSeed` alone. It is stored anyway, because villagers reshape it: trees are felled, stone is
mined, ground is built on. Regenerating would restore a pristine wilderness around a settlement that
had spent a year clearing it.

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

## Where saves live

IndexedDB, one record per slot, under an autosave key written every few minutes and whenever the
player asks. When the browser has no IndexedDB the game falls back to an in-memory store, so it still
runs — saves simply do not survive a refresh, and the game does not pretend otherwise.

---

## Planned

- More than one save slot, and naming them.
- Migration rather than refusal for old versions, once the format is worth migrating.
- Export and import to a file, so a settlement can outlive a browser profile.
