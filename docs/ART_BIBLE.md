# Art Bible

Conventions every asset must follow. **These are decisions, not descriptions** — almost no
production art exists yet, and the current build ships coloured rectangles.

Status: **Planned** unless marked otherwise. Values marked _provisional_ may change once real
artwork is drawn, but they are fixed for Phase 2 so that placeholder geometry stays correct.

---

## Direction

A detailed illustrated medieval settlement, viewed like a **living tabletop diorama**.

Grounded, atmospheric, natural, serious, readable, and slightly melancholic. This is a world where
winter is genuinely dangerous, and the art must carry that.

**Buildings dominate. Characters are small.** A villager is roughly a third the height of a house.
The settlement is the subject; the people are what makes it live.

| Prefer                                    | Avoid                        |
| ----------------------------------------- | ---------------------------- |
| Muted greens, earth tones, mud            | Saturated, candy colour      |
| Aged timber, dark stone, thatch           | Clean, new-looking materials |
| Autumn ochres, cold winter blues          | Bright primaries             |
| Soft shadows, smoke, mist, rain, snowfall | Thick black outlines         |
| Restrained, weighty animation             | Bouncy, exaggerated motion   |
| Realistic adult proportions               | Chibi, cartoon proportions   |

The mobile-game "toy" aesthetic is explicitly rejected.

**All artwork must be original.** No assets, designs, colour scripts or silhouettes taken from any
existing commercial game.

---

## Camera and projection

- **2:1 dimetric** ("isometric") projection. A tile is twice as wide as it is tall.
- Fixed camera angle. No rotation — rotation would double or quadruple every directional asset.
- Camera pans and zooms only.

_Provisional_ tile dimensions:

| Property      | Value      |
| ------------- | ---------- |
| Tile width    | 64 px      |
| Tile height   | 32 px      |
| Vertical unit | 16 px      |
| Zoom range    | 0.25×-2.5× |

The vertical unit is the height of one elevation step, used for terraces and building storeys.

```text
        ┌───64 px───┐
             ╱╲
           ╱    ╲          One tile, 2:1 dimetric.
         ╱        ╲  32 px The diamond is the tile's
         ╲        ╱        footprint on the ground.
           ╲    ╱
             ╲╱
```

---

## Anchors

Anchor conventions are what keep a sprite standing in the right place. Get these wrong and
everything drifts.

**Buildings** — anchor at the **bottom centre of the footprint diamond**, i.e. the front corner of
the occupied tiles. Origin `(0.5, 1.0)`.

A building occupying a `width × height` block of tiles has a sprite that may be much taller than the
footprint, but its base always aligns to the diamond.

```text
        ╱▔▔▔▔╲          roof may overhang freely upward
       │      │
       │      │
        ╲    ╱
         ╲  ╱
          ╲╱ ◄──── anchor: bottom centre of footprint
```

**Characters** — anchor at the **feet**, origin `(0.5, 1.0)`, standing at the centre of their tile.

**Resource piles and props** — anchor at the base, origin `(0.5, 1.0)`.

**Terrain tiles** — anchor at the top-left of the sprite's bounding box, origin `(0, 0)`, positioned
by grid conversion.

Rule: everything that stands on the ground anchors at the point where it touches the ground.

---

## Sprite dimensions (provisional)

| Asset class            | Footprint | Sprite size | Notes                          |
| ---------------------- | --------- | ----------- | ------------------------------ |
| Terrain tile           | 1×1       | 64 × 32     | May extend downward for cliffs |
| Villager               | —         | 32 × 48     | ~2/3 tile width                |
| Tree                   | 1×1       | 64 × 96     | Canopy overhangs the tile      |
| Small building (house) | 2×2       | 128 × 128   |                                |
| Medium building        | 3×3       | 192 × 176   |                                |
| Storage yard           | 3×3       | 192 × 96    | Low, open                      |
| Resource pile          | 1×1       | 64 × 40     | Grows with stored amount       |

