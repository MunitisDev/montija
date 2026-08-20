/**
 * A heap for every good the settlement can leave on the ground.
 *
 * **Why nine and not two.** There used to be a log pile and a stone pile, and
 * everything else — food, firewood, iron, hides, tools, clothing, herbs — was
 * drawn as timber. A player sent a screenshot of a stalled settlement asking why
 * there was so much *material* lying about; three hundred and sixty of it was
 * food and a hundred and thirty was firewood, and all of it looked like a
 * scatter of logs. The piles are the visible half of this game's core rule —
 * what you see on the ground is genuinely there until somebody carries it away —
 * and a rule you cannot read is not doing its job.
 *
 * Each heap has to answer one question at forty pixels: *what is that*. So each
 * one is built from a shape nothing else in the settlement uses — round sawn
 * ends for logs, split wedges for firewood, a basket for food, ingots for iron,
 * folded soft edges for hides, flat bolts for cloth, tied stems for herbs, a
 * helve and a blade for tools. Colour separates them a second time, and neither
 * alone would be enough.
 *
 * Drawn into a `TILE_WIDTH × PILE_HEIGHT` texture with its base at the bottom,
 * because a pile sits on the ground and is anchored there. Renderer-only: these
 * run once at startup.
 */

import type Phaser from 'phaser';

import type { ResourceId } from '@/data/resources';
import { shade } from './shading';

/** Sprite box. Kept in step with `tileTextures`, which owns the numbers. */
export interface PileBox {
  readonly width: number;
  readonly height: number;
}

/**
 * The shadow every heap sits in, so none of them float.
 *
 * Kept clear of the bottom of the sprite: the old log pile put a 12px-tall
 * ellipse three pixels off the base and had its lower edge quietly clipped by
 * the texture. Flatter and higher costs nothing and fits — `tests/pile-art.ts`
 * fails the build if any heap runs off its sprite.
 */
function groundShadow(
  graphics: Phaser.GameObjects.Graphics,
  cx: number,
  base: number,
  width: number,
): void {
  graphics.fillStyle(0x000000, 0.24);
  graphics.fillEllipse(cx, base - 6, width, width * 0.3);
}

/** A filled polygon from absolute points. */
function polygonAt(
  graphics: Phaser.GameObjects.Graphics,
  points: readonly (readonly [number, number])[],
): void {
  graphics.beginPath();
  const [first, ...rest] = points;
  if (!first) {
    return;
  }
  graphics.moveTo(first[0], first[1]);
  for (const [x, y] of rest) {
    graphics.lineTo(x, y);
  }
  graphics.closePath();
  graphics.fillPath();
}

/**
 * An iso block: a top face, a lit left face and a shaded right one.
 *
 * The workhorse of half these heaps. Stone, iron, cloth and hides are all
 * stacks of something roughly rectangular, and what tells them apart is the
 * proportion, the colour and what is drawn on top.
 */
function block(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: number,
  lid = 3.5,
): void {
  const top = y - h;
  graphics.fillStyle(shade(colour, 1.3), 1);
  polygonAt(graphics, [
    [x, top],
    [x + w * 0.5, top - lid],
    [x + w, top],
    [x + w * 0.5, top + lid],
  ]);
  graphics.fillStyle(shade(colour, 1.02), 1);
  polygonAt(graphics, [
    [x, top],
    [x + w * 0.5, top + lid],
    [x + w * 0.5, y + lid],
    [x, y],
  ]);
  graphics.fillStyle(shade(colour, 0.74), 1);
  polygonAt(graphics, [
    [x + w, top],
    [x + w * 0.5, top + lid],
    [x + w * 0.5, y + lid],
    [x + w, y],
  ]);
}

