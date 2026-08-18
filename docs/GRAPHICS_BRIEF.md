# Graphics brief — for an agent working only on the look

Status: **Implemented** as a contract. Everything it describes about the current renderer is
true today; everything it asks for is work that has not been done.

This document exists for one situation: **somebody is being given this repository to make the
game look better, and nothing else.** It says what may be changed, what may not, and how to
know the difference. Read [ARCHITECTURE.md](./ARCHITECTURE.md) and
[ART_BIBLE.md](./ART_BIBLE.md) first — this is the working contract on top of them, not a
replacement for either.

---

## The one rule everything else follows from

**The simulation does not know that a renderer exists.** A villager sprite is a picture of a
simulation villager; the sprite is not the villager. A building's texture is a picture of a
`Building`; the texture is not the building. Every decision below is downstream of that.

```text
Player input ──▶ Commands ──▶ Simulation ──▶ Game state ──▶ Presentation (Phaser)
                                                              ▲
                                                     you are here, and only here
```

It is enforced mechanically, not by trust. `eslint.config.js` forbids `src/simulation/**` from
importing Phaser, touching the DOM, or calling `Math.random`. If a change makes the renderer
need something the simulation does not expose, **the answer is a new read-only accessor on the
simulation, never a calculation in the renderer** — because a number computed in a sprite is a
number that does not survive a save, a reload, or a headless test.

---

## Files you may change

Everything under these paths is presentation and is yours:

```text
src/renderer/phaser/
  scenes/            the Phaser scenes
  entities/          one renderer per kind of thing: buildings, villagers, resources, connectors
  terrain/           tile textures, ground art, building art, tree art, seasonal palette, shading
  camera/            camera plumbing
  effects/           weather, smoke

src/ui/styles/       all CSS
public/assets/       art files, if any get drawn
docs/ART_BIBLE.md    the conventions themselves, when a decision genuinely changes
```

`src/ui/**` outside `styles/` is HUD _logic_ — panels, the ledger, the guide. Restyling it is
fine; changing what it says is not this job.

## Files you may not change

```text
src/simulation/**    the whole simulation, including data-driven balance it reads
src/data/**          buildings, resources, recipes, terrain, population
src/input/**         unless a visual change genuinely needs a new gesture, and then say so first
tests/**             except to add rendering tests of your own
```

**`src/data/buildings.ts` is the sharpest edge here**, because it is tempting: it holds each
building's `footprint`, and a footprint is visible. It is also the simulation's grid occupancy,
its navigation blocking, its placement validity and its save format. **A footprint is not an art
decision.** If a building's art wants more room, draw it with a wider roof overhang — see
`eaves` below — and leave the footprint alone.

---

## How buildings are drawn today, and where the detail goes

There is no artwork in this project. Every building is **generated geometry**, drawn once into a
Phaser texture at startup and then used as a sprite. The whole of it is
`src/renderer/phaser/terrain/buildingArt.ts`, and it is about 700 lines of deliberate,
readable drawing code:

- `MASS[id]` gives each building its `wallHeight`, `roofHeight` and `eaves`, in pixels;
- `baseSize(footprint)` derives the base rhombus from the footprint — a `w × h` plot is
  `(w + h) · TILE_WIDTH / 2` across and `(w + h) · TILE_HEIGHT / 2` tall;
- `buildingTextureSpec(id)` sizes the texture and places the anchor exactly on the footprint's
  centre;
- `drawBuilding()` extrudes the rhombus into walls, caps it with a roof, and adds per-building
  detail;
- `shading.ts` has the primitives: `polygon`, `shade`, `bevel`, `occlude`, `contactShadow`.

**This is where more "polygons" belong.** A richer House means more shapes inside
`drawBuilding` — a porch, a lean-to, a woodpile against the gable, plank lines on a door, a
stone footing course under the timber, a sagging ridge. It does not mean a bigger footprint, a
new anchor convention, or a sprite that spills onto its neighbour's plot.

Three constraints on that work, and all three are load-bearing:

**The anchor is the footprint's centre, on the ground line.** `buildingTextureSpec` returns a
`groundLine` fraction and `BuildingRenderer` uses the same one. Whatever you draw, the ground
line must still be where the building meets its plot, and the texture must still contain the
half-rhombus that falls _in front of_ the anchor — forgetting that is what once clipped every
building's front edge.

