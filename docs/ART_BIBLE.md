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

## Structures that are platforms — Implemented

The generic building routine could draw one thing: a box on a plot, optionally with a roof and a
stone footing. That covered a house, a workshop and a shed, and it did not cover the storage yard,
which is a **deck** — and it showed. The yard was a flat lozenge with three
axis-aligned rectangles lying on it, and since the founding camp borrows this art it was the first
structure every player ever saw.

So the yard has its own routine, and it establishes four conventions for anything else that turns out
not to be a box:

- **A platform stands off the ground, and you can see under it.** The strip of shadow between the
  boards and the soil is what makes it a built thing standing in the world rather than a shape lying
  on it. Nine pixels of visible gap: at four it read as a thick rug.
- **Boards are drawn as boards.** The deck is filled dark and each plank drawn inside that fill, so
  the line between two of them is a real gap. Three tones in a repeating run, because two alternating
  shades read as a stripe pattern and three read as timber. The planks run along one footprint axis,
  so their sawn ends show on one near edge and the long side of the last board on the other — and
  those are drawn as different things, because they are.
- **A raised deck's shadow belongs under it.** The standard contact shadow spreads to 1.24× the
  footprint, which reached right across the apron and turned the path into a smudge. Platforms use a
  tighter one.
- **If it leaves the ground, show the way up.** Two boards from the path to the near corner. Six
  polygons, and it answers the question the eye asks the moment a deck is not on the soil.

### Ground outside the plot — the apron

A working yard wears a path into the grass around itself, and a path that stops dead at the plot
boundary reads as a rug. `BuildingMass.apron` is the **one sanctioned way for a building's art to
reach past its own footprint**: it widens the texture on every side and is counted into the ground
line with it, so the anchor stays exactly on the footprint's centre.

Nothing about the simulation changes — the footprint is still the footprint, and still what blocks
navigation and validates placement. Growing a footprint to make room for art would change all three.

### Goods are solids

Crates, barrels, sacks and cut timber on the deck are flat-shaded isometric prisms, not billboards:
three faces each, lit from the upper left like everything else, each with its own small shadow on the
boards, drawn back to front so they overlap the way objects do. A barrel is a ten-sided prism whose
facets take their tone from how far each turns from the light — the settlement has no gradients, so a
curve is assembled from flats.

Their arrangement is fixed and deliberately uneven. Goods on a grid read as an inventory screen; a
yard is stacked by people putting things down where there is room.

### A yard is drawn as full as it is

Five textures, from bare boards to piled high, chosen by how much the store holds. The goods are
declared in the order a yard actually fills — the back corner first, because that is where somebody
carrying a crate in puts it down — and a level takes the first few of them.

**The level comes from an absolute figure, not from the store's capacity.** The founding yard holds
two thousand, which is a number the player never sees and which exists so the camp can never be the
thing that stops them; tie the picture to it and the settlement's whole first year is drawn as an
empty platform. Three hundred goods is a yard that looks stocked.

This is a **renderer** change and no part of it is a simulation one. The renderer reads
`inventory.total` and picks a texture; the simulation neither knows nor cares that the picture
changed. Both yard renderers do it — the founding camp in `ResourceRenderer` and built yards in
`BuildingRenderer` — each on its own version counter, because a yard filling up is not a change to
the _buildings_, and swapping a texture only when the level actually moves.

---

## Buildings sit on their plots — Implemented

**No building's art may leave its footprint.** The footprint blocks navigation, validates placement
and gets saved, so art that oversails it promises the player ground they cannot build on and cannot
walk through — and two buildings raised side by side draw over each other.

The temptation is real, because a building wants ground around it: a yard wears a path, a cottage has
a garden. The answer is not to draw past the plot edge but to **make the building smaller and draw
the ground inside the plot** — `BuildingMass.inset`. A 3x3 yard is a deck with a path round it at
0.7 of the plot; a 2x2 house is a cottage with a yard at 0.56. Both are contained, and both read as
_larger_ than the bare box did, because there is somewhere for them to sit.