A villager at 48px against a 128px house gives the intended "people are small" reading.

---

## Render sorting

Isometric sorting must be **deterministic and centralised**. No hand-assigned z-index anywhere in
gameplay code.

Sort key, applied by one shared function:

```text
depth = (gridY + gridX) * LAYER_SPAN + layerOffset
```

- Objects further back (lower `gx + gy`) draw first.
- `layerOffset` separates co-located things: terrain < flat overlays (roads, designations) <
  resource piles < buildings < characters < effects.
- Multi-tile buildings sort by the **front-most** tile of their footprint, otherwise a villager
  standing beside a large building will incorrectly draw behind it.

Ties must break consistently — by entity id — so the same scene never renders in two different
orders.

---

## Lighting

- Single key light from the **upper left**, consistent across every asset.
- Shadows fall **down and to the right**, soft-edged, low opacity.
- Shadows are baked into sprites where static; dynamic contact shadows are a separate soft ellipse.
- Ambient light shifts by season and time of day; assets are painted **neutral** so tinting reads
  correctly.

An asset lit from a different direction will look wrong next to everything else. This is the single
most common consistency failure in isometric art.

**One module owns all of it: `renderer/phaser/terrain/shading.ts`.** Buildings, trees and villagers
all cast through the same `contactShadow`, so nothing can quietly start casting a different way.

Three things live there beyond the light direction, and each is a specific cure for a specific tell
that an object is a flat polygon rather than a thing:

- **Contact shadows have a penumbra.** Three rings, widest and faintest first. A hard-edged shadow
  is the loudest remaining giveaway; a real one is tight and dark at the contact and fades from
  there, and the eye reads that gradient as _sitting on_ rather than _drawn over_.
- **Corners collect gloom** (`occlude`). Light does not reach into the join between two surfaces, so
  every corner in the world is darker than the faces meeting there. Approximating that at the wall
  base and under the eaves is most of what separates a rendered object from a flat one. **Keep it
  light**: the first pass stacked base gloom, eaves gloom and the roof fascia and turned a wall into
  a band of darkness with a stripe of stone showing.
- **Seams catch light** (`bevel`). Timber and stone have a rounded arris. One bright line along the
  corner where two walls meet is the difference between a corner and a fold in paper.

All of it is free at runtime: every object is drawn into its texture once, at load.

---

## Value separation — Implemented

**The single biggest change the art has had, and it was not detail.**

Every building used to be brown walls under a slightly darker brown roof. Zoomed out to a
settlement, that is one silhouette with no parts: a Woodcutter, a House and a Tailor were the same
brown lozenge. Adding ambient occlusion, bevels and a roof fascia to that changed almost nothing,
because the problem was never the shading — it was that **the roof and the wall had the same
value**.

The rule now: **a roof and the wall under it must differ clearly in lightness**, not only in hue. A
house is limewashed daub on a dark oak frame under a russet tiled roof, which is both historically
right and immediately readable at any zoom. Workshops keep timber walls but the roof drops well
below them; quarry and mine are pale cut stone under slate; the School is dressed stone, paler than
anything around it, because the settlement's one monument should be legible from across the map.

"Muted" was being read as "low contrast". The brief asks for muted greens, earth tones and aged
timber — none of which requires a roof to be invisible against its own wall.

---

## Seasonal variants

Season affects mood as much as colour, and is a core survival signal — the player should feel winter
approaching before reading any number.

| Season | Palette                                     | Effects              |
| ------ | ------------------------------------------- | -------------------- |
| Spring | Fresh damp greens, brown mud, grey-blue sky | Rain, mist           |
| Summer | Deeper greens, dry ochre, warm light        | Haze, dust           |
| Autumn | Ochre, rust, umber, low warm light          | Falling leaves, mist |
| Winter | Desaturated blue-white, dark bare timber    | Snowfall, smoke      |