/** A stack of cut logs, seen end-on, with sawn faces catching the light. */
function drawLogs(graphics: Phaser.GameObjects.Graphics, box: PileBox): void {
  const cx = box.width / 2;
  const base = box.height;
  groundShadow(graphics, cx, base, 34);

  const bark = 0x4a3b2a;
  const cut = 0x8a7150;
  const rows = [
    { y: base - 9, xs: [-12, -4, 4, 12] },
    { y: base - 17, xs: [-8, 0, 8] },
    { y: base - 25, xs: [-4, 4] },
  ];
  for (const row of rows) {
    for (const x of row.xs) {
      graphics.fillStyle(shade(bark, 1.08), 1);
      graphics.fillEllipse(cx + x, row.y, 9.5, 8.5);
      graphics.fillStyle(shade(bark, 0.78), 1);
      graphics.fillEllipse(cx + x, row.y + 1.2, 9.5, 6);
      graphics.fillStyle(cut, 1);
      graphics.fillEllipse(cx + x, row.y, 5, 4.5);
      graphics.fillStyle(shade(cut, 0.82), 1);
      graphics.fillEllipse(cx + x, row.y + 1, 5, 2.6);
      graphics.fillStyle(shade(cut, 1.16), 1);
      graphics.fillEllipse(cx + x, row.y - 0.4, 2, 1.8);
    }
  }
}

/**
 * Split billets, stacked and bound.
 *
 * **Wedges, not rounds.** Firewood beside logs is the pair most easily confused,
 * and the difference in the world is that one is a tree cut across and the other
 * is a tree cut along: so these are triangles with a long pale split face, laid
 * in a criss-cross, with a withy round the middle. Nothing else in the game is
 * a bundle.
 */
function drawFirewood(graphics: Phaser.GameObjects.Graphics, box: PileBox): void {
  const cx = box.width / 2;
  const base = box.height;
  groundShadow(graphics, cx, base, 32);

  const bark = 0x53412c;
  const split = 0xb69a6d;

  /** One billet, end-on: a wedge with a pale split face and bark on the back. */
  const billet = (x: number, y: number, w: number, h: number): void => {
    // Bark along the top, curved side out.
    graphics.fillStyle(shade(bark, 1.06), 1);
    polygonAt(graphics, [
      [cx + x, y],
      [cx + x + w, y],
      [cx + x + w - 1.5, y - 2.6],
      [cx + x + 1.5, y - 2.6],
    ]);
    // The split face, which is the whole cue: pale, flat, and the biggest area.
    graphics.fillStyle(split, 1);
    polygonAt(graphics, [
      [cx + x, y],
      [cx + x + w, y],
      [cx + x + w - 0.8, y + h],
      [cx + x + 0.8, y + h],
    ]);
    // A shake down the middle of the face. Split wood is never clean.
    graphics.fillStyle(shade(split, 0.74), 1);
    polygonAt(graphics, [
      [cx + x + w * 0.44, y + 0.6],
      [cx + x + w * 0.56, y + 0.6],
      [cx + x + w * 0.5, y + h - 0.6],
    ]);
    graphics.fillStyle(shade(split, 0.6), 1);
    polygonAt(graphics, [
      [cx + x, y + h],
      [cx + x + w, y + h],
      [cx + x + w - 0.8, y + h + 1.6],
      [cx + x + 0.8, y + h + 1.6],
    ]);
  };

  // Short and stacked in courses, the way a woodpile is actually built. Nothing
  // here is longer than it is deep, which is what keeps it from reading as
  // sawn boards.
  const courses = [
    { y: base - 9, xs: [-15, -8, -1, 6] },
    { y: base - 17, xs: [-12, -5, 2] },
    { y: base - 25, xs: [-8, -1] },
  ];
  for (const course of courses) {
    for (const x of course.xs) {
      billet(x, course.y, 7, 6.4);
    }
  }
}

/** A heap of quarried stone: blocks with a top, a lit face and a shaded one. */
function drawStone(graphics: Phaser.GameObjects.Graphics, box: PileBox): void {
  const cx = box.width / 2;
  const base = box.height;
  groundShadow(graphics, cx, base, 32);

  for (const b of [
    { x: -11, y: base - 7, w: 13, h: 9, c: 0x5a5750 },
    { x: 2, y: base - 7, w: 14, h: 10, c: 0x646159 },
    { x: -5, y: base - 16, w: 12, h: 9, c: 0x6d6a61 },
    { x: 5, y: base - 19, w: 10, h: 7, c: 0x5f5c55 },
  ]) {
    block(graphics, cx + b.x, b.y, b.w, b.h, b.c);
  }
}