`tests/building-art.test.ts` holds the line for every building, by recording the drawing rather than
rendering it: `drawBuilding` talks to a handful of methods on a Phaser `Graphics`, so a stand-in that
writes down every coordinate measures the art exactly, headless. It found two things on the first
run — the yard's path, and every contact shadow in the game.

**A contact shadow handed the whole footprint does not stay on it.** It spreads its faintest ring to
1.24x what it is given and then slides down-right by the sun offset, so the full footprint comes out
at about one and a half times the plot — over the neighbour, and on a one-cell building, whose
texture is only as wide as its own diamond, straight off the edge where it was being sliced square.
Shadows are now sized to land inside the plot, which costs nothing: the light comes from the upper
left, so a shadow still reaches the plot's down-right edge and falls short of the up-left one.

The one exception is **eaves**, which are declared per building and which the texture is widened for.
A roof may oversail. Nothing else may.

### Every building is built, not tinted — Implemented

The generic routine used to draw one thing: a box under a pyramid, in a different brown. Fifteen of
those in a settlement is one silhouette repeated fifteen times, and the player cannot tell a
Woodcutter from a Tailor without tapping it. The house was drawn properly first — a cross-gabled
cottage timber-framed on a stone base — and only the house read as a building.

`structureArt.ts` is that construction generalised. Four things are varied, and each of them is
legible from across the map:

| Knob    | Values                              | What it changes                    |
| ------- | ----------------------------------- | ---------------------------------- |
| Roof    | `cross`, `gable`, `gable-left`      | The silhouette, which reads first  |
| Walls   | `boarded`, `framed`, `log`, `stone` | What the building is made of       |
| Cover   | `shingle`, `thatch`, `slate`        | Depth at the eaves, course density |
| Feature | thirteen, one a trade               | Which trade, without a label       |

**No single-apex roof, anywhere.** Four planes meeting at a point is the same lozenge whatever it
sits on. Every roof here hangs from a ridge _segment_:

- **`cross`** — two gables meeting over the middle, with the valley between them running down to the
  corner nearest the camera. The richest silhouette and the most expensive, so it goes to the
  buildings people look at: the house, the healer, the school.
- **`gable` / `gable-left`** — one ridge, with the gable end standing over the near-right or the
  near-left wall. Mirroring it is free and it makes two neighbours read as two buildings.

**Three traps, all of them fallen into first.**

- The gable walls stand _in front of_ the valley behind them and _behind_ the barge boards that cap
  them. There is no order outside the roof function that works, so the roof sequences them itself.
- The valley planes on a cross gable are easy to forget, which leaves a hole through the middle of
  the roof.
- Rafters laid along a gable's rakes as plain strips have square ends, and where two meet at the
  apex their outer corners carry past it — against the sky that is a dark splinter hanging over the
  roof behind. Each rafter is cut as a wedge _inside_ its own triangle instead, mitred at the apex.

**Pitch.** A single gable carries its whole rise on one plane, so a pitch that suits a cross gable
swallows the building. Gables are drawn at roughly the wall's own height; the cross gable runs half
again as tall.

**An open work bay.** A mono-pitch lean-to on two posts, hanging off the near-left wall and reaching
out across the building's own plot. It is the cheapest thing that says _a trade is carried on here_
rather than _people live here_, because it breaks the silhouette. Two rules learned by breaking
them: it covers **one bay** — run the full length of the wall and it buries the door, the steps and
both windows and the building stops existing — and it hangs off an **eaves** wall only, never off a
gable end.

**Stone gables get an opening, not a frame.** Masonry has no rafters showing, and a blank triangle
two storeys tall is the flattest shape in the settlement.

The pieces that earn their place at forty pixels tall, and nothing else does:

