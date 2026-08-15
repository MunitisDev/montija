# Montija

[![CI](https://github.com/MunitisDev/montija/actions/workflows/ci.yml/badge.svg)](https://github.com/MunitisDev/montija/actions/workflows/ci.yml)

A mobile-first 2D medieval survival settlement builder that runs in the browser.

**▶ Play the current build: https://munitisdev.github.io/montija/** — works on desktop, tablet and
phone, no install required. Deployed automatically from `main` on every green build.

Build a small settlement in an unforgiving wilderness, and help its people survive the winter.
Inspired by deep settlement simulation games, but entirely original — no assets, code, text, UI or
balance taken from any existing commercial game.

**Status: Phases 0-10 complete — the MVP loop is playable.** Fell trees and quarry stone, haul them
in, place buildings and watch villagers carry the materials and construct them, produce food and
firewood, and try to survive the winter. Saves survive a browser refresh.

**What is not done: balance.** Winter can kill an unprepared settlement and a stocked one survives,
both proven in tests — but nobody has played it yet, so whether it is _enjoyable_ is unknown. See
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what is built and what is not.

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

Landscape orientation is the target. Nothing requires a keyboard or a mouse.

| Action | Desktop             | Touch           |
| ------ | ------------------- | --------------- |
| Pan    | Drag with the mouse | One-finger drag |
| Zoom   | Mouse wheel         | Pinch           |
| Select | Click               | Tap             |

Tap a tree and press **Fell**, or a rock and press **Mine**, to order the work; **Cancel** calls it
off. Felled logs and quarried stone lie where they fall until a villager hauls them in.

To build: pick a building from the bottom bar, move the camera until the ghost sits where you want
it, and press **Place**. Villagers carry the materials from storage and construct it.

Simulation speed (pause / 1x / 2x / 4x) is set from the buttons at the bottom right.

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
