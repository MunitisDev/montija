# PROJECT

Build an original mobile-first 2D survival settlement city-builder.

The gameplay philosophy is inspired by deep settlement simulation games such as Banished, but this
project must be entirely original.

Do not copy:

- copyrighted assets;
- UI;
- names;
- maps;
- text;
- building designs;
- exact game balance;
- artwork;
- music;
- code;

from any existing commercial game.

The core fantasy: build a small medieval settlement in an unforgiving wilderness and help its
inhabitants survive, grow and prosper over many years.

The primary target is:

1. tablet landscape;
2. mobile landscape;
3. desktop browser for development.

The game must be playable directly in a modern web browser.

## TECHNOLOGY

Use:

- TypeScript
- Phaser 4
- Vite
- HTML5
- CSS
- WebGL through Phaser
- Vitest for simulation tests
- ESLint
- Prettier
- Git
- GitHub

Do NOT use:

- Godot
- Unity
- Unreal
- React unless a real UI complexity later justifies it
- server-side rendering

Keep dependencies minimal. Do not introduce a frontend framework merely for menus. Vanilla HTML/CSS
is preferred for the initial UI.

## CRITICAL ARCHITECTURE RULE

The game simulation must NOT depend on Phaser. Phaser is the presentation/input layer. The
simulation should be pure TypeScript wherever practical.

Conceptually:

```text
Player Input
     ↓
Commands
     ↓
Simulation
     ↓
Game State
     ↓
Presentation / Phaser
```

Do not implement important economic or AI logic inside Phaser sprites. A villager sprite is a visual
representation of a simulation villager. The sprite is NOT the authoritative villager. This
separation is mandatory.

### WHY

The architecture should allow:

- simulation unit testing;
- deterministic simulation;
- headless tests;
- save/load;
- renderer replacement;
- performance optimization;
- replay/debug tools;
- future mobile packaging.

## PROJECT STRUCTURE

Start approximately with:

```text
src/

  app/
    bootstrap.ts
    config.ts

  game/
    Game.ts

  simulation/
    Simulation.ts
    SimulationClock.ts

    world/
    villagers/
    buildings/
    resources/
    jobs/
    logistics/
    production/
    seasons/

  renderer/
    phaser/
      scenes/
      entities/
      terrain/
      camera/
      effects/

  input/
    TouchController.ts
    PointerController.ts

  ui/
    hud/
    panels/
    build-menu/

  data/
    buildings/
    resources/
    recipes/

  shared/
    types/
    math/
    utils/

  debug/

tests/

public/
  assets/
    terrain/
    buildings/
    villagers/
    vegetation/
    ui/
```

Adjust when necessary, but preserve separation between:

- simulation;
- rendering;
- UI;
- input;
- data.

## VISUAL STYLE

Use a 2D isometric / 3-quarter top-down presentation.

The mood should be:

- grounded;
- atmospheric;
- medieval;
- natural;
- slightly melancholic;
- serious;
- readable.

Avoid:

- chibi characters;
- cartoon proportions;
- excessively saturated colors;
- mobile-game toy aesthetics;
- thick black outlines;
- exaggerated animations.

Prefer:

- muted greens;
- earth tones;
- aged timber;
- dark stone;
- mud;
- autumn ochres;
- cold winter colors;
- soft shadows;
- smoke;
- mist;
- rain;
- snowfall.

The visual target can be described as: a detailed illustrated medieval settlement viewed like a
living tabletop diorama.

Characters should remain small compared with buildings. Buildings should visually dominate the
settlement.

## ART APPROACH

Initially use placeholder art. Do not spend time creating production artwork before the gameplay
loop works.

Placeholder assets must preserve approximately correct:

- dimensions;
- anchors;
- building footprints;
- tile dimensions;
- character scale.

Create `docs/ART_BIBLE.md` and document:

- camera angle;
- grid dimensions;
- sprite dimensions;
- building anchor conventions;
- character anchor conventions;
- sorting rules;
- lighting direction;
- seasonal variants;
- animation conventions;
- asset naming.

## WORLD RENDERING

The game world should be rendered inside a Phaser canvas. HTML should NOT be used to represent world
objects.

Use Phaser for:

- terrain;
- trees;
- buildings;
- villagers;
- resource piles;
- roads;
- particles;
- weather;
- selection indicators.

Use HTML/CSS primarily for:

- HUD;
- menus;
- dialogs;
- building panels;
- settings;
- debug information where appropriate.

## CAMERA

Primary orientation: LANDSCAPE.

Camera controls must work with:

**Desktop**

- mouse drag → pan;
- mouse wheel → zoom;
- click → select.

**Touch**

- one-finger drag → pan;
- pinch → zoom;
- tap → select.