/**
 * A basket, heaped over the rim.
 *
 * Food is the good a settlement watches most closely, so it gets the most
 * distinct silhouette in the set: a woven tub with produce piled out of the top.
 * Warm russet against the greens of the map, and nothing else here is round.
 */
/**
 * A basket of produce, in whatever the produce is.
 *
 * **One drawing, five larders.** The four bulk foods are all "a basket somebody
 * carried in from a field", and inventing four separate baskets would be four
 * times the code for a difference nobody could name. What tells them apart is
 * *colour* — the one thing the eye reads instantly at this size — and, for the
 * fish, a shape: a fish is the one food in the settlement that does not look
 * like a vegetable, and drawing it as a green roundel would be a lie the player
 * would notice.
 */
function drawFood(
  graphics: Phaser.GameObjects.Graphics,
  box: PileBox,
  produce: readonly [number, number, number, number] = [0x7d5535, 0x6d4234, 0x8a6540, 0x55632f],
  shape: 'heap' | 'fish' | 'windfall' | 'joint' | 'bunches' = 'heap',
): void {
  const cx = box.width / 2;
  const base = box.height;
  groundShadow(graphics, cx, base, 34);

  const wicker = 0x8a6b45;

  // A second, smaller basket behind, so it reads as a store rather than a prop.
  graphics.fillStyle(shade(wicker, 0.8), 1);
  graphics.fillEllipse(cx + 11, base - 12, 17, 15);
  graphics.fillStyle(shade(wicker, 0.62), 1);
  graphics.fillEllipse(cx + 11, base - 9, 17, 10);

  // The near basket: a tub with a rim.
  graphics.fillStyle(wicker, 1);
  polygonAt(graphics, [
    [cx - 14, base - 20],
    [cx + 8, base - 20],
    [cx + 5, base - 3],
    [cx - 11, base - 3],
  ]);
  graphics.fillStyle(shade(wicker, 0.72), 1);
  polygonAt(graphics, [
    [cx - 3, base - 20],
    [cx + 8, base - 20],
    [cx + 5, base - 3],
    [cx - 3, base - 3],
  ]);
  // Two weave courses, faint: texture, not structure.
  graphics.fillStyle(shade(wicker, 0.56), 1);
  for (const t of [0.35, 0.68]) {
    const y = base - 20 + 17 * t;
    graphics.fillRect(cx - 13 + t * 2, y, 21 - t * 3, 1.4);
  }
  // The rim, lit.
  graphics.fillStyle(shade(wicker, 1.3), 1);
  graphics.fillEllipse(cx - 3, base - 20, 23, 8);
  graphics.fillStyle(shade(wicker, 0.5), 1);
  graphics.fillEllipse(cx - 3, base - 19, 18, 5);

  // The produce, heaped over the rim.
  // Muted on purpose: bright fruit in a settlement of earth tones pulls the eye
  // off the buildings, and food is the good there is most of on the ground.
  if (shape === 'fish') {
    // Laid across the rim rather than heaped in it, nose to tail, because that
    // is what a morning's catch looks like and it is unmistakable at any zoom.
    for (const [dx, dy, len, tone] of [
      [-7, -22, 20, 0],
      [2, -25, 18, 1],
      [-2, -28, 16, 2],
    ] as const) {
      const x = cx + dx;
      const y = base + dy;
      graphics.fillStyle(produce[tone] ?? produce[0], 1);
      graphics.fillEllipse(x, y, len, 7);
      polygonAt(graphics, [
        [x + len / 2 - 1, y],
        [x + len / 2 + 5, y - 4],
        [x + len / 2 + 5, y + 4],
      ]);
      // The one glint this style allows: a wet back, lit from the upper left.
      graphics.fillStyle(shade(produce[tone] ?? produce[0], 1.35), 1);
      graphics.fillEllipse(x - 2, y - 1.6, len * 0.5, 2.4);
    }
    return;
  }

  graphics.fillStyle(produce[0], 1);
  graphics.fillEllipse(cx - 8, base - 23, 11, 9);
  graphics.fillStyle(produce[1], 1);
  graphics.fillEllipse(cx + 1, base - 25, 12, 10);
  graphics.fillStyle(produce[2], 1);
  graphics.fillEllipse(cx - 3, base - 27, 9, 8);
  graphics.fillStyle(produce[3], 1);
  graphics.fillEllipse(cx + 5, base - 22, 7, 6);

  // **And one thing beside the basket per food**, because colour alone is not a
  // silhouette: at gameplay zoom in winter light two baskets of different greens
  // are one object drawn twice, and `tests/pile-art.test.ts` fails the build for
  // exactly that. Each of these changes the outline as well as the palette.
  if (shape === 'windfall') {
    // Windfalls rolled out of the basket. Only fruit does this.
    graphics.fillStyle(produce[1], 1);
    graphics.fillEllipse(cx - 19, base - 6, 8, 7);
    graphics.fillStyle(produce[0], 1);
    graphics.fillEllipse(cx - 14, base - 4, 7, 6);
    graphics.fillStyle(shade(produce[2], 1.2), 1);
    graphics.fillEllipse(cx - 20, base - 8, 3, 2.6);
  } else if (shape === 'joint') {
    // A block with the joint on it: the only heap in the settlement with a
    // straight edge on top of it.
    const wood = 0x6b573a;
    polygonAt(graphics, [
      [cx - 24, base - 9],
      [cx - 10, base - 9],
      [cx - 10, base - 4],
      [cx - 24, base - 4],
    ]);
    graphics.fillStyle(shade(wood, 1.2), 1);
    polygonAt(graphics, [
      [cx - 24, base - 9],
      [cx - 10, base - 9],
      [cx - 12, base - 11],
      [cx - 22, base - 11],
    ]);
    graphics.fillStyle(produce[3], 1);
    graphics.fillEllipse(cx - 17, base - 13, 13, 6);
    graphics.fillStyle(shade(produce[2], 1.15), 1);
    graphics.fillEllipse(cx - 19, base - 14, 6, 3);
  } else if (shape === 'bunches') {
    // Tied bunches leaning against the basket, hung to dry — and deliberately
    // not the herb pile's bundles: two of them, short, and against the wicker.
    for (const [dx, height] of [
      [-20, 15],
      [-15, 12],
    ] as const) {
      graphics.fillStyle(produce[0], 1);
      polygonAt(graphics, [
        [cx + dx - 3, base - 3],
        [cx + dx + 3, base - 3],
        [cx + dx + 1.5, base - height],
        [cx + dx - 1.5, base - height],
      ]);
      graphics.fillStyle(shade(produce[2], 1.2), 1);
      graphics.fillRect(cx + dx - 3, base - height * 0.55, 6, 1.8);
    }
  }
}