Approach: **tint and overlay first, unique sprites only where necessary.** Terrain and vegetation get
seasonal variants; buildings are tinted, with snow as a separate overlay layer. Four full sets of
every building is not affordable and not needed.

---

## Faceted shading — Implemented

The house style is **low-poly**: every surface is a small number of flat-shaded planes, and the form
is implied by the shading rather than by texture or line. There are no gradients and no outlines
anywhere in the world layer.

The rules that follow from that, and that everything drawn so far obeys:

- **Every mass gets at least a lit face and a shaded face**, split with the key light from the upper
  left. A single-colour shape beside a faceted one reads as a sticker on the scene, which is what
  made the first tree pass look like wallpaper.
- **Ground is two facets**, meeting along one of the tile's diagonals, at a few percent apart. That
  is enough for a field to read as undulating and little enough that it does not read as a
  chequerboard.
- **Detail is bought with facets, never with saturation.** A brighter colour to make something
  visible breaks the muted direction; another plane does not.
- **Nothing in a terrain tile may line up with the cell boundary.** This one was learned three times
  over while drawing snow: an edge left showing, a darker drift along the tile's front, and a crease
  running corner to corner all produced the same thing — a lattice ruled over the whole map, which
  is the most conspicuous possible way to break the rule that terrain should hide the grid. Ground
  detail lives strictly in the tile's interior.
- **Terrain carries no outline at all.** It used to, so that two tiles of the same type stayed
  legible where they met. Faceting and scatter do that job now, and the line was the grid, drawn.

### Variants

| Asset   | Variants | Chosen by                              |
| ------- | -------- | -------------------------------------- |
| Terrain | 4 / type | A hash of the cell's own `(gx, gy)`    |
| Tree    | 6        | The simulation, from its seeded stream |

Terrain variants are hashed rather than stored: the choice must survive a season change, a repaint
after felling and a reload, and nothing about it belongs in a save. The hash needs real avalanche —
the obvious `(gx * prime) ^ (gy * prime)` keeps only its low bits after the modulo, and the low bits
of a product depend only on the low bits of its factors, so every cell on a diagonal came out
identical. `tests/ground-art.test.ts` checks that rows, columns and diagonals all use more than one
variant.

Tree variants come from the simulation because they are saved; the renderer takes every variant
modulo the number of shapes it can draw, so the two counts agree by intent rather than by
construction — the simulation cannot import the renderer.

---

## Animation

Restrained and weighty. People in this world are tired and cold, not springy.

| State | Frames | Rate   | Notes                            |
| ----- | ------ | ------ | -------------------------------- |
| Idle  | 2-4    | 4 fps  | Subtle; slight sway or breath    |
| Walk  | 6-8    | 10 fps | Grounded, no exaggerated bob     |
| Work  | 4-6    | 8 fps  | Chopping, hauling, building      |
| Carry | 6-8    | 10 fps | Walk cycle variant, visible load |

Directions: **4** (NE, SE, SW, NW), matching the projection. Not 8 — the cost quadruples for little
readability gain at this character size.

Animation state is chosen by the renderer **from simulation state**. The simulation says
`position` and `currentAction`; the renderer decides which clip plays. The simulation never names an
animation.

---

## Asset naming

Lowercase, hyphen-separated, most general segment first:

```text
<category>-<subject>[-<variant>][-<season>][-<direction>][-<frame>].png
```

Examples:

```text
terrain-grass-01.png
terrain-water-edge-ne.png
vegetation-pine-summer.png
vegetation-pine-winter.png
building-house-small.png
building-house-small-construction-02.png
villager-walk-ne-03.png
ui-icon-firewood.png
```

Directory layout under `public/assets/`:

```text
terrain/  buildings/  villagers/  vegetation/  ui/
```

Rules: no spaces, no capitals, no version suffixes in filenames (`-final-v2` is what git is for),
zero-padded frame numbers.

---

## Placeholder art rules — Implemented

Until real artwork exists, placeholders must preserve **correct geometry**: dimensions, anchors,
footprints, tile size and character scale. Colour and detail may be crude.