Do not require:

- hover;
- right click;
- keyboard shortcuts.

Keyboard shortcuts may exist only as optional developer conveniences.

Camera should support:

- inertia;
- zoom limits;
- world bounds;
- smooth zoom.

## RESPONSIVE DESIGN

The game must adapt to:

- 16:9 desktop;
- 16:10 tablets;
- 4:3 tablets;
- common landscape phones.

Do not assume a fixed resolution. The canvas fills available viewport space. UI must consider device
safe areas. CSS should use safe-area variables where appropriate. Touch controls require generous
hit targets.

## WORLD GRID

Use a logical simulation grid. The visible terrain should hide the artificial nature of the grid as
much as possible.

The logical grid controls:

- building placement;
- navigation;
- terrain occupancy;
- resource locations.

Rendering should not be authoritative.

Example conceptual world:

```text
World
 ├── TerrainGrid
 ├── OccupancyGrid
 ├── NavigationGrid
 ├── Buildings
 ├── ResourceNodes
 └── Villagers
```

## ISOMETRIC PROJECTION

Keep world coordinates independent from screen coordinates.

Create reusable conversion functions:

```text
worldToScreen()
screenToWorld()
gridToWorld()
worldToGrid()
```

Do not scatter isometric projection math throughout the codebase. All coordinate transforms belong
in one clearly documented subsystem.

## RENDER SORTING

Isometric rendering order must be deterministic. Objects further toward the back of the map render
behind objects closer to the camera.

Do not manually assign arbitrary z-index values throughout gameplay code. Implement a reusable
sorting rule.

## SIMULATION CLOCK

Rendering FPS and simulation speed must be independent.

Support:

- pause;
- 1x;
- 2x;
- 4x.

Simulation systems update through simulation ticks. Do not perform game economy calculations every
render frame.

Example:

```text
requestAnimationFrame
       ↓
Phaser rendering
       ↓
SimulationClock
       ↓
fixed simulation ticks
```

## DETERMINISM

Where reasonably possible, simulation should be deterministic. Use seeded random generation.

Do NOT directly use `Math.random()` inside simulation systems. Create a seeded random service. Store
world seed in save data. This allows reproducing bugs.

## WORLD GENERATION

Initial map generation should be simple.

Generate:

- grass;
- forest;
- water;
- stone areas.

Resources:

- trees;
- stone.

The world must be deterministic from a seed. Do not build sophisticated terrain generation
initially. Gameplay is more important.

## RESOURCE MODEL

Resources must exist physically in the world when appropriate.

Do NOT make settlement inventory merely `wood += 1` when a tree is cut.

Desired flow:

```text
Tree
 ↓
cut by villager
 ↓
Log resource pile appears
 ↓
Hauling job generated
 ↓
Villager claims job
 ↓
Villager walks to logs
 ↓
Villager picks them up
 ↓
Villager walks to storage
 ↓
Storage receives logs
 ↓
HUD cached total changes
```

This is a core gameplay principle. Global totals displayed by the HUD may be cached summaries. They
must not be the authoritative location of physical resources.

## INITIAL RESOURCES

Implement initially:

- Logs
- Firewood
- Stone
- Food

Later:

- Iron
- Tools
- Clothing

Definitions should be data-driven:

```ts
interface ResourceDefinition {
  id: string;
  name: string;
  category: string;
  maxStack: number;
}
```

Do not hard-code resource behavior across unrelated systems.

## VILLAGERS

Villagers are autonomous simulation entities.

Initial model:

```text
Villager
- id
- name
- age
- position
- homeId
- profession
- currentJobId
- inventory
- hunger
- warmth
- health
```

MVP needs only:

- hunger;
- warmth;
- health.

Do not implement dozens of needs.

## VILLAGER VISUAL REPRESENTATION

A villager may have:

- idle animation;
- walking animation;
- working animation;
- carrying animation.

Initially use very simple sprites/placeholders. Visual state should derive from simulation state.

```text
simulation says:
villager.position
villager.currentAction

renderer chooses:
sprite position
animation
carried-resource graphic
```

## JOB SYSTEM

Do not build villager logic as one giant conditional function. Create a job/task system.

Examples:

```text
ChopTreeJob
GatherStoneJob
HaulResourceJob
ConstructBuildingJob
ProduceResourceJob
```

Jobs include:

```text
id
type
priority
target
assignedVillager
state
```

A resource or job requiring exclusive access must support reservation. Two villagers must not
accidentally claim the same tree or item.

## JOB FLOW

```text
Villager idle
 ↓
JobSystem query
 ↓
find suitable job
 ↓
reserve
 ↓
travel
 ↓
perform
 ↓
complete
 ↓
find another job
```