/**
 * Iron, as cast ingots.
 *
 * Cold blue-grey and stacked flat, which is nothing like the rubble of the stone
 * heap: quarried stone is lumps of different sizes, and iron out of a bloomery
 * is the same shape every time. A pale sheen along one top edge is the only
 * metallic cue this style allows itself.
 */
function drawIron(graphics: Phaser.GameObjects.Graphics, box: PileBox): void {
  const cx = box.width / 2;
  const base = box.height;
  groundShadow(graphics, cx, base, 30);

  const metal = 0x4d5259;
  for (const b of [
    { x: -13, y: base - 6, w: 15, h: 5 },
    { x: 1, y: base - 6, w: 15, h: 5 },
    { x: -8, y: base - 12, w: 15, h: 5 },
    { x: -3, y: base - 18, w: 15, h: 5 },
  ]) {
    block(graphics, cx + b.x, b.y, b.w, b.h, metal, 2.6);
    // The sheen: one bright line along the lit edge of the top face.
    graphics.fillStyle(shade(metal, 1.75), 1);
    polygonAt(graphics, [
      [cx + b.x + 1, b.y - b.h],
      [cx + b.x + b.w * 0.5, b.y - b.h - 2.2],
      [cx + b.x + b.w * 0.5, b.y - b.h - 1],
      [cx + b.x + 1.6, b.y - b.h + 1],
    ]);
  }
}

/**
 * Tools: helves and blades, leaning together.
 *
 * The one heap that is not a stack, because tools are not stacked — they are
 * stood up in a corner. Two shafts crossed with iron on the ends, which is a
 * silhouette nothing else in the settlement has.
 */