- **a stone base**, drawn as _joints_ rather than as tiles. Beds run the whole course and perpends
  are cut by them, so nothing can leave the face by construction — the first version drew each stone
  as a pale quad from `t` to `t + 0.2`, which runs off the corner and read as loose tiles stuck on
  the wall.
- **the wall's own construction** — posts and boarding, or braced half-timbering, or log courses
  with the ends crossing at the corner, or coursed masonry with quoins.
- **beam ends** at the eaves, squared-off where the rafters carry past. Not at the head of a gable:
  that is the end of the ridge, and nothing projects there.
- **four-pane windows** and a plank door with straps, with stone steps at the threshold.
- **one identifying feature** on the ring of plot around the building.

### What the trade leaves on its ground — Implemented

Mass and colour get a building most of the way to recognisable and then stop. The feature is the part
that says _which trade_, and it is drawn on the ground rather than on the walls so it survives the
building being small: split logs and a chopping block with the axe still in it, a forge mouth with
fire in it, a hide stretched in its frame, cloth on a line, a nursery row of saplings, a timbered
mine mouth, sacks on staddle stones, a bell in its frame.

Features are placed in **plot coordinates** — `u` and `v` running -1 at the back corner to 1 at the
front one — not in pixels, because `(0.84, 0.1)` means "out beside the near-right wall" on a 2x2 plot
and on a 3x3 one and a pixel offset would only be right on one of them.

### What a poor building looks like

A House is eight logs and four stone. It should not look joined and turned, and it should not look
like a shed either — so the detail it gets is the detail people put on a house they raised in a hurry:

- **beaten earth, not lawn.** Green ground against green terrain reads as nothing at all; the first
  pass was a tended green and the plot vanished into the meadow. The grass is the tufts left in the
  corners, and the ground is what has been walked on.
- **a path from the gate to the door**, which says a house is lived in more cheaply than any amount
  of detail on the walls does.
- **the shade every attachment throws on the wall behind it**, which is what stops a porch reading as
  a plank glued to a flat surface.

A fence round the plot was tried and taken out again. It has to be split **by depth** rather than by
edge — the near half of a plot's rim is not the same set of rails as the near half of its edges — and
drawn whole it puts rails across the front of the building. More to the point it was one accessory
too many: the report was that the house itself looked vague, and the answer to that is never another
thing beside it.

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

| File                  | Draws                                                      |
| --------------------- | ---------------------------------------------------------- |
| `groundArt.ts`        | Terrain tiles: facets, tufts, rock outcrops, ripples, snow |
| `treeArt.ts`          | Conifers and broadleaves, through the year                 |
| `buildingArt.ts`      | Plots, fields, yards, and how each building is massed      |
| `structureArt.ts`     | Walls, roofs, plinths, chimneys, doors, work bays          |
| `buildingFeatures.ts` | What each trade leaves standing on its own plot            |
| `isoProps.ts`         | Crates, barrels, sacks, log stacks                         |
| `tileTextures.ts`     | Atlas assembly, plus villagers, piles, yards, sites, roads |

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

---

## Portraits — Implemented

Not world art: these are the interface's faces, on the cards under a building's
panel. Recorded here anyway, because the decisions they settle are the ones the
villager sprites will have to answer too.

| Face  | Chosen when          | Reads as                      |
| ----- | -------------------- | ----------------------------- |
| Child | under 18             | A big head on small shoulders |
| Woman | 18–59, `sex === 'f'` | Long hair framing the face    |
| Man   | 18–59, `sex === 'm'` | Broad, square shoulders       |
| Elder | 60 and over          | A stoop, head low and forward |

**Age decides before sex.** A settlement whose panels are full of children and
elders looks like one, and that is the thing worth noticing about a population
that has stopped working.