This system will become one of the central parts of the game. Keep it easy to inspect and debug.

## PATHFINDING

Pathfinding must not run every rendered frame.

Recalculate only when:

- destination changes;
- path becomes invalid;
- current job changes.

Start with a simple grid-based algorithm such as A\*. Do not prematurely introduce complex
navigation technology. The implementation should eventually support many villagers.

## PERFORMANCE

Target initially: 50 active villagers comfortably.

Architect toward: 100–300 villagers eventually.

Do not promise the final maximum until benchmarks exist.

Avoid:

- DOM nodes for villagers;
- DOM nodes for trees;
- thousands of independent timers;
- AI running every render frame;
- excessive object allocations inside hot loops.

The actual world belongs in the WebGL canvas.

## HTML UI

Keep the UI outside Phaser when practical.

```html
<div id="game">
  <canvas></canvas>

  <div id="hud">...</div>

  <div id="build-menu">...</div>
</div>
```

Benefits:

- responsive layout;
- accessibility;
- CSS styling;
- easier mobile controls;
- easier menus;
- easier localization later.

Do not over-engineer UI.

## UI DESIGN

Primary HUD should eventually show:

- population;
- food;
- logs;
- firewood;
- stone;
- season;
- temperature;
- game speed.

Tablet UI should prioritize world visibility.

Prefer:

- bottom build toolbar;
- contextual side panel;
- collapsible information panels.

Avoid permanent large desktop windows.

## BUILDINGS

Initial buildings:

- **House** — provides housing and warmth.
- **Storage Yard** — stores logs, stone, firewood.
- **Food Storage** — stores food.
- **Gatherer Hut** — produces food.
- **Woodcutter** — consumes logs, produces firewood.

Do not add more buildings until this loop works.

## BUILDING DEFINITIONS

Buildings must be data-driven.

```ts
interface BuildingDefinition {
  id: string;
  name: string;
  footprint: {
    width: number;
    height: number;
  };
  constructionCost: ResourceAmount[];
  workerSlots: number;
}
```

Do not create custom build-menu code for every building.

## BUILDING PLACEMENT

```text
Open build menu
 ↓
choose building
 ↓
placement ghost
 ↓
check valid cells
 ↓
confirm
 ↓
construction site created
```

Mobile interactions:

- drag camera normally;
- tap building button;
- move placement ghost;
- tap confirm;
- cancel button.

The UX must not require precision tapping.

## CONSTRUCTION

Construction should require:

1. placement;
2. required materials;
3. hauling;
4. construction work;
5. completion.

Example:

```text
House requires:

Logs: 8
Stone: 4
```

Those values are placeholders and should live in data files. Villagers must physically deliver those
materials.

## PRODUCTION

Production should use recipes.

```ts
{
  id: "firewood",
  inputs: [
    { resource: "logs", amount: 1 }
  ],
  outputs: [
    { resource: "firewood", amount: 4 }
  ],
  workDuration: 5
}
```

Exact balance comes later.

## SEASONS

Implement:

- Spring;
- Summer;
- Autumn;
- Winter.

Season affects initially:

- environment visuals;
- ambient temperature;
- food production;
- firewood demand.

Do not build a meteorological simulator.

## SURVIVAL

Core survival loop:

```text
SPRING
build and gather

SUMMER
expand and produce

AUTUMN
prepare

WINTER
consume stored resources and survive
```

Poor planning must have consequences.

## SAVE SYSTEM

Use a versioned save format. Initially store saves in IndexedDB or another appropriate browser
persistence layer.

Avoid tying simulation saves to Phaser object serialization. Save authoritative simulation state.

```ts
interface SaveGame {
  version: number;
  worldSeed: number;
  simulationTime: number;
  world: ...
  villagers: ...
  buildings: ...
  resources: ...
}
```

## MOBILE FUTURE

This project begins as a web application. Architecture must remain compatible with eventually
wrapping the production build with Capacitor for Android and iOS.

Do NOT introduce Capacitor yet. Do not add native code in the MVP. First make the browser version
excellent.

## DEBUG MODE

Create a development-only debug overlay. Eventually include:

- FPS;
- simulation tick time;
- villager count;
- active jobs;
- unassigned jobs;
- resource piles;
- path requests.

Debug controls:

- spawn villager;
- add resource;
- switch season;
- advance time;
- complete construction.

Debug systems must not pollute production UI.

## TESTING

Simulation should be testable without Phaser. Use Vitest.

Important tests:

- seeded RNG;
- coordinate conversion;
- inventory transfer;
- job reservation;
- job assignment;
- hauling;
- construction requirements;
- production recipes;
- seasonal transitions;
- save/load.

