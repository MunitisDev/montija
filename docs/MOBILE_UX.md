# Mobile UX

Target devices, in priority order:

1. **tablet landscape** — the primary device;
2. **mobile landscape**;
3. desktop browser — for development.

The design goal is blunt: **no mouse, no keyboard, no hover, no right click.** A keyboard shortcut
may exist as a developer convenience, never as the only way to do something.

Status labels: **Implemented**, **Prototype**, **Planned**.

---

## Orientation

Landscape. A settlement builder needs horizontal room.

Portrait is not blocked — the canvas still fills the viewport and the game still runs — but a hint
appears asking the player to rotate. **Implemented**, CSS-only, via an `orientation: portrait` media
query.

---

## Gestures — Implemented

| Gesture         | Action           |
| --------------- | ---------------- |
| One-finger drag | Pan the camera   |
| Pinch           | Zoom             |
| Two-finger drag | Pan (also works) |
| Tap             | Select           |

Deliberate details:

- **Pan follows the finger.** The world moves with the touch, not against it.
- **Zoom is anchored.** The world point under the pinch centre stays under it. Unanchored zoom feels
  like the map is sliding away.
- **Pinch and pan compose.** Two fingers moving together pans while their separation zooms — people
  do both at once without thinking about it.
- **Adding a second finger converts a pan into a pinch** without ending the gesture.
- **Lifting one finger of a pinch resumes panning** from the remaining finger, with no positional
  jump.
- **Inertia after a flick**, decaying exponentially and clamped to world bounds.
- **Touching the screen stops inertia immediately** — the standard expectation for a scrollable
  surface.

### Tap versus drag — Implemented

A tap registers only when both hold:

- movement stayed under **12 px** (`TAP_MOVE_TOLERANCE_PX`);
- the press lasted under **400 ms** (`TAP_MAX_DURATION_MS`).

Fingers are imprecise and a slow careful drag must never select something by accident. Gesture
velocity is exponentially smoothed so one jittery sample cannot throw a flick.

---

## Browser gesture suppression — Implemented

The browser's own gestures actively fight a game canvas. All are disabled:

| Behaviour                  | Suppressed by                                         |
| -------------------------- | ----------------------------------------------------- |
| Page pinch-zoom            | `user-scalable=no` in the viewport meta               |
| Double-tap zoom            | `touch-action: none`                                  |
| Scroll / overscroll bounce | `overscroll-behavior: none`, `overflow: hidden`       |
| Text selection callout     | `-webkit-touch-callout: none`                         |
| Tap highlight flash        | `-webkit-tap-highlight-color: transparent`            |
| Wheel page scroll          | Non-passive `wheel` listener calling `preventDefault` |
| Context menu on canvas     | `contextmenu` handler calling `preventDefault`        |

Touch listeners are registered `{ passive: false }`, which is required for `preventDefault()` to
take effect on touch events.

---

## Touch targets — Implemented

- Minimum **48 × 48 px** (`--touch-target`), above the 44px accessibility floor.
- Reduced to 44px only on very short screens (`max-height: 460px`), where vertical room is scarce.
- Minimum 6px between adjacent controls.

Building placement must never require precision tapping. The planned flow — tap a building, move a
ghost, tap confirm — is designed so the finger is never the fine-positioning instrument.

---

## Safe areas — Implemented

Landscape phones put notches, camera cutouts and home indicators on the **left and right** edges,
exactly where a landscape HUD wants to live.

```html
<meta name="viewport" content="... viewport-fit=cover" />
```

`viewport-fit=cover` lets the canvas paint edge to edge, and the HUD is inset with all four
`env(safe-area-inset-*)` values, exposed as CSS variables:

```css
--safe-top    --safe-right    --safe-bottom    --safe-left
```

The world fills the whole screen including under a notch. Only interactive chrome is inset.

---

## Layout — Prototype

The world is the interface. Chrome stays at the edges.

```text
┌────────────────────────────────────────────────┐
│ [food logs firewood stone ▾] [👥 1x 📖 ⚙] [season temp] │  top
│                                                │
│                                                │
│                 the settlement                 │  the actual game
│                                                │
│                                                │
│ [ build bar ]                                  │  bottom: actions
└────────────────────────────────────────────────┘
```