function drawTools(graphics: Phaser.GameObjects.Graphics, box: PileBox): void {
  const cx = box.width / 2;
  const base = box.height;
  groundShadow(graphics, cx, base, 30);

  const helve = 0x9a7c4e;
  const iron = 0x3f444a;

  // A bundle of shafts, leaning both ways from a shared foot.
  for (const [dx, dy, tilt] of [
    [-9, -27, -1],
    [-4, -30, -1],
    [8, -25, 1],
  ] as const) {
    graphics.fillStyle(shade(helve, tilt < 0 ? 1.08 : 0.86), 1);
    polygonAt(graphics, [
      [cx - 2 + tilt, base - 4],
      [cx + 2 + tilt, base - 4],
      [cx + dx + 2, base + dy],
      [cx + dx - 1, base + dy],
    ]);
  }

  // An axe head on the tallest, and a saw blade on the leftmost.
  graphics.fillStyle(iron, 1);
  polygonAt(graphics, [
    [cx - 5, base - 30],
    [cx - 12, base - 27],
    [cx - 11, base - 21],
    [cx - 4, base - 25],
  ]);
  graphics.fillStyle(shade(iron, 1.5), 1);
  polygonAt(graphics, [
    [cx - 12, base - 27],
    [cx - 11, base - 21],
    [cx - 13.4, base - 22],
    [cx - 14, base - 26],
  ]);
  // A blade on the right-hand shaft, edge-on and dull.
  graphics.fillStyle(shade(iron, 1.16), 1);
  polygonAt(graphics, [
    [cx + 8, base - 25],
    [cx + 15, base - 21],
    [cx + 14, base - 18],
    [cx + 7, base - 22],
  ]);
  // The withy holding them, low down. Brown and thin: a black bar across the
  // shafts read as a strap on a bundle of planks.
  graphics.fillStyle(0x51402c, 1);
  graphics.fillRect(cx - 5, base - 12, 11, 1.8);
}

/**
 * Hides: pelts folded and piled.
 *
 * Soft edges, and the only heap in the set with a curve on top of every layer —
 * everything else here is either square or round, and a folded skin is neither.
 */
function drawHides(graphics: Phaser.GameObjects.Graphics, box: PileBox): void {
  const cx = box.width / 2;
  const base = box.height;
  groundShadow(graphics, cx, base, 34);

  // Offset each fold. Stacked concentrically the heap read as a tiered cake;
  // pelts are never folded the same way twice and the pile leans.
  const layers = [
    { x: -1, y: base - 5, w: 32, c: 0x6f5940 },
    { x: 2, y: base - 11, w: 28, c: 0x8d7150 },
    { x: -3, y: base - 16, w: 26, c: 0x7c6144 },
    { x: 1, y: base - 21, w: 21, c: 0x9c8160 },
  ];
  for (const layer of layers) {
    graphics.fillStyle(shade(layer.c, 0.76), 1);
    graphics.fillRect(cx + layer.x - layer.w / 2, layer.y - 5, layer.w, 6);
    graphics.fillStyle(layer.c, 1);
    graphics.fillEllipse(cx + layer.x, layer.y - 5, layer.w, 6.5);
    graphics.fillStyle(shade(layer.c, 1.22), 1);
    graphics.fillEllipse(cx + layer.x - 3, layer.y - 6.4, layer.w * 0.55, 3.6);
  }

  // A flap hanging off one side and a leg off the other, which is what says
  // *skin* rather than *cloth*: a bolt of cloth has four straight edges.
  graphics.fillStyle(0x6b5138, 1);
  polygonAt(graphics, [
    [cx + 12, base - 25],
    [cx + 19, base - 21],
    [cx + 16, base - 16],
    [cx + 11, base - 20],
  ]);
  graphics.fillStyle(0x7a5f42, 1);
  polygonAt(graphics, [
    [cx - 12, base - 13],
    [cx - 19, base - 9],
    [cx - 17, base - 6],
    [cx - 11, base - 9],
  ]);
}

/**
 * Clothing: bolts of cloth, folded flat and dyed.
 *
 * Three colours, because dyed cloth is the one good in this settlement that is
 * allowed to be colourful — and it is the only thing that distinguishes a stack
 * of cloth from a stack of hides at a glance.
 */