A change to simulation code should not require launching the graphical game to verify basic
correctness.

## LINTING

Configure:

- TypeScript strict mode;
- ESLint;
- Prettier.

Prefer explicit types for simulation state. Avoid `any` unless unavoidable and documented.

## GITHUB

The GitHub repository is the source of truth.

Before making changes:

1. inspect existing files;
2. inspect git status;
3. inspect current branch;
4. inspect remote configuration;
5. inspect package configuration if present.

Do not initialize another nested Git repository. Do not delete unrelated files.

Use conventional commits:

```text
chore: initialize web game
feat: add simulation clock
feat: add isometric world renderer
feat: add villager simulation
feat: add job reservation system
feat: add resource hauling
feat: add construction sites
feat: add touch camera controls
test: add logistics simulation tests
```

Make coherent small commits. Push completed work to the configured GitHub remote when authentication
permits. Never force push without explicit approval.

## DOCUMENTATION

Maintain:

```text
README.md

docs/
  GAME_DESIGN.md
  ARCHITECTURE.md
  ART_BIBLE.md
  MOBILE_UX.md
  ROADMAP.md
  SAVE_FORMAT.md
```

Documentation should describe reality. Use labels where useful:

```text
Implemented
Prototype
Planned
```

Do not describe planned functionality as already working.

## MVP

The first major playable objective is: **SURVIVE THE FIRST WINTER**

Starting conditions:

- small wilderness map;
- approximately 10 villagers;
- basic resources;
- spring.

The player must be able to:

1. move camera;
2. zoom;
3. select objects;
4. designate trees for harvesting;
5. gather logs;
6. gather stone;
7. create storage;
8. place buildings;
9. deliver construction materials;
10. build houses;
11. produce food;
12. produce firewood;
13. store resources;
14. experience seasons;
15. consume food;
16. consume firewood;
17. pause;
18. change simulation speed;
19. save;
20. load;
21. survive or fail in winter.

This is the core vertical slice. Do not expand scope before it is enjoyable.

## DEVELOPMENT PHASES

### PHASE 0 — Repository inspection

Inspect repository, branch, git status, remotes, existing code, package configuration. Document
important findings.

### PHASE 1 — Browser foundation

Create Vite project, TypeScript strict configuration, Phaser, Vitest, ESLint, Prettier.

Requirements:

- Phaser canvas fills viewport;
- HTML HUD overlay exists;
- resize works;
- landscape layout works;
- basic desktop camera movement works;
- touch input architecture exists.

Definition of done: `npm install`, `npm run dev`, `npm run build`, `npm test` work successfully. The
browser shows a basic game world placeholder and HUD.

### PHASE 2 — Isometric world

Implement logical grid, world coordinates, isometric projection, terrain renderer, seeded simple
world generation, camera bounds, zoom, pointer-to-grid conversion.

Definition of done: the player can move around a deterministic isometric world.

### PHASE 3 — Villagers

Implement simulation villager model, renderer representation, movement, simple A\* navigation, idle
state, debug selection.

Definition of done: 10 villagers can navigate independently.

### PHASE 4 — Job system

Implement JobManager, job creation, job priority, reservation, assignment, completion.

Initial job: `MoveToJob`, then `ChopTreeJob`.

Definition of done: villagers autonomously find available work.

### PHASE 5 — Resource logistics

Implement trees, logs, stone, inventories, resource piles, storage, hauling.

Definition of done: a tree can be cut, logs appear physically, another villager can haul them to
storage. This is a critical milestone. Do not fake logistics.

### PHASE 6 — Construction

Implement building menu, ghost placement, valid/invalid footprint, construction site, resource
requirements, material delivery, builder job, completion.

Definition of done: the player places a house and villagers physically construct it.

### PHASE 7 — Economy

Implement Gatherer Hut, Woodcutter, profession slots, recipes, production jobs.

Definition of done: settlement produces food and firewood through actual worker activity.

### PHASE 8 — Seasons and survival

Implement year clock, seasons, temperature, food consumption, firewood consumption, health
consequences, death.

Definition of done: winter is capable of killing an unprepared settlement.

### PHASE 9 — Save/load

Implement versioned save schema, IndexedDB persistence, autosave, manual save/load.

Definition of done: a running settlement survives browser refresh.

### PHASE 10 — Mobile UX

Test and improve touch camera movement, pinch zoom, building placement, selection, menus, text size,
safe areas, landscape phone, tablet.

Definition of done: no mouse or keyboard is required to play.

### PHASE 11 — Performance

Create repeatable benchmark scenarios (25 / 50 / 100 villagers).

Record FPS, simulation tick time, pathfinding time, render object count. Profile before optimizing.