**Sorting is by depth, and it is not yours to override.** Objects further back draw behind
objects further forward, from one rule. Do not assign `depth` by hand in drawing code. If two
things sort wrongly, the fix is in the sorting rule or in the anchor, never a magic number.

**Height is free, width is not.** A building may be as tall as it likes — that is what makes
buildings dominate and villagers small, which the art bible asks for. Growing _sideways_ past
the base rhombus plus `eaves` puts painted wall over ground the simulation says is walkable,
and a player will try to build there.

## Seasons, weather and light are already wired

Do not invent a second system for any of these; extend the ones that exist.

- `seasonalPalette.ts` tints terrain by season. Winter is cold and blue, autumn is ochre.
- `BuildingRenderer` holds a `seasonTint` and applies it to buildings raised later as well.
- Smoke rises from `chimneyOffset(id)` / `chimneyMouth(id)`, which return per-building points.
- Weather lives in `effects/`.

If a new building wants smoke, give it a chimney offset. If a season should change how a roof
reads — snow on thatch, say — that is a palette or an overlay in the seasonal system, not a
second set of textures keyed off a global.

## Connectors: roads, ditches and bridges

`terrain/connectors.ts` and `entities/ConnectorRenderer.ts` handle anything that has to join up
with its neighbours. A road takes corners and crossings from a 4-bit mask of which sides it
connects to; a ditch joins other water; a bridge joins both roads and the bank. **A bridge is
drawn by the connector renderer, not the building renderer**, because a finished bridge _is_ a
road. If you touch these, keep the mask model — it is what makes curves and junctions work
without a case for every shape.

---

## Performance, which is a design constraint and not a detail

The target is 50 active villagers comfortably, architected toward 100–300. The reason the
current renderer is fast is not luck:

- **textures are generated once**, at startup, and reused as sprites. Per-frame `Graphics`
  drawing for hundreds of objects is the single easiest way to destroy this game's frame rate;
- **renderers sync on a version number** — `BuildingRenderer.sync` returns immediately when
  `buildings.version` has not moved — rather than rebuilding the scene every frame;
- **nothing in the world is a DOM node.** No villagers, no trees, no piles. The HUD is HTML; the
  world is the WebGL canvas;
- **the simulation ticks on a fixed clock**, ten times a second, independently of the frame
  rate. The renderer interpolates between the last two positions. Never do economic or AI work
  in a render path, and never read `delta` to advance simulation state.

Anything that adds per-frame allocation in a hot loop, a timer per object, or a `Graphics`
redraw per building per frame is a regression however good it looks. If you want an effect that
seems to need it, say so and describe the cost — do not ship it quietly.

## Mobile and responsive, which is the primary target

Tablet landscape first, phone landscape second, desktop for development. The canvas fills the
viewport at any aspect ratio from 4:3 to 16:9; the UI respects safe-area insets; touch targets
are generous. Hover, right click and keyboard are never required for anything.

Test any visual change at a phone-landscape size before calling it done. A texture that reads
beautifully at 2× zoom on a desktop monitor and turns to mud at 0.35× on a tablet is not an
improvement, and zoom range is 0.35×–2.5×.

---

## Originality

**Everything must be original.** No assets, no UI layouts, no colour scripts, no silhouettes, no
building designs, no names, no text and no code taken from any existing commercial game. Being
_inspired by_ deep settlement simulations is the brief; resembling one specific game's art is
not. If a reference is needed, use real medieval vernacular architecture — timber framing,
thatch, drystone, turf — and the actual landscape of the Merindades north of Burgos, which is
where the settlement's name comes from.

## The gate before any commit

Every one of these must pass, and the last one is the one people forget:

```bash
npx tsc --noEmit     # strict, with noUncheckedIndexedAccess
npm run lint         # includes the rules that keep the simulation pure
npm run format:check
npx vitest run       # ~950 tests, including simulation balance
npm run build
```

The test suite is not a formality here. It runs headless, without Phaser, and it is how this
project knows that a change to the _look_ did not change the _game_. If a rendering change makes
a simulation test fail, the rendering change is wrong — that is precisely what the separation
is for. Conventional commits, small and coherent.

## What "good" looks like when you are done

A player who has seen the current build should recognise the same settlement, in the same
places, at the same sizes, running at the same speed — and find it much better drawn. Nothing
about the year, the economy, the pathfinding, the save format or the frame rate should have
moved at all.
