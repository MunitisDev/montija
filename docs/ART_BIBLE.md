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

Current placeholder palette (`src/app/config.ts`):

| Name      | Hex       | Use               |
| --------- | --------- | ----------------- |
| Void      | `#12140f` | Background        |
| Grass     | `#4a5b3a` | Open ground       |
| Grass alt | `#536440` | Checker variation |
| Forest    | `#2f4029` | Wooded            |
| Water     | `#2c3f4a` | Water             |
| Stone     | `#5a5750` | Rock              |

These are already muted and earthy on purpose. Even the prototype should never read as a bright toy.
