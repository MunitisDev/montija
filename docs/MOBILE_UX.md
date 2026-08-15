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
│ [pop food logs firewood stone]   [season temp] │  top: readouts
│                                                │
│                                                │
│                 the settlement                 │  the actual game
│                                                │
│                                                │
│ [ build bar ]              [ ‖  1x  2x  4x ]  │  bottom: actions
└────────────────────────────────────────────────┘
```

- The HUD layer is `pointer-events: none`; only real controls opt back in. Dragging across an empty
  HUD region still pans the world.
- Speed controls sit **bottom right**, near the thumb in a two-handed landscape grip.
- The build bar goes **bottom left** for the other thumb.
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
