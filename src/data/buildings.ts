/**
 * Building definitions.
 *
 * Data-driven, so the build menu, the placement rules, the construction costs
 * and the production behaviour all read from here. Adding a building should
 * mean adding a row, never writing a new menu button or a new placement branch.
 */

import { FOOD_IDS, type ResourceId } from './resources';
import { WET_TERRAIN, type TerrainType } from './terrain';

export type BuildingId =
  | 'house'
  | 'storage-yard'
  | 'food-storage'
  | 'gatherer-hut'
  | 'feller'
  | 'woodcutter'
  | 'quarry'
  | 'mine'
  | 'blacksmith'
  | 'crop-field'
  | 'orchard'
  | 'fishing-hut'
  | 'hunter'
  | 'tailor'
  | 'trading-post'
  | 'herbalist'
  | 'healer'
  | 'school'
  | 'well'
  | 'cemetery'
  | 'temple'
  | 'bridge';

/**
 * What a building is *for*, which is how the build menu is organised.
 *
 * Seventeen buildings in one horizontal strip meant scrolling sideways to find
 * a house, which is the single most-built thing in the game. Five groups of
 * three or four fit on any screen the project targets without scrolling at all,
 * and they keep fitting as the list grows — which a flat strip does not.
 *
 * Grouped by purpose rather than by cost or by unlock order, because "which
 * building makes food" is the question a player actually has.
 */
export type BuildingCategory =
  | 'shelter'
  | 'food'
  /**
   * The wood trades, split out from `materials` when the Feller's Hut arrived.
   *
   * Five cards in a group is a scroller on a phone held upright, and the three
   * wood buildings belong together anyway: one fells, one splits, one plants.
   * Grouping them says the chain out loud, which is exactly what a player who
   * had a Woodcutter and no timber needed to be told.
   */
  | 'woodland'
  | 'materials'
  | 'workshops'
  | 'care'
  | 'settlement';

/** Menu order for the groups: what a settlement needs, roughly in that order. */
export const BUILDING_CATEGORIES: readonly BuildingCategory[] = [
  'shelter',
  'food',
  'woodland',
  'materials',
  'workshops',
  'care',
  'settlement',
];

export interface ResourceAmount {
  readonly resource: ResourceId;
  readonly amount: number;
}

export interface BuildingDefinition {
  readonly id: BuildingId;
  readonly name: string;
  /** One-line explanation, shown in the build menu. */
  readonly description: string;
  readonly footprint: { readonly width: number; readonly height: number };
  readonly constructionCost: readonly ResourceAmount[];
  /** Ticks of labour needed once every material is on site. */
  readonly buildTicks: number;
  readonly workerSlots: number;
  /** Which group of the build menu this appears under. */
  readonly category: BuildingCategory;
  /**
   * How the player puts it down. `menu` — the default — is the build menu and a
   * placement ghost.
   *
   * `cell` means it is a **transformation of a cell the player has already
   * tapped**, offered on the panel for that cell instead: a bridge is not
   * something you site by eye, it is something you do to one square of river.
   * The build menu's groups are also sized for a thumb, and a fifth card in one
   * of them turns the panel back into the scroller the grouping replaced.
   *
   * Everything else about such a building is ordinary: the same site, the same
   * hauled materials, the same builder job.
   */
  readonly placement?: 'menu' | 'cell';

  /** Set when the building stores resources. */
  readonly storage?: {
    readonly capacity: number;
    readonly accepts?: readonly ResourceId[];
    /** Multiplier on spoilage here; 1 is an open yard, lower keeps food better. */
    readonly preservation?: number;
  };
  /** How many villagers can live here. */
  readonly housing?: number;
  /** The recipe produced here, from `data/recipes.ts`. Phase 7. */
  readonly recipeId?: string;

  /**
   * Set for a building that fells its own timber.
   *
   * **The Woodcutter's answer to the one job the player was doing by hand.**
   * Splitting logs into firewood is useless without logs, and the only way to
   * get them was to mark trees one at a time — every winter, for ever. A
   * workshop that cuts what it needs is a workshop; one that waits to be fed by
   * hand is a chore.
   *
   * Its felling is *cropping*, not clearing: a sapling stands on the cell it cut
   * the same afternoon and grows back over three years. Only the player's own
   * marks clear ground for good. See `simulation/world/TreeGrowth.ts`.
   */
  readonly felling?: {
    /** How far its cutters range, in cells. */
    readonly radius: number;
    /** Unworked orders it keeps standing. The rate the settlement can cut. */
    readonly outstanding: number;
    /**
     * Logs in store above which it stops cutting.
     *
     * A workshop with a full yard has no business emptying the wood, and this
     * is what stops the settlement stripping the map on its own — the thing a
     * player would rightly hold against an automatic woodcutter.
     */
    readonly logTarget: number;
  };