- The HUD layer is `pointer-events: none`; only real controls opt back in. Dragging across an empty
  HUD region still pans the world.
- The top bar carries the readouts and the four ways in: the stores, the people, the ledger and
  settings. Clock included — one button cycling pause, 1x, 2x, 4x.
- **Implemented.** The top bar is two named rows in the markup — the stores and the people, then the
  four tools and the calendar. Landscape and desktop dissolve them back into one line with
  `display: contents`, so the width they have is the width they use. Held upright, saying where the
  break goes is what keeps the layout the same layout: the wrap used to fall wherever the widths of
  the day landed, and the season name being eight letters longer in Spanish than in English was
  enough to stand the calendar on a third row of its own. Under 380px the day within the season goes
  — "Spring · Y1" is the half a player steers by, and the ledger keeps the rest.
- **Implemented.** Advice and the transient notices hang off the bottom of the top bar — the third
  line on a phone held upright, the second everywhere else — rather than floating across the middle
  of the settlement, which is the one thing the player is looking at. The notices sit under the
  advice so one arriving does not shove a standing warning down the screen.
- The build bar has the whole **bottom** to itself: five category buttons, with the buildings of
  whichever one is open in a grid above them.
- Readouts go **top**, where they are glanceable and out of the way.
- No permanent large desktop-style windows. Panels are contextual and dismissible.

Responsive behaviour is driven by `max-height` rather than `max-width` — in landscape, **vertical**
room is what runs out. Below 460px tall the HUD tightens: smaller labels, tighter gaps, 44px targets.

Verified so far at 1280×800 (tablet landscape) and 844×390 (landscape phone). Real-device testing is
Phase 10.

---

## Text

- Nothing below **0.65 rem**.
- Numbers use `font-variant-numeric: tabular-nums`, so changing values do not jitter their layout.
- Labels are uppercase and letter-spaced for glanceability at small sizes.
- Sufficient contrast against a busy world: panels sit on a translucent dark backing with a blur,
  not directly on terrain.

---

## Performance as a UX concern — Planned

On mobile, framerate _is_ user experience.

- The world renders in WebGL. No DOM node ever represents a villager, tree or resource pile.
- The HUD writes to the DOM only when a value actually changes — layout thrash next to a WebGL
  canvas is expensive.
- Simulation runs on a fixed tick, independent of render rate, so a slow device runs the same
  economy as a fast one — just with fewer frames.

Benchmarks arrive in Phase 11. No villager-count target is claimed before it is measured.

---

## Still to do — Phase 10

- Real-device testing on physical tablets and phones.
- Building placement flow (ghost, confirm, cancel) — depends on Phase 6.
- Contextual selection panels — depends on Phase 3.
- Haptic feedback on confirm/cancel, where supported.
- Verifying behaviour with an on-screen keyboard raised, and during orientation changes mid-gesture.

## Fitting a short screen — Implemented

Landscape phones are wide and **short**, and height is the resource the HUD
spends. Measured across five viewports before any of this was done, the HUD
covered 68% of the screen on a 568×320 phone — the settlement had a strip in
the middle and the player could not see what they were building.

Three things caused it, and all three are structural rather than cosmetic:

- **Rows wrapped.** Every wrapped row costs its full height. Both bars are now
  `nowrap`; anything that will not fit scrolls sideways instead. (The build bar has since stopped
  needing this — see **The build menu** below — but the rule still holds for the rows that do.)
- **Flex children would not shrink.** The build bar had `overflow-x: auto`
  already and still overran its neighbours, because a flex item will not shrink
  below its content without `min-width: 0`. Gatherer Hut and Woodcutter were
  simply off the end of the screen with no way to reach them.
- **The placement bar grew over the save controls**, putting a confirm button
  exactly where the player expected Save.

While a building is being positioned on a small screen, the build menu and the
save controls give up their space to the placement bar — nobody saves mid-aim,
and cancelling brings both straight back. Without that the label had room for
one letter: "H." for a House, which says nothing about what it costs.

The result, same five viewports:

| Viewport | HUD before | HUD after |
| -------- | ---------- | --------- |
| 568×320  | 68%        | 28%       |
| 667×375  | 39%        | 24%       |
| 844×390  | 36%        | 23%       |
| 1024×768 | 20%        | 20%       |
| 1280×800 | 19%        | 19%       |

Every control on a touch device is at least 44px on both axes. That floor is
applied under `pointer: coarse` rather than by screen size, because a small
window on a desktop is not a thumb.

Below 380px of height the resource captions are dropped and only the numbers
remain. Each keeps its name as a `title`, so the information is still there for
a long press and for a screen reader.

## Portrait — Implemented

Held upright, the game used to print "rotate your device for the best view" across the middle of the
world. That is not support; it is an apology, and the player had already chosen how to hold their
phone.

Behind the message the layout was genuinely broken: the bottom bar tried to fit the build menu, the
save controls and the speed controls on one line, and on a 411px-wide phone the save and speed
controls took the whole width and pushed the build menu off the screen. A player in portrait could
not build anything at all.

Portrait is the opposite problem from landscape and gets the opposite answer. Height is plentiful and
width is scarce, so rows **stack** rather than compete.

Since then most of the competition has been removed rather than arranged. Saving moved behind the
cog, the four speed buttons became one in the top bar, and the resource strip carries four numbers
instead of nine — the rest are a tap below it. The bottom bar is the build menu and nothing else.

| Viewport | HUD share |
| -------- | --------- |
| 360×640  | 45%       |
| 411×915  | 32%       |
| 768×1024 | 21%       |

Every build button is reachable and nothing scrolls horizontally at any of them.

### Icons in the resource strip

Five words plus five numbers do not fit across a phone held upright, so the strip wrapped to a second
line — and on portrait a wrapped row is a row of world given up to say things the player learns once.

Icons now carry the names, and the words appear alongside them only above 900px, where there is room.
The strip is one line at every size: 266px wide on a phone against 528px with the words.

The labels are **hidden, not deleted** — moved out of the layout so screen readers still read them,
and each figure carries its name as a `title` for a hover or a long press. An icon nobody can name is
worse than a word that does not fit.

They are drawn inline rather than loaded: crisp at any pixel density, no request, and they take their
colour from the stylesheet. The colours are the muted earthy ones the rest of the game is painted in
— enough to tell timber from firewood at a glance, not a set of highlighter pens.

## Fullscreen — Implemented

**A page cannot put itself full screen on load.** The Fullscreen API requires a user gesture in every
browser, by design, so "open the URL and it is already full screen" is not something any web game can
do. There are two honest answers and the project ships both.

**A button**, in the settings sheet under Display, hidden where the API is unavailable — notably an
iPhone, where Safari supports fullscreen for video and not for elements. Offering a button that does
nothing is worse than offering none.

It fullscreens the whole `#game` element rather than the canvas. Phaser offers to fullscreen the
canvas itself, and taking that offer would leave the HUD behind in the page: the player would gain a
bigger world and lose every button around it.

The label follows the browser's `fullscreenchange` event rather than the click, because the player
can leave with Escape or a system gesture, and a button still offering to enter would be lying.

**Installing to the home screen**, which is the real answer on a phone. The web manifest declares
`display: fullscreen`, so launched from the home screen the game opens with no browser chrome at all
and no gesture needed — the browser granted it when the game was installed. On Android: the browser
menu, then "Install app" or "Add to home screen".

Orientation is deliberately left unlocked. The game now supports both, and the player has already
decided how to hold their phone.

---

## Full-screen overlays — Implemented

The start screen, the **How to play** sheet, the **people panel** and the **settings** sheet are the
only things in the game that take the whole screen. All sit outside `#hud` and set
`pointer-events: auto`, because that layer is
transparent to pointers so world gestures reach the canvas — an overlay inheriting that would let a
drag pan the settlement behind it.

They are full-screen rather than floating windows for the reason the rest of this document keeps
running into: in landscape, vertical room is what runs out. A dialog small enough to feel like a
window is too small to read, and one large enough to read has stopped being a window. Neither is
somewhere the player lingers, so taking the screen while they are open costs nothing.

Two details that are easy to get wrong here:

- **`touch-action: pan-y` on the sheet's scrolling body.** The document suppresses touch scrolling
  everywhere so gestures belong to the camera. Without granting it back explicitly, the guide cannot
  be read past its first screen on a phone — the one place in the game where scrolling is correct.
- **The HUD stands down for the start screen.** Left up, the title was framed by a resource strip and
  a build bar the player could see and not use, which reads as a game that started and then stopped.
  It uses the same opacity fade as the loading state rather than a second mechanism.

Below `34rem` wide the guide's two-column term/detail grid becomes a single stack; above it, terms
sit in a 15rem column. Under `460px` tall the start screen drops its tagline and shortens its
buttons, the same threshold the HUD uses.

Verified at 1024×768 (tablet landscape) and 844×390 (landscape phone), in both languages.

## The stores drawer — Implemented

The strip used to grow a readout every time the settlement met a new good, and there are nine. On a
phone held upright that was two lines of world given up to numbers, and the list only grows.

The strip is a **button** now. It carries the four a settlement lives or dies by — food, logs,
firewood, stone — and a tap opens a drawer under the bar with every good the settlement has met,
each with what is stored, what is still lying in the field, and the **net per day** at the current
staffing. That last figure is the answer to "have we got enough coats", which a raw total cannot
give.

Unlike every sheet in the game, **the drawer does not pause and does not take the screen**. Glancing
at the stores is not stopping to read: the settlement carries on behind it, and a tap anywhere else
puts it away. Closing is handled by a `pointerdown` listener on the document rather than an
invisible backdrop, because a backdrop over the settlement would swallow the pan gesture the player
is most likely to make next.

The icons are defined once as SVG `<symbol>`s and referenced from both the strip and the drawer.
Nine glyphs written out twice is two places to change a hammer and one of them to forget.

## The clock — Implemented

One button in the top bar, cycling **pause → 1x → 2x → 4x → pause**. Four buttons for four speeds
took a corner of the bottom bar to say what two characters say.

The cost is real and worth writing down: from 1x it is now three taps back to pause, where before it
was one. Pause sits _after_ 4x in the cycle rather than before 1x, so the speed a player most often
wants to stop — the fast one they left running — is one tap from stopped. A stopped clock colours
itself, because it is easy to leave the game paused and wonder why nothing is happening.

## The ledger — Implemented

Four tabs: **People**, **Buildings**, **Production**, **Consumption**. It pauses like the other
sheets, because unlike the drawer it is somewhere a player stops to think.

Deliberately not the people panel. That one lists individuals under the roof they sleep under; this
one counts. "Will we get through winter" is a question for this sheet.

The split that matters is between the two kinds of figure on it:

- **Counts** — people, buildings, beds — are the settlement restated, and must be exactly right.
- **Production and consumption are estimates, and say so.** The production figure is what the
  staffed workshops would make in a day if nobody ever walked anywhere or waited for an input.
  Real output is lower. It is still worth showing, because the _ordering_ is honest and the
  comparison against demand is exact — demand comes out of `SurvivalSystem`'s own constants rather
  than a second set copied into the UI, so a balance change cannot leave the sheet lying.

`tests/ledger.test.ts` holds it to that: the counts against the simulation, demand against the
survival constants, production against the seasonal curve, nothing claimed for an unstaffed
workshop, and no countdown printed over an empty shelf.

Verified at 1180×820, 830×412 and 412×830, in both languages.

## The build menu — Implemented

**Seventeen buttons in a horizontal scroller is not a menu.** Finding a House — the single
most-built thing in the game — meant swiping sideways past sixteen other things, and the strip only
gets longer as the game grows. Scrolling was the right answer when there were five buildings; it
stopped being one somewhere around ten.

Two levels now. The bar carries **five categories** — Shelter, Food, Materials, Workshops,
Settlement — and tapping one opens a grid of that category's buildings above it. Every group holds
two to four buildings, which is one row on a tablet and two on a phone. Nothing scrolls, at any
size, and nothing will as the list grows: a sixth category is cheaper than a longer strip.

Grouped by **purpose** rather than by cost or unlock order, because "which building makes food" is
the question a player actually has. The category is a field on the building definition, so adding a
building is still a row in a data file — `tests/build-menu.test.ts` holds the menu to offering every
building exactly once, under the heading its own data names.