The point is that replacing a placeholder with finished art becomes a file swap, never a layout
rewrite.

The whole palette lives in `src/renderer/phaser/terrain/seasonalPalette.ts` — terrain, canopy,
trunk, ground detail and ambient light, for all four seasons. Keeping colour in one file is what
makes a re-tint a data change rather than an art rewrite.

It is muted and earthy on purpose. Even the prototype should never read as a bright toy.

### Where the placeholder art lives

| File              | Draws                                                      |
| ----------------- | ---------------------------------------------------------- |
| `groundArt.ts`    | Terrain tiles: facets, tufts, rock outcrops, ripples, snow |
| `treeArt.ts`      | Conifers and broadleaves, through the year                 |
| `buildingArt.ts`  | Walls, timber framing, roofs, plinths, chimneys, doors     |
| `tileTextures.ts` | Atlas assembly, plus villagers, piles, yards, sites, roads |

Everything is generated into **two atlases** — one for ground, one for trees — plus a handful of
standalone textures. That is not tidiness: the display list is depth-sorted, which interleaves
terrain types and tree shapes, and a GPU batch breaks whenever the texture changes between adjacent
objects. Adding variants to an atlas costs nothing at draw time; adding textures would cost a batch
break per variant on exactly the low-power tablet GPUs this project targets.

---

## Hearth smoke — Implemented

The one thing on the mood list — _smoke, mist, rain, snowfall_ — that says
somebody is **home** rather than that weather is happening. A village of static
boxes reads as a diagram of a village; one thread of smoke bending off a roof
does more for "people live here" than any amount of detail carved into walls.

- Only buildings with a hearth: **House, Blacksmith, Healer's House,
  Herbalist's Hut.** A settlement where every shed smokes reads as a settlement
  on fire.
- It leaves the **top of the actual stack**, not the middle of the roof. The
  chimney's offset is exported from `buildingArt.ts` so there is one answer to
  where a chimney is, rather than the art and the effect each having their own.
- **Heaviest in winter, lightest in summer, never zero** — a hearth is also a
  kitchen, and a village with no smoke at all in July looks abandoned.
- One constant wind. A turning wind would swing every plume together like a
  shoal, which reads as one system animating rather than fifty separate fires.
- Each puff carries its own rise, drift and life, so a column frays into a plume
  instead of rising as a string of beads. Rise decays, so it leans over.

**Drawn in the `SKY_BAND`, above every roof.** Smoke blows sideways across
whatever is downwind, so sorting it by the cell it came from would put a plume
_behind_ the house in front of its own chimney. That is the second sanctioned
exception to isometric sorting, and like the first it lives in `sorting.ts`
rather than as a magic number at the call site.

The maths is in `effects/smoke.ts` with no Phaser in it, so the behaviour that
matters — rises, drifts, thins, dies, and never grows without bound — is tested
headlessly. The ceiling on live particles is a real backstop, not decoration:
a particle system with no bound is the classic way to turn a pleasant effect
into a frame-rate bug six months later.

---

## Trade props — Implemented

Mass and colour get a building most of the way to being recognisable and then
stop: a Woodcutter and a Tailor are both a brown box with a pitched roof. One
small object on the plot says which trade it is without a label.

| Prop     | Where                           | What it reads as                 |
| -------- | ------------------------------- | -------------------------------- |
| Log pile | Woodcutter, Forester's Lodge    | Split rounds, pale on dark       |
| Forge    | Blacksmith                      | The only warm colour on the map  |
| Racks    | Herbalist's Hut, Hunter's Cabin | Bundles hung to dry              |
| Cart     | Trading Post                    | The one object meaning "leaving" |
| Spoil    | Quarry, Mine                    | A heap of cut rock               |

Drawn **on the ground at the front of the plot**, not on the walls. Detail
carved into a wall is the first thing to disappear when the player zooms out to
look at the whole settlement; a silhouette on the plot survives it.