  /**
   * Terrain this building must stand *on*, if any.
   *
   * The opposite of {@link adjacentTo}, and it exists for exactly one thing so
   * far: a bridge is built on the water rather than beside it. Everything else
   * needs buildable ground, and this is what lets a definition say it does not.
   */
  readonly on?: TerrainType;

  /**
   * Set when the finished building carries traffic instead of blocking it.
   *
   * A bridge is the only thing in the settlement that is walked *through*
   * rather than walked *to*, and it is the whole reason to build one: the river
   * splits the map, and until a crossing stands, half the wood and rock on it
   * may as well not exist.
   *
   * Implemented as a road laid over the water, which is not a trick — it is what
   * a bridge is. Pathfinding, the road art, the speed a villager walks and the
   * save all work on it already, and nothing in any of them has to learn a new
   * concept.
   */
  readonly crossing?: boolean;

  /**
   * Terrain this building must stand next to, if any.
   *
   * A quarry has to bite into a rock face; it cannot sit in a meadow. An orchard
   * has to be able to drink. Checked as *adjacency* rather than as the footprint
   * itself, because the footprint has to be buildable ground for anyone to work
   * on it — what the rule really says is that what the building needs must be
   * within reach.
   *
   * A list, because "water" means the river or a channel dug from it, and a
   * settlement that has gone to the trouble of digging one has earned the same
   * answer as one that happened to be founded on a bank.
   */
  readonly adjacentTo?: readonly TerrainType[];

  /**
   * A single improvement the player can order once the building stands.
   *
   * **One upgrade, not a tech tree.** The settlement's surplus stone and iron had
   * nowhere to go but more buildings, and a house that can be made warmer is the
   * most useful thing to spend it on — but a settlement game turns into a
   * spreadsheet the moment every building has three tiers and a menu, so there is
   * exactly one, it is ordered from the building's own panel, and it is built the
   * way everything else is: materials hauled by hand and labour spent on site.
   *
   * `firewoodFactor` is what the household burns afterwards, against 1 for the
   * house as built.
   */
  readonly upgrade?: {
    readonly cost: readonly ResourceAmount[];
    readonly buildTicks: number;
    readonly firewoodFactor: number;
  };

  /**
   * Set for a building that puts water within reach of the settlement.
   *
   * **Water is comfort every day and insurance on the bad one.** A house with
   * water near it is a household that is not carrying every bucket from the
   * river, which is worth something in spirit; and when a hearth sets a roof
   * alight, water within reach is the difference between a fire that is put out
   * and a building that is gone. The river and a dug channel answer the same
   * way — a settlement that went to the trouble of digging one has earned it.
   *
   * `radius` is in cells, measured from the building's own doorway.
   */
  readonly water?: { readonly radius: number };

  /**
   * What in this building could set it alight, if anything.
   *
   * **The risk is a consequence of what the building does, not a die roll on the
   * settlement.** A `hearth` burns only on the nights it is lit — freezing ones —
   * so a summer village cannot burn down; a `forge` is hot whenever somebody is
   * working it. Everything else in the settlement is timber and will happily
   * catch from a neighbour, but nothing else starts a fire on its own.
   */
  readonly fireRisk?: 'hearth' | 'forge';

  /**
   * Set for a building that keeps the settlement's spirits up.
   *
   * Not a recipe and not care: what these produce is **solace**, which is not
   * measured in units and is not delivered to anybody in particular. The
   * settlement either has somewhere to bury its dead and somewhere to sit with
   * them, or it does not.
   *
   * `share` is how much of the settlement's spirit this building can account
   * for on its own, in `0..1`. The two together reach 1; either alone is worth
   * building, which is the point of splitting it.
   */
  readonly solace?: {
    readonly share: number;
    /** Set when the building needs somebody in it to do anything at all. */
    readonly needsWorker?: boolean;
  };