**The cards carry the price.** "Can I build this yet" is asked before every placement, and the only
way to answer it used to be to start placing and read the bar. A material the settlement has _none_
of is marked in red — not "cannot afford", because materials are hauled to a site as they arrive
and a site can quite reasonably be started short. Having none is different: it usually means an
economy the settlement has not built yet, which is why a School reads as out of reach until there is
a quarry.

Three behaviours worth recording:

- **The panel sits above the bar, not over the world.** The player is choosing a spot on the ground
  while they read it.
- **Starting a placement closes it, and cancelling does not reopen it.** The player has said no to
  that building; reopening the menu under their thumb is a second decision they did not make.
- **In portrait the bar wraps to two rows** rather than truncating "Settlement" to "Settle…".
  Portrait has height to spare and no width to spare, which is the trade every other row there
  makes.

Verified at 1180×820, 830×412 and 412×830, in both languages.

## Drawing a road — Implemented

**Paving was one cell per tap.** A track from the stores to the quarry is fifteen cells, so it was
fifteen taps and fifteen menus — data entry rather than an interaction, and a player who gives up on
it loses the one bonus in the game that costs nothing but labour.

The gesture now: tap a cell, press **Lay road**, tap where the road should end. The run appears as a
line of green cells, the bar reports its length — _Lay road — 17 cells_ — and either a second tap on
that same end cell or the **Confirm** button lays the lot. A player who wanted only the cell they
started on taps it again and gets exactly that, because the run begins one cell long.

Four decisions worth recording:

- **Two taps, not one.** The far end has to be visible before it is bought, and the thing being
  bought is up to twenty cells of somebody's day. Confirm and Cancel are there for anyone who would
  rather press a button than tap a cell twice.
- **The near end never moves.** Re-aiming moves the far end only; a run that re-anchored on every tap
  would make each tap undo the last.
- **A run is orthogonally continuous.** A diagonal line takes the corner cell between each step,
  because the pathfinder refuses to cut a corner — two cells joined at a corner are not a road. A
  diagonal run is therefore longer than the distance suggests, and the bar's count says so before the
  player commits.
- **It bends round what is in the way.** Houses, rock, the river: the run is routed over ground a road
  can take, by the way with fewest bends, up to twelve cells outside the two ends. Where no way round
  exists the straight line is shown instead, so the obstacle is visible on the map rather than reported
  as a refusal.
- **A bad cell costs that cell, not the line.** Water, rock, a building or a standing tree shows red
  in the preview and is left out of the order; the bar says how many. Refusing the whole run over one
  tree would mean re-drawing it by hand.

While a run is being aimed the tile panel's own land buttons stand down — the panel still says which
cell the run starts from, which is useful, but its buttons would start a second thing on top of the
first. On short and narrow screens the road bar takes the build bar's row, exactly as the placement
bar does.

Verified at 1180×820 with a seventeen-cell diagonal run and a run drawn into the river.

## Settings — Implemented

**If it is not about the settlement, it is not on the screen.** Resources, the calendar, the build
bar, the speed controls and the contextual panels are the game. The rules, saving, loading, full
screen and language are housekeeping a player touches once a session, and they had accumulated into
a row of buttons in the top bar plus a save/load pair in the corner of the bottom one. On a phone
held upright that was enough to push the top strip onto a third line and take a band off both edges
of the world.

They live behind one cog now, in a sheet built like the other two. What survived on the main screen:
the resource strip, the people icon, the cog, the calendar, the build bar, the speed buttons.

Three decisions worth recording:

- **Opening the cog pauses**, through the same `openPaused` helper the rules and the people panel
  use, and puts the clock back exactly as it was on close. A player already paused stays paused.
- **How to play opens _from_ settings and returns to it**, with the close button relabelled "Back".
  Landing back in the settlement after reading the rules loses the player their place.
- **No audio control.** There is no audio. A volume slider that adjusts nothing is worse than no
  slider, so the group will appear with the sound.

The language chip stays on the start screen as well: a player who cannot read the interface must be
able to change it before founding anything.

Verified at 1180×820, 830×412 and 412×830, in both languages, checking that the rules round-trip,
the language cycles, save and load report their status, and the clock resumes on close.