function drawClothing(graphics: Phaser.GameObjects.Graphics, box: PileBox): void {
  const cx = box.width / 2;
  const base = box.height;
  groundShadow(graphics, cx, base, 32);

  for (const b of [
    { x: -14, y: base - 6, w: 27, h: 6, c: 0x6f7a68 },
    { x: -12, y: base - 12, w: 24, h: 6, c: 0x8a6b6b },
    { x: -10, y: base - 18, w: 21, h: 6, c: 0xa8a08a },
    { x: -7, y: base - 24, w: 16, h: 5, c: 0x6a6f82 },
  ]) {
    block(graphics, cx + b.x, b.y, b.w, b.h, b.c, 3);
    // A seam along the fold, which is what says *folded* rather than *painted*.
    graphics.fillStyle(shade(b.c, 0.62), 1);
    graphics.fillRect(cx + b.x + 1, b.y - b.h * 0.35, b.w * 0.5, 1.2);
  }
}

/**
 * Herbs: bundles tied at the stem.
 *
 * Grey-green, wispy, and laid rather than stacked. The tied waist is the shape
 * cue and the colour is the second one: nothing else on the ground is green.
 */
function drawHerbs(graphics: Phaser.GameObjects.Graphics, box: PileBox): void {
  const cx = box.width / 2;
  const base = box.height;
  groundShadow(graphics, cx, base, 30);

  const bundle = (x: number, y: number, height: number, colour: number): void => {
    // Leaf head, fanning out at the top.
    graphics.fillStyle(colour, 1);
    polygonAt(graphics, [
      [cx + x, y - height],
      [cx + x + 8, y - height * 0.55],
      [cx + x + 3, y],
      [cx + x - 3, y],
      [cx + x - 8, y - height * 0.55],
    ]);
    graphics.fillStyle(shade(colour, 1.22), 1);
    polygonAt(graphics, [
      [cx + x, y - height],
      [cx + x + 4, y - height * 0.5],
      [cx + x, y - height * 0.3],
      [cx + x - 4, y - height * 0.5],
    ]);
    // The tie.
    graphics.fillStyle(0x6b5b3a, 1);
    graphics.fillRect(cx + x - 3.4, y - height * 0.24, 7, 2);
  };

  bundle(-9, base - 4, 20, 0x4f5f38);
  bundle(9, base - 3, 17, 0x5f6d42);
  bundle(0, base - 6, 24, 0x6b7a4a);
}

/** Every heap, by the good it is made of. */
const PILES: Readonly<
  Record<ResourceId, (graphics: Phaser.GameObjects.Graphics, box: PileBox) => void>
> = {
  // The five foods: the same basket, told apart by what is in it. Kept within
  // the settlement's earth tones — a scarlet heap of apples would pull the eye
  // off the buildings, and food is the good there is most of on the ground.
  vegetables: (graphics, box) => drawFood(graphics, box, [0x5f7038, 0x4c5c2e, 0x76883f, 0x8a7a3f]),
  fruit: (graphics, box) =>
    drawFood(graphics, box, [0x9c4b2e, 0xa8632c, 0x8a3f2c, 0x7d6a34], 'windfall'),
  fish: (graphics, box) =>
    drawFood(graphics, box, [0x7f8790, 0x6d757e, 0x8d949a, 0x5f666d], 'fish'),
  meat: (graphics, box) =>
    drawFood(graphics, box, [0x84402f, 0x6f3226, 0x91553c, 0x5c2b22], 'joint'),
  spices: (graphics, box) =>
    drawFood(graphics, box, [0x9a7434, 0x7d5a2c, 0xa8874a, 0x6b4f2a], 'bunches'),
  logs: drawLogs,
  firewood: drawFirewood,
  stone: drawStone,
  iron: drawIron,
  tools: drawTools,
  hides: drawHides,
  clothing: drawClothing,
  herbs: drawHerbs,
};

/** Draws the heap for one good into a sprite box with its base at the bottom. */
export function drawPile(
  graphics: Phaser.GameObjects.Graphics,
  resource: ResourceId,
  box: PileBox,
): void {
  PILES[resource](graphics, box);
}