Drawn as **silhouettes, cropped by a disc**, at a 24×24 box filled to its bottom
edge so the shoulders run off the frame the way a portrait's do. No features: at
thirty-two pixels a face is two dots and a smudge, so the difference has to be
carried by mass and posture. That constraint will apply again on the map, where a
villager is smaller still.

**Each villager has a colour for life**, taken from their id out of a muted earthy
set — dyed wool, not highlighter pens. It is the disc behind the silhouette here;
on the map it should become the clothing.

---

## Four villagers, and a colour each — Implemented

A settlement of thirty was thirty of the same hooded figure. Age and sex exist in
the simulation and matter to it — who may work, who may bear children, who has
earned the walk about the village — and could not be seen at all.

| Figure | Drawn for            | What carries it                          |
| ------ | -------------------- | ---------------------------------------- |
| Child  | under 18             | Two thirds the height, head too big      |
| Woman  | 18–59, `sex === 'f'` | A skirt to the ankle, and a kerchief     |
| Man    | 18–59, `sex === 'm'` | Legs apart, hood, widest at the shoulder |
| Elder  | 60 and over          | Shorter, leaning forward, a staff        |

**Age decides before sex**, so a fourteen-year-old holding a post is still drawn
as a child — a settlement whose workshops are staffed by children should look
like one.

**The difference is outline, never detail.** A villager is 48 pixels tall beside
a 96-pixel tree, and the player is usually zoomed further out than that. A
different collar, a longer hood, a lighter shade: all invisible three tiles away.
A skirt, a staff and a head half again too big are not. The old constraints still
hold — humanoid at small size, never a cone (a pointed hood reads as a sapling),
and a lit and a shaded plane on everything.

**Each villager has a colour and keeps it for life**, taken from their id out of
six muted dyes. It is worn as the tunic, with the outer garment the same colour
darkened, so somebody reads as one person dressed rather than two halves painted.
The same colour is the disc behind their portrait in the panels — see
`shared/appearance.ts`, which both the Phaser renderer and the HTML panels read
and neither owns.

Twenty-four frames — four figures × six colours — drawn once at load into a
single atlas, so the whole settlement is still one draw batch. Not a tint at draw
time: the season tint already owns `setTint`, and a second one on top would wash
every villager the same shade of whatever they were standing in.

## Roads, bridges and ditches — Implemented

Anything that runs from cell to cell is drawn from **what joins it**: a centre, and an arm towards
each of the four grid neighbours carrying the same thing. Four neighbours give sixteen shapes, which
cover every end, straight, corner, T-junction and crossing without anybody drawing them one at a
time.

A road used to be a single flat tile whatever stood beside it, so a corner was two overlapping
lozenges and a crossroads was four — a scatter of identical patches rather than a line the settlement
had beaten into the ground.

| Kind   | Reads as                                                | Joins                           |
| ------ | ------------------------------------------------------- | ------------------------------- |
| Road   | Trodden earth: a damp margin, a bed, a worn crown       | Other roads                     |
| Bridge | Timber deck with cross-planks, over dark water          | Roads, and the bank either side |
| Ditch  | Two banks of thrown-up earth with water down the middle | The river, and other ditches    |

Three rules hold the set together:

- **bands are measured in cells, not pixels.** An arm is half a cell long on the ground and its
  corners are projected on the way out. A band of constant screen thickness is not a band of constant
  width on an isometric grid, and its corners come out the wrong shape.
- **a bridge also meets the bank.** Its abutment is not a road — the ground beside a river is usually
  just ground — and a deck that stopped at the waterline read as a raft moored in midstream.
- **a ditch is drawn over earth, not over water.** The cell is painted as the mud it was cut into and
  the channel is a narrow band down the middle, which is what makes an _acequia_ read as something the
  settlement made rather than as a stray piece of river.

All forty-eight frames live in one atlas (`connector-atlas`, kind across and mask down), for the same
reason the terrain does: the depth-sorted display list interleaves them, and a texture change between
two adjacent objects breaks the GPU batch.
