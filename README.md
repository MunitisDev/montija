# Montija

[![CI](https://github.com/MunitisDev/montija/actions/workflows/ci.yml/badge.svg)](https://github.com/MunitisDev/montija/actions/workflows/ci.yml)

A mobile-first 2D medieval survival settlement builder that runs in the browser.

**▶ Play the current build: https://munitisdev.github.io/montija/** — works on desktop, tablet and
phone, no install required. Deployed automatically from `main` on every green build.

Ten people leave their village after something comes out of the dark one night. Nobody saw clearly
what it was, and nobody stayed to find out. Keep them alive through the winters.
Inspired by deep settlement simulation games, but entirely original — no assets, code, text, UI or
balance taken from any existing commercial game.

**Status: the loop is playable end to end.** Fell trees and quarry stone, haul them in, place
buildings and watch villagers carry the materials and construct them, produce food and firewood,
survive the winter, and grow a village across the generations — couples form, children are born and
grow up, people retire and die of old age. Saves survive a browser refresh.

**What is not done: balance, and the endgame.** Winter can kill an unprepared settlement, and the
reason it kills a well-played one is now known and pinned in tests — see
[`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md). The planned endgame is walls and a watch, to hold off
the thing the settlers walked away from; none of that is built. See
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what is built and what is not.

On a phone or tablet, install it to the home screen to play without browser chrome — the manifest
asks for fullscreen, so it launches like an app. In a tab, use the fullscreen button under the cog in
the top bar: a page is not allowed to enter fullscreen on its own without a gesture.

## Requirements

- Node.js 20.19+ or 22.12+ (developed on 22.22)
- A browser with WebGL

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
```

## Commands

| Command              | What it does                                     |
| -------------------- | ------------------------------------------------ |
| `npm run dev`        | Dev server with hot reload                       |
| `npm run build`      | Typecheck, then a production build into `dist/`  |
| `npm run preview`    | Serve the production build locally               |
| `npm test`           | Run the simulation test suite (Vitest, headless) |
| `npm run test:watch` | Tests in watch mode                              |
| `npm run bench`      | Simulation benchmarks at 25 / 50 / 100 villagers |
| `npm run typecheck`  | TypeScript strict typecheck, no emit             |
| `npm run lint`       | ESLint                                           |
| `npm run format`     | Rewrite files with Prettier                      |
| `npm run verify`     | Everything above, in CI order                    |

## Controls

The game opens on a start screen with **How to play** on it, which explains all of this in the game
itself, in English or Spanish. The same page is reachable while playing from the **cog** in the top
bar. Its building and resource lists are generated from the game's own data tables, so they cannot
drift out of step with what the game actually does.

Landscape orientation is the target. Nothing requires a keyboard or a mouse.

| Action | Desktop             | Touch           |
| ------ | ------------------- | --------------- |
| Pan    | Drag with the mouse | One-finger drag |
| Zoom   | Mouse wheel         | Pinch           |
| Select | Click               | Tap             |

Tap a tree and press **Fell**, or a rock and press **Mine**, to order the work; **Cancel** calls it
off. Felled logs and quarried stone lie where they fall until a villager hauls them in.

To build: pick a category from the bottom bar — Shelter, Food, Materials, Workshops, Settlement —
then a building from the grid that opens above it. Each card shows what it costs, with anything the
settlement has none of marked in red. Move the camera until the ghost sits where you want it and
press **Place**; villagers carry the materials from storage and construct it.

Tap the **resource strip** to drop down every good the settlement has, with what is stored, what is
still lying in the field, and the net over a season.

The top bar carries five more ways in. The **people** button lists everyone grouped by household —
ages, families, how each of them is doing, and a picker to post somebody to a particular workshop or
keep them on hauling. The **work** button answers the other half of that question, by workplace
rather than by household: every workshop at once, who is at it, and a pair of buttons to ask for one
more or one fewer. The **ledger** counts the settlement in five tabs, including how far it has got
and the settlement's own history. The **cog** holds the rules, saving, loading, full screen and
language. All of them pause the game while they are open.

The remaining button is the clock: one tap cycles pause, 1x, 2x and 4x.

**The chronicle.** The ledger's last tab is the only page about the past: who was born here, who is
buried here, what took them, the coldest night, the nights somebody slept without a roof. It is
recorded as it happens, because by year thirty the settlement cannot be asked what it used to be.
When the last villager goes, the same record becomes the closing page: the totals, the count by
cause, and the roll of everyone who ever lived there with their age and what took them.

## Architecture in one paragraph

The simulation is pure TypeScript and knows nothing about Phaser, the DOM or the canvas. Phaser
renders what the simulation says is true, and input turns gestures into intents that flow back into
it. That boundary is enforced by lint rules, not just convention, which is what makes the simulation
testable headlessly and deterministic from a seed.

```text
Input  ->  Game (commands)  ->  Simulation  ->  state  ->  Renderer / HUD
```

Full detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Documentation

| Document                                       | Contents                                                    |
| ---------------------------------------------- | ----------------------------------------------------------- |
| [`CLAUDE.md`](CLAUDE.md)                       | The project brief: constraints, rules and phase plan        |
| [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)   | The survival loop, the economy, and the measured difficulty |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layers, data flow, determinism, what exists today           |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)           | Phase-by-phase status                                       |
| [`docs/ART_BIBLE.md`](docs/ART_BIBLE.md)       | Grid, sprite and anchor conventions; art direction          |
| [`docs/MOBILE_UX.md`](docs/MOBILE_UX.md)       | Touch targets, gestures, safe areas, responsiveness         |
| [`docs/SAVE_FORMAT.md`](docs/SAVE_FORMAT.md)   | What a save contains, and how versioning works              |

## Licence

Not yet chosen. All code and art in this repository is original work for this project.