  /**
   * Set for a building that nurses the sick.
   *
   * Not a recipe: what a healer produces is treatment, measured in people
   * rather than in units, and the production system has no way to say that.
   */
  readonly care?: {
    /** How many patients one worker can look after at once. */
    readonly patientsPerWorker: number;
  };
}

/**
 * The five buildings the brief calls for, and no more.
 *
 * Costs are placeholders — the brief is explicit that exact balance comes
 * later, and that these values belong in data rather than in code.
 */
export const BUILDINGS: Readonly<Record<BuildingId, BuildingDefinition>> = {
  house: {
    id: 'house',
    category: 'shelter',
    name: 'House',
    description:
      'A home for four grown-ups and their children. Firewood only warms people who have one.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 8 },
      { resource: 'stone', amount: 4 },
    ],
    buildTicks: 120,
    workerSlots: 0,
    housing: 4,
    // A lit hearth on a freezing night is the only thing in a house that could
    // start a fire, which is why a summer settlement cannot burn down.
    fireRisk: 'hearth',
    /*
     * **A stone hearth and a proper chimney**, which is where a settlement's
     * spare stone and iron finally have somewhere to go.
     *
     * A third off the firewood, for six stone and two iron — about the cost of a
     * winter's cutting for a household that then never pays it again. Iron is
     * what makes it a *later* decision rather than an obvious first one: it means
     * a mine and a blacksmith, so the settlement has to be standing before it can
     * start being comfortable.
     */
    upgrade: {
      cost: [
        { resource: 'stone', amount: 6 },
        { resource: 'iron', amount: 2 },
      ],
      buildTicks: 70,
      firewoodFactor: 0.65,
    },
  },
  'storage-yard': {
    id: 'storage-yard',
    category: 'shelter',
    name: 'Storage Yard',
    description: 'Holds logs, stone and firewood.',
    footprint: { width: 3, height: 3 },
    constructionCost: [{ resource: 'logs', amount: 6 }],
    buildTicks: 80,
    workerSlots: 0,
    storage: {
      capacity: 1000,
      accepts: ['logs', 'stone', 'firewood', 'iron', 'tools', 'hides', 'clothing', 'herbs'],
    },
  },
  'food-storage': {
    id: 'food-storage',
    category: 'shelter',
    name: 'Food Storage',
    description: 'Keeps food from spoiling. Food left in an open yard rots.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 6 },
      { resource: 'stone', amount: 2 },
    ],
    buildTicks: 90,
    workerSlots: 0,
    // A tenth of the spoilage of an open yard. This is the whole reason the
    // building exists: food will sit anywhere, but only keeps through a winter
    // in here.
    storage: { capacity: 800, accepts: FOOD_IDS, preservation: 0.1 },
  },
  'gatherer-hut': {
    id: 'gatherer-hut',
    category: 'food',
    name: 'Gatherer Hut',
    description: 'Workers forage the surrounding woods for food.',
    footprint: { width: 2, height: 2 },
    // Timber only. The settlers arrive with what they could carry and no stone at
    // all, so if the one building that feeds them needed masonry they would
    // starve while looking for a quarry — measured, they died on day 22 of three
    // seeds out of four. Wood gets you fed; stone is for everything that lasts.
    constructionCost: [{ resource: 'logs', amount: 12 }],
    buildTicks: 110,
    workerSlots: 2,
    recipeId: 'forage-food',
  },
  quarry: {
    id: 'quarry',
    category: 'materials',
    name: 'Quarry',
    description: 'Cuts stone out of a rock face for as long as it stands.',
    // Deliberately the largest thing in the game. A quarry is a permanent
    // decision about a piece of land: there is no demolition, so wherever it
    // goes it stays, and the price of never running out of stone is a hole in
    // the settlement you have to build around forever.
    footprint: { width: 3, height: 3 },
    constructionCost: [
      { resource: 'logs', amount: 24 },
      { resource: 'stone', amount: 12 },
    ],
    buildTicks: 220,
    workerSlots: 3,
    recipeId: 'cut-stone',
    adjacentTo: ['stone'],
  },
  mine: {
    id: 'mine',
    category: 'materials',
    name: 'Mine',
    description: 'Digs iron out of the hillside. Slow, and permanent.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 20 },
      { resource: 'stone', amount: 16 },
    ],
    buildTicks: 240,
    workerSlots: 2,
    recipeId: 'dig-iron',
    adjacentTo: ['stone'],
  },
  'crop-field': {
    id: 'crop-field',
    category: 'food',
    name: 'Field',
    description: 'Sown in spring, worth having in autumn. Nothing at all in winter.',
    footprint: { width: 3, height: 3 },
    // Cheap and quick: a field is broken ground and a fence, not a building.
    // It has to be affordable in the first spring, because a settlement that
    // cannot farm until year two lives its first year on foraging alone.
    constructionCost: [{ resource: 'logs', amount: 6 }],
    buildTicks: 70,
    workerSlots: 2,
    recipeId: 'grow-crops',
  },
  orchard: {
    id: 'orchard',
    category: 'food',
    name: 'Orchard',
    description:
      'Fruit trees, on a bank or a ditch. Years to establish, and then the best harvest there is — build the larder near it, or the pickers out-run the haulers.',
    footprint: { width: 3, height: 3 },
    constructionCost: [
      { resource: 'logs', amount: 10 },
      { resource: 'stone', amount: 2 },
    ],
    // Trees drink. An orchard has to sit on the river or on a channel dug from
    // it, which makes it the one building whose place on the map is a real
    // decision rather than "anywhere there is room".
    adjacentTo: WET_TERRAIN,
    // Far the longest build in the game, and that *is* the mechanic: an orchard
    // is a bet on a later autumn. Planting one in a hungry spring is a mistake;
    // planting one in a comfortable summer is how a settlement stops being
    // hungry for good.
    buildTicks: 400,
    workerSlots: 2,
    recipeId: 'tend-orchard',
  },
  'fishing-hut': {
    id: 'fishing-hut',
    category: 'food',
    name: 'Fishing Hut',
    description:
      'A jetty and a drying rack on the river. Brings something in every month of the year, and keeps worse than anything else.',
    footprint: { width: 2, height: 2 },
    // Cheap, like the Gatherer Hut, and for the same reason: it is a hut on a
    // bank rather than a building, and the settlement that needs it most is the
    // one that has just found out its first spring is longer than its stores.
    constructionCost: [{ resource: 'logs', amount: 10 }],
    buildTicks: 100,
    workerSlots: 2,
    recipeId: 'catch-fish',
    // On the water, or on a channel dug to it. The second building whose place
    // on the map is a real decision.
    adjacentTo: WET_TERRAIN,
  },
  herbalist: {
    id: 'herbalist',
    category: 'care',
    name: "Herbalist's Hut",
    description: 'Gathers herbs in the growing seasons. They keep, and winter needs them.',
    footprint: { width: 2, height: 2 },
    constructionCost: [{ resource: 'logs', amount: 8 }],
    buildTicks: 80,
    workerSlots: 1,
    recipeId: 'gather-herbs',
  },
  healer: {
    id: 'healer',
    category: 'care',
    name: "Healer's House",
    description: 'Nurses the sick, using herbs. Its only output is that people stop dying.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 14 },
      { resource: 'stone', amount: 8 },
    ],
    buildTicks: 150,
    // Staffed like a workshop, but it has no recipe: what it produces is
    // treatment, which is measured in people rather than in units and so is
    // not something the production system can express.
    workerSlots: 2,
    care: { patientsPerWorker: 4 },
  },
  'trading-post': {
    id: 'trading-post',
    category: 'settlement',
    name: 'Trading Post',
    description: 'A merchant calls in fair weather and swaps your surplus for what you lack.',
    footprint: { width: 3, height: 3 },
    constructionCost: [
      { resource: 'logs', amount: 18 },
      { resource: 'stone', amount: 8 },
    ],
    buildTicks: 160,
    // Nobody is employed here. The merchant does the trading; the settlement's
    // part is having hauled a surplus into its yards, which the ordinary
    // logistics system already does.
    workerSlots: 0,
  },
  hunter: {
    id: 'hunter',
    category: 'food',
    name: "Hunter's Cabin",
    description: 'Brings in meat and hides, and is the only work that pays in winter.',
    footprint: { width: 2, height: 2 },
    constructionCost: [{ resource: 'logs', amount: 10 }],
    buildTicks: 90,
    workerSlots: 2,
    recipeId: 'hunt-game',
  },
  tailor: {
    id: 'tailor',
    category: 'workshops',
    name: 'Tailor',
    description: 'Sews hides into clothing, which keeps people warm when the fire cannot.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 10 },
      { resource: 'stone', amount: 4 },
    ],
    buildTicks: 120,
    workerSlots: 2,
    recipeId: 'sew-clothing',
  },
  blacksmith: {
    id: 'blacksmith',
    category: 'workshops',
    name: 'Blacksmith',
    description: 'Forges iron into tools. Tools make every other job quicker.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 14 },
      { resource: 'stone', amount: 10 },
    ],
    buildTicks: 150,
    workerSlots: 2,
    recipeId: 'forge-tools',
    // The one fire in the settlement that burns whatever the season is.
    fireRisk: 'forge',
  },
  /*
   * **The building that makes logs**, and the one the settlement was missing.
   *
   * Felling used to be a side effect of the Woodcutter, which is a workshop
   * whose actual trade is splitting. That is one building doing two unrelated
   * jobs, and the player could not see either of them: a settlement with a
   * Woodcutter and no timber had no way to tell whether it wanted more cutters,
   * more splitters or more trees, and one with logs already in store quietly
   * stopped felling altogether — because a splitter with a full woodpile has no
   * reason to cut, which is exactly the wrong rule for the settlement's only
   * source of timber.
   *
   * So the chain is one building a step now: **the Feller cuts and the Woodcutter
   * splits**, each a post a player can staff or leave empty, and the shortage
   * tells them which. Nobody plants: the wood does that itself, in the open, over
   * three years — see `simulation/world/TreeGrowth.ts`.
   *
   * The cheapest building in the game after the hut, because it is the first
   * thing anybody needs and its cost is paid in the very thing it makes.
   */
  feller: {
    id: 'feller',
    category: 'woodland',
    name: "Feller's Hut",
    description: 'Fells the wood around it. Logs on the ground, for hauling in.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 6 },
      { resource: 'stone', amount: 2 },
    ],
    buildTicks: 90,
    // **One axe.** Two was measured and it is the wrong price: three gatherer
    // huts, a woodcutter and a two-hand feller is every one of ten villagers
    // employed and nobody left to carry anything, and a settlement that cannot
    // haul dies with full fields. One cutter fells about thirty trees a year at
    // four logs each, which is several times what a settlement of ten burns and
    // builds with — the shortage this building answers was never a shortage of
    // hands at the tree.
    workerSlots: 1,
    // A wider reach than the old woodcutter's and a deeper backlog, because
    // this is now the settlement's whole supply rather than one workshop
    // topping itself up. The standing-order cap is what stops a hut in dense
    // woodland burying the map in crosses nobody can work through.
    //
    // `logTarget` is a **store** figure, not a rate: at two hundred logs in the
    // yards the settlement has a year of building and splitting in hand and the
    // wood is better left standing. Well above the old forty, which stopped the
    // cutting the moment the woodpile looked healthy.
    felling: { radius: 14, outstanding: 2, logTarget: 200 },
  },
  woodcutter: {
    id: 'woodcutter',
    category: 'woodland',
    name: 'Woodcutter',
    description: 'Splits logs into firewood.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'logs', amount: 8 },
      { resource: 'stone', amount: 4 },
    ],
    buildTicks: 100,
    workerSlots: 2,
    // Splitting, and nothing else. What it used to do besides — crop its own
    // timber — is the Feller's Hut now: see the note there.
    recipeId: 'split-firewood',
  },

  /*
   * The most expensive thing in the game, and **currently ornamental**.
   *
   * It was built for the rescue arc: a school was what let somebody write for
   * help, and that arc has been removed. It is kept rather than deleted for two
   * reasons — settlements already have them standing, and the trade a school
   * plausibly teaches is exactly what the coming specialisation system needs.
   *
   * Until then it does nothing mechanical, and its description says so. A
   * building whose panel promises an effect it has not got is worse than no
   * building at all.
   *
   * Its cost is still the gate it always was: stone means a quarry, iron means a
   * mine, and both mean the logistics to keep them fed.
   */
  school: {
    id: 'school',
    category: 'settlement',
    name: 'School',
    description: 'Somewhere for the children to learn. No effect yet.',
    footprint: { width: 3, height: 3 },
    constructionCost: [
      { resource: 'logs', amount: 30 },
      { resource: 'stone', amount: 20 },
      { resource: 'iron', amount: 12 },
    ],
    buildTicks: 260,
    workerSlots: 0,
  },

  /*
   * Ground for the dead, and a roof to sit with them under.
   *
   * Both exist because the settlement had nowhere to put its grief: people
   * died and simply stopped being in the list. They pay in **spirit** — see
   * `VillagerNeeds.spirit` — which is a bonus and never a penalty, so a
   * settlement that builds neither plays exactly the game it always did.
   *
   * The cemetery is cheap, unstaffed and mostly stone: it is a wall round a
   * piece of ground. The temple costs real timber and a person's time, and is
   * worth more than twice as much, because sitting with the dead takes
   * somebody who is not doing anything else.
   */
  /*
   * **Water, which is comfort every day and insurance on the bad one.**
   *
   * The river already decided where a settlement could put an orchard. This is
   * what lets it decide the rest: a house with water within ten cells is a
   * household not carrying every bucket from the bank, and when a hearth sets a
   * roof alight, water within reach is the difference between a fire that is put
   * out and a building that is gone.
   *
   * Cheap, unstaffed and mostly stone — it is a hole in the ground with a wall
   * round it — because it has to be affordable in the first year, which is the
   * year a settlement is most likely to be built somewhere awkward.
   */
  well: {
    id: 'well',
    category: 'care',
    name: 'Well',
    description: 'Water where the river is not. Comfort every day, and the answer to a fire.',
    footprint: { width: 2, height: 2 },
    constructionCost: [
      { resource: 'stone', amount: 8 },
      { resource: 'logs', amount: 2 },
    ],
    buildTicks: 80,
    workerSlots: 0,
    water: { radius: 10 },
  },
  cemetery: {
    id: 'cemetery',
    category: 'settlement',
    name: 'Cemetery',
    description: 'Ground for the dead. A settlement with nowhere to bury them grieves harder.',
    footprint: { width: 3, height: 3 },
    constructionCost: [
      { resource: 'stone', amount: 10 },
      { resource: 'logs', amount: 4 },
    ],
    buildTicks: 90,
    workerSlots: 0,
    solace: { share: 0.35 },
  },
  bridge: {
    id: 'bridge',
    category: 'settlement',
    name: 'Bridge',
    description: 'Timber over the water. One cell of river, and the far bank stops being a view.',
    footprint: { width: 1, height: 1 },
    // Cheap on purpose *in materials*: the river is a decision about where to
    // cross, not a late-game monument, and a settlement that has to save up for a
    // bridge simply ignores half the map for a year — which is not a decision at
    // all.
    //
    // The labour is another matter: a house's worth of it, per cell of river.
    // Crossing a river is the biggest thing a small settlement does to its own
    // map, and it should cost a fortnight of somebody's time rather than an
    // afternoon.
    constructionCost: [{ resource: 'logs', amount: 5 }],
    buildTicks: 120,
    workerSlots: 0,
    placement: 'cell',
    on: 'water',
    crossing: true,
  },
  temple: {
    id: 'temple',
    category: 'settlement',
    name: 'Temple',
    description: 'Somewhere to sit with the dead. Its keeper lifts the whole settlement.',
    footprint: { width: 3, height: 3 },
    constructionCost: [
      { resource: 'logs', amount: 22 },
      { resource: 'stone', amount: 16 },
    ],
    buildTicks: 200,
    workerSlots: 1,
    solace: { share: 0.65, needsWorker: true },
  },
};

/** Menu order. Storage first, because nothing else works without somewhere to put things. */
export const BUILDING_IDS: readonly BuildingId[] = [
  'bridge',
  'house',
  'storage-yard',
  'food-storage',
  'gatherer-hut',
  'feller',
  'woodcutter',
  'quarry',
  'mine',
  'blacksmith',
  'crop-field',
  'orchard',
  'fishing-hut',
  'hunter',
  'tailor',
  'trading-post',
  'herbalist',
  'healer',
  'well',
  'cemetery',
  'temple',
  // Last, because it is the last thing a settlement builds: the way home.
  'school',
];

export function buildingDefinition(id: BuildingId): BuildingDefinition {
  return BUILDINGS[id];
}
