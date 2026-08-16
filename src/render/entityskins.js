// Procedural 64x64 entity skins — one painted layer per model in render/models.js,
// laid out on vanilla's box unwrap so every UV in that file lands where it should,
// plus the ground-shadow sprite. Uploaded as their own TEXTURE_2D_ARRAY.

import { Painter, scaleColor } from './painter.js';

export const SKIN_SIZE = 64;

// ---------------------------------------------------------------- unwrap

/**
 * Mirror of `faceRects` in render/models.js. A box at (u,v) sized w*h*d unwraps
 * as a cross: right -> front -> left -> back wraps the sides, top and bottom sit
 * on the row above. Every rect is [x, y, w, h] in texture pixels.
 */
function unwrap(u, v, w, h, d) {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + d + w + d, v + d, w, h],
  };
}

const SIDES = ['front', 'back', 'left', 'right'];
const ALL = ['top', 'bottom', 'front', 'back', 'left', 'right'];

// ---------------------------------------------------------------- rect helpers

/** Fills a whole face rect. */
function fillRect(p, r, color, alpha = 255) {
  p.rect(r[0], r[1], r[2], r[3], color, alpha);
}

/** Fills a sub-rect in face-local coordinates. */
function sub(p, r, x, y, w, h, color, alpha = 255) {
  p.rect(r[0] + x, r[1] + y, w, h, color, alpha);
}

/** Sets one pixel in face-local coordinates. */
function dot(p, r, x, y, color, alpha = 255) {
  p.set(r[0] + x, r[1] + y, color, alpha);
}

/** Paints string art into a face at a local offset. */
function stencil(p, r, x, y, rows, palette) {
  p.art(rows, palette, r[0] + x, r[1] + y);
}

/** Scatters a colour through a rect. */
function fleck(p, r, color, chance, alpha = 255) {
  for (let y = r[1]; y < r[1] + r[3]; y++) {
    for (let x = r[0]; x < r[0] + r[2]; x++) {
      if (p.chance(chance)) p.set(x, y, color, alpha);
    }
  }
}

/** Scatters a colour over every face of a box. */
function fleckBox(p, f, color, chance) {
  for (const k of ALL) fleck(p, f[k], color, chance);
}

/** Irregular blobs clipped to a rect — cow patches, creeper mottling. */
function blotch(p, r, color, count, minR = 1, maxR = 3) {
  for (let i = 0; i < count; i++) {
    const cx = r[0] + p.randInt(0, Math.max(0, r[2] - 1));
    const cy = r[1] + p.randInt(0, Math.max(0, r[3] - 1));
    const rad = p.randInt(minR, maxR);
    for (let y = cy - rad; y <= cy + rad; y++) {
      for (let x = cx - rad; x <= cx + rad; x++) {
        if (x < r[0] || y < r[1] || x >= r[0] + r[2] || y >= r[1] + r[3]) continue;
        if (Math.hypot(x - cx, y - cy) > rad + p.rng.float(-0.6, 0.6)) continue;
        p.set(x, y, color);
      }
    }
  }
}

/** Blotches every face of a box, so a pattern wraps the whole model part. */
function blotchBox(p, f, color, perFace, minR = 1, maxR = 3) {
  for (const k of ALL) blotch(p, f[k], color, perFace, minR, maxR);
}

/** Fills all six faces of an unwrapped box. */
function solid(p, f, color, opts = {}) {
  fillRect(p, f.top, opts.top ?? color);
  fillRect(p, f.bottom, opts.bottom ?? scaleColor(color, 0.86));
  fillRect(p, f.front, opts.front ?? color);
  fillRect(p, f.back, opts.back ?? color);
  fillRect(p, f.left, opts.side ?? color);
  fillRect(p, f.right, opts.side ?? color);
  return f;
}

/** Unwraps and fills a box in one call. */
function cube(p, u, v, w, h, d, color, opts) {
  return solid(p, unwrap(u, v, w, h, d), color, opts);
}

/** Recolours the top `n` rows of the four side faces plus the cap — sleeves, collars. */
function capTop(p, f, n, color) {
  fillRect(p, f.top, color);
  for (const k of SIDES) {
    const r = f[k];
    p.rect(r[0], r[1], r[2], Math.min(n, r[3]), color);
  }
}

/** Recolours the bottom `n` rows of the four side faces plus the base — boots, hooves. */
function capBottom(p, f, n, color) {
  fillRect(p, f.bottom, color);
  for (const k of SIDES) {
    const r = f[k];
    const rows = Math.min(n, r[3]);
    p.rect(r[0], r[1] + r[3] - rows, r[2], rows, color);
  }
}

/** Ragged glowing fissures running down a face. */
function cracks(p, r, count, core, glow) {
  for (let i = 0; i < count; i++) {
    let x = r[0] + p.randInt(0, Math.max(0, r[2] - 1));
    let y = r[1] + p.randInt(0, Math.max(0, r[3] - 1));
    const len = p.randInt(3, Math.max(4, r[3]));
    for (let s = 0; s < len; s++) {
      if (x < r[0] || y < r[1] || x >= r[0] + r[2] || y >= r[1] + r[3]) break;
      p.set(x, y, core);
      if (x + 1 < r[0] + r[2] && p.chance(0.4)) p.set(x + 1, y, glow);
      if (p.chance(0.4)) x += p.chance(0.5) ? 1 : -1;
      y++;
    }
  }
}

// ---------------------------------------------------------------- humanoid base

/**
 * The player/zombie/skeleton layout. `limb` is arm and leg thickness — 4 for
 * flesh, 2 for bone — and must match `humanoid()` in render/models.js.
 */
function humanoid(p, c, limb = 4) {
  const skin = c.skin;
  const f = {
    head: cube(p, 0, 0, 8, 8, 8, c.head ?? skin),
    body: cube(p, 16, 16, 8, 12, 4, c.shirt ?? skin),
    rightArm: cube(p, 40, 16, limb, 12, limb, c.arm ?? skin),
    leftArm: cube(p, 32, 48, limb, 12, limb, c.arm ?? skin),
    rightLeg: cube(p, 0, 16, limb, 12, limb, c.pants ?? skin),
    leftLeg: cube(p, 16, 48, limb, 12, limb, c.pants ?? skin),
  };
  if (c.sleeve !== undefined) {
    capTop(p, f.rightArm, c.sleeveRows ?? 5, c.sleeve);
    capTop(p, f.leftArm, c.sleeveRows ?? 5, c.sleeve);
  }
  if (c.boots !== undefined) {
    capBottom(p, f.rightLeg, c.bootRows ?? 3, c.boots);
    capBottom(p, f.leftLeg, c.bootRows ?? 3, c.boots);
  }
  return f;
}

/** Two eyes with a highlight, drawn into a face at the usual head height. */
function eyes(p, face, x0, x1, y, white, pupil) {
  sub(p, face, x0, y, 2, 2, white);
  sub(p, face, x1, y, 2, 2, white);
  dot(p, face, x0 + 1, y + 1, pupil);
  dot(p, face, x1, y + 1, pupil);
}

// ---------------------------------------------------------------- skins

function paintPlayer(p) {
  const skin = 0xc79a6b;
  const hair = 0x46301d;
  const tunic = 0x4c6b3f;
  const belt = 0x5c3a22;
  const pants = 0x4a4133;
  const boots = 0x35271a;

  const f = humanoid(p, {
    skin, shirt: tunic, pants, arm: skin,
    sleeve: tunic, sleeveRows: 6, boots, bootRows: 3,
  });

  const face = f.head.front;
  sub(p, face, 0, 0, 8, 2, scaleColor(skin, 0.92));
  eyes(p, face, 1, 5, 3, 0xf2f2f2, 0x36435c);
  sub(p, face, 3, 6, 2, 1, 0x8f6446);
  fleck(p, face, scaleColor(skin, 1.06), 0.06);

  // A hat layer is what gives the adventurer hair instead of a bald cube.
  const hat = unwrap(32, 0, 8, 8, 8);
  fillRect(p, hat.top, hair);
  fillRect(p, hat.back, hair);
  fillRect(p, hat.left, hair);
  fillRect(p, hat.right, hair);
  sub(p, hat.front, 0, 0, 8, 2, hair);
  dot(p, hat.front, 1, 2, hair);
  dot(p, hat.front, 6, 2, hair);
  fleck(p, hat.top, scaleColor(hair, 1.25), 0.2);
  fleck(p, hat.back, scaleColor(hair, 0.82), 0.2);

  // Tunic: a laced collar, a belt with a buckle, and a lighter chest panel.
  const chest = f.body.front;
  sub(p, chest, 0, 0, 8, 1, scaleColor(tunic, 0.8));
  sub(p, chest, 3, 1, 2, 4, scaleColor(tunic, 1.14));
  sub(p, chest, 0, 8, 8, 2, belt);
  sub(p, chest, 3, 8, 2, 2, 0xc8a12c);
  sub(p, f.body.back, 0, 8, 8, 2, belt);
  sub(p, f.body.left, 0, 8, 4, 2, belt);
  sub(p, f.body.right, 0, 8, 4, 2, belt);
  fleckBox(p, f.body, scaleColor(tunic, 0.86), 0.1);
}

function paintZombie(p) {
  const skin = 0x4e7038;
  const shirt = 0x1d8a85;
  const pants = 0x33396b;

  const f = humanoid(p, {
    skin, shirt, pants, arm: skin,
    sleeve: shirt, sleeveRows: 5, boots: 0x282d4f, bootRows: 3,
  });

  const face = f.head.front;
  sub(p, face, 0, 0, 8, 2, scaleColor(skin, 0.82));      // heavy brow
  sub(p, face, 1, 3, 2, 2, 0x0f1a0a);                    // sunken sockets
  sub(p, face, 5, 3, 2, 2, 0x0f1a0a);
  dot(p, face, 2, 4, 0x2c4a1f);
  dot(p, face, 5, 4, 0x2c4a1f);
  sub(p, face, 2, 6, 4, 1, 0x22331a);                    // slack mouth
  dot(p, face, 3, 5, 0x3d5c2b);

  fleckBox(p, f.head, scaleColor(skin, 0.84), 0.14);
  fleckBox(p, f.body, scaleColor(shirt, 0.78), 0.13);
  fleck(p, f.body.front, skin, 0.05);                    // rot showing through
  fleck(p, f.body.back, skin, 0.05);
  fleckBox(p, f.rightArm, scaleColor(skin, 0.8), 0.12);
  fleckBox(p, f.leftArm, scaleColor(skin, 0.8), 0.12);
  fleckBox(p, f.rightLeg, scaleColor(pants, 0.8), 0.12);
  fleckBox(p, f.leftLeg, scaleColor(pants, 0.8), 0.12);
}

function paintWitheredHusk(p) {
  const skin = 0x6d6a54;
  const shirt = 0x453f33;
  const pants = 0x36322a;

  const f = humanoid(p, {
    skin, shirt, pants, arm: skin,
    sleeve: shirt, sleeveRows: 4, boots: 0x272319, bootRows: 3,
  });

  const face = f.head.front;
  sub(p, face, 0, 0, 8, 2, scaleColor(skin, 0.78));
  sub(p, face, 1, 3, 2, 2, 0x120f0a);
  sub(p, face, 5, 3, 2, 2, 0x120f0a);
  dot(p, face, 2, 4, 0xd8641a);                          // an ember still burning
  dot(p, face, 5, 4, 0xd8641a);
  sub(p, face, 2, 6, 4, 1, 0x1d1a12);

  for (const k of ALL) fleck(p, f.body[k], scaleColor(shirt, 0.7), 0.18);
  cracks(p, f.body.front, 2, 0x8a3d10, 0xd2691e);
  fleckBox(p, f.head, scaleColor(skin, 0.8), 0.16);
  fleckBox(p, f.rightArm, scaleColor(skin, 0.78), 0.14);
  fleckBox(p, f.leftArm, scaleColor(skin, 0.78), 0.14);
}

function paintSkeleton(p) {
  const bone = 0xc9c8c0;
  const shade = 0x9d9c94;
  const f = humanoid(p, { skin: bone, shirt: bone, pants: bone }, 2);

  const face = f.head.front;
  sub(p, face, 1, 2, 2, 3, 0x0a0a0a);                    // deep sockets
  sub(p, face, 5, 2, 2, 3, 0x0a0a0a);
  sub(p, face, 3, 4, 2, 1, shade);                       // nasal notch
  sub(p, face, 1, 6, 6, 1, 0x1a1a18);                    // jaw line
  dot(p, face, 2, 6, bone);
  dot(p, face, 4, 6, bone);
  dot(p, face, 6, 6, bone);
  sub(p, face, 0, 0, 8, 1, scaleColor(bone, 1.1));

  // A ribcage reads at a glance even from across a dark room.
  const chest = f.body.front;
  fillRect(p, chest, scaleColor(bone, 0.94));
  for (let y = 1; y < 9; y += 2) sub(p, chest, 1, y, 6, 1, shade);
  sub(p, chest, 3, 0, 2, 12, scaleColor(bone, 1.08));    // sternum
  sub(p, chest, 0, 10, 8, 2, scaleColor(bone, 0.8));     // pelvis
  const spine = f.body.back;
  sub(p, spine, 3, 0, 2, 12, shade);
  for (let y = 1; y < 12; y += 2) sub(p, spine, 3, y, 2, 1, scaleColor(bone, 1.1));

  fleckBox(p, f.head, shade, 0.1);
  fleckBox(p, f.rightArm, shade, 0.16);
  fleckBox(p, f.leftArm, shade, 0.16);
  fleckBox(p, f.rightLeg, shade, 0.16);
  fleckBox(p, f.leftLeg, shade, 0.16);
}

function paintCreeper(p) {
  const green = 0x6bae5f;
  const dark = 0x4b8a44;
  const light = 0x88c477;

  const head = cube(p, 0, 0, 8, 8, 8, green);
  const body = cube(p, 16, 16, 8, 12, 4, green);
  const leg = cube(p, 0, 16, 4, 6, 4, green);

  for (const f of [head, body, leg]) {
    blotchBox(p, f, dark, 2, 1, 2);
    blotchBox(p, f, light, 1, 1, 2);
    fleckBox(p, f, dark, 0.12);
    fleckBox(p, f, light, 0.1);
  }

  // The face. Nothing else about a creeper matters as much as this.
  const FACE = [
    '........',
    '........',
    '.##..##.',
    '.##..##.',
    '...##...',
    '..####..',
    '..####..',
    '..#..#..',
  ];
  stencil(p, head.front, 0, 0, FACE, { '#': 0x000000 });
}

function paintSpider(p) {
  const hide = 0x2b2119;
  const fur = 0x3b2e23;
  const eye = 0xc42121;

  const body = cube(p, 0, 0, 6, 9, 6, hide);
  const head = cube(p, 24, 0, 8, 8, 8, hide);
  const abdomen = cube(p, 0, 16, 10, 8, 12, hide);
  const leg = cube(p, 0, 40, 16, 2, 2, scaleColor(hide, 0.9));

  for (const f of [body, head, abdomen, leg]) {
    fleckBox(p, f, fur, 0.22);
    fleckBox(p, f, scaleColor(hide, 0.7), 0.16);
  }
  blotch(p, abdomen.front, 0x53372a, 3, 1, 3);
  blotch(p, abdomen.back, 0x53372a, 2, 1, 3);

  // Four eyes on the face, two more on the crown.
  const face = head.front;
  sub(p, face, 1, 2, 2, 2, eye);
  sub(p, face, 5, 2, 2, 2, eye);
  dot(p, face, 2, 5, eye);
  dot(p, face, 5, 5, eye);
  dot(p, face, 1, 3, 0xf06060);
  dot(p, face, 5, 3, 0xf06060);
  dot(p, head.top, 2, 6, eye);
  dot(p, head.top, 5, 6, eye);
}

function paintPig(p) {
  const pink = 0xefa5a2;
  const snoutColor = 0xd57b80;
  const hoof = 0xb0736f;

  const head = cube(p, 0, 0, 8, 8, 8, pink);
  const snout = cube(p, 16, 16, 4, 3, 1, snoutColor);
  const body = cube(p, 28, 16, 10, 16, 8, pink);
  const leg = cube(p, 0, 16, 4, 6, 4, pink);

  const face = head.front;
  eyes(p, face, 1, 5, 2, 0xf6f6f6, 0x2a1a16);
  sub(p, face, 2, 5, 4, 3, scaleColor(pink, 0.94));      // where the snout sits
  sub(p, head.top, 1, 1, 2, 2, scaleColor(pink, 0.88));  // ears
  sub(p, head.top, 5, 1, 2, 2, scaleColor(pink, 0.88));

  dot(p, snout.front, 1, 1, 0x6b3634);
  dot(p, snout.front, 2, 1, 0x6b3634);

  capBottom(p, leg, 2, hoof);
  for (const f of [head, body, leg]) fleckBox(p, f, scaleColor(pink, 0.92), 0.16);
  blotch(p, body.front, scaleColor(pink, 0.94), 3, 1, 3);
}

function paintCow(p) {
  const white = 0xe6e2da;
  const black = 0x271f1a;
  const muzzle = 0xc9a3a0;
  const horn = 0xd6d0b6;
  const udder = 0xe2969b;

  // Legs first: their unwrap clips the body's back face by a couple of columns,
  // and white-on-white is the one overlap nobody can see.
  const leg = cube(p, 44, 16, 4, 12, 4, white);
  capBottom(p, leg, 3, 0x2c2621);

  const head = cube(p, 0, 0, 8, 8, 6, black);
  cube(p, 28, 0, 1, 3, 1, horn);
  const body = cube(p, 0, 16, 12, 18, 10, white);

  const face = head.front;
  sub(p, face, 2, 4, 4, 4, muzzle);
  dot(p, face, 3, 5, 0x5c3b39);
  dot(p, face, 5, 5, 0x5c3b39);
  eyes(p, face, 0, 6, 2, 0xf2f2f2, 0x1a1512);
  sub(p, head.top, 0, 0, 8, 2, scaleColor(black, 1.2));

  // Holstein patches, then the udder on the belly (the body barrel is laid
  // down, so its `back` face is what points at the ground).
  for (const k of ALL) blotch(p, body[k], black, 2, 2, 4);
  blotch(p, body.front, black, 2, 2, 5);
  const belly = body.back;
  sub(p, belly, 4, 2, 4, 3, udder);
  sub(p, belly, 5, 5, 1, 1, scaleColor(udder, 0.8));
  sub(p, belly, 6, 5, 1, 1, scaleColor(udder, 0.8));

  fleckBox(p, body, scaleColor(white, 0.93), 0.1);
  fleckBox(p, head, scaleColor(black, 1.25), 0.12);
}

function paintSheep(p) {
  const wool = 0xe8e4db;
  const woolDark = 0xcfc9bd;
  const faceSkin = 0xdcc9b1;
  const hoof = 0x585048;

  // The inner head and body are only seen through the fleece, but painting them
  // properly costs nothing and keeps a sheared sheep from looking hollow.
  cube(p, 0, 0, 6, 6, 8, faceSkin);
  cube(p, 0, 16, 6, 16, 8, 0xdcb6a3);

  const cap = cube(p, 28, 0, 6, 6, 8, wool);
  const fleece = cube(p, 28, 16, 6, 16, 8, wool);
  const leg = cube(p, 0, 40, 4, 12, 4, wool);
  capBottom(p, leg, 3, hoof);

  // The face is painted onto the wool cap, which sits outside the head box.
  const face = cap.front;
  fillRect(p, face, faceSkin);
  sub(p, face, 0, 0, 6, 1, wool);                        // fringe
  dot(p, face, 1, 2, 0x171310);
  dot(p, face, 4, 2, 0x171310);
  sub(p, face, 2, 4, 2, 1, 0xb99c85);
  fleck(p, face, scaleColor(faceSkin, 0.92), 0.12);

  for (const f of [cap, fleece, leg]) {
    fleckBox(p, f, woolDark, 0.2);
    fleckBox(p, f, scaleColor(wool, 1.05), 0.16);
  }
  blotchBox(p, fleece, woolDark, 2, 1, 2);
}

function paintChicken(p) {
  const feather = 0xefefef;
  const beakColor = 0xe8a90c;
  const wattle = 0xb81c1c;
  const shadow = 0xd2d2cc;

  const head = cube(p, 0, 0, 4, 6, 3, feather);
  cube(p, 14, 0, 4, 2, 2, beakColor);
  cube(p, 14, 4, 2, 2, 2, wattle);
  const body = cube(p, 0, 9, 6, 8, 6, feather);
  const wing = cube(p, 24, 10, 1, 4, 6, feather);
  const foot = cube(p, 26, 0, 3, 5, 3, beakColor);

  const face = head.front;
  dot(p, face, 0, 2, 0x151515);
  dot(p, face, 3, 2, 0x151515);
  sub(p, head.top, 1, 0, 2, 2, wattle);                  // comb
  dot(p, head.top, 1, 2, wattle);

  for (const f of [head, body, wing]) fleckBox(p, f, shadow, 0.18);
  sub(p, wing.right, 0, 3, 6, 1, shadow);
  sub(p, wing.left, 0, 3, 6, 1, shadow);
  fleckBox(p, foot, scaleColor(beakColor, 0.82), 0.2);
}

function paintVillager(p) {
  const skin = 0xbe8b6a;
  const robe = 0x6b4c36;
  const robeDark = 0x4a3324;
  const apron = 0x8d6a4c;

  const head = cube(p, 0, 0, 8, 8, 8, skin);
  const nose = cube(p, 32, 0, 2, 4, 2, scaleColor(skin, 0.9));
  const body = cube(p, 0, 18, 8, 12, 6, robe);
  const arms = cube(p, 28, 18, 8, 8, 4, robe);
  const rightLeg = cube(p, 0, 36, 4, 12, 4, robeDark);
  const leftLeg = cube(p, 16, 36, 4, 12, 4, robeDark);

  const face = head.front;
  sub(p, face, 0, 0, 8, 2, scaleColor(skin, 0.94));      // bald, and proud of it
  sub(p, face, 1, 2, 6, 1, 0x3b2a1e);                    // the unibrow
  eyes(p, face, 1, 5, 3, 0xf4f4f4, 0x3d2a5c);
  sub(p, face, 3, 5, 2, 3, scaleColor(skin, 0.86));      // nose shadow
  sub(p, face, 2, 6, 4, 1, 0x8a5f42);
  fleck(p, head.top, scaleColor(skin, 1.05), 0.14);
  fleckBox(p, nose, scaleColor(skin, 0.82), 0.16);

  const chest = body.front;
  sub(p, chest, 2, 0, 4, 12, apron);                     // the tabard
  sub(p, chest, 0, 9, 8, 2, robeDark);                   // belt
  sub(p, body.back, 0, 9, 8, 2, robeDark);
  sub(p, body.left, 0, 9, 6, 2, robeDark);
  sub(p, body.right, 0, 9, 6, 2, robeDark);
  capBottom(p, arms, 2, skin);                           // folded hands
  fleckBox(p, body, robeDark, 0.12);
  fleckBox(p, arms, robeDark, 0.12);
  fleckBox(p, rightLeg, scaleColor(robeDark, 0.86), 0.14);
  fleckBox(p, leftLeg, scaleColor(robeDark, 0.86), 0.14);
}

function paintBoss(p) {
  const slate = 0x343a3f;
  const deep = 0x22272b;
  const ember = 0xff7a18;
  const glow = 0xffc25c;

  const head = cube(p, 0, 0, 8, 8, 8, slate);
  const body = cube(p, 0, 16, 9, 8, 4, slate);
  const rightArm = cube(p, 26, 16, 4, 9, 4, slate);
  const leftArm = cube(p, 42, 16, 4, 9, 4, slate);
  const rightPad = cube(p, 0, 30, 5, 3, 5, deep);
  const leftPad = cube(p, 20, 30, 5, 3, 5, deep);
  const rightLeg = cube(p, 40, 30, 3, 8, 3, slate);
  const leftLeg = cube(p, 52, 30, 3, 8, 3, slate);

  const parts = [head, body, rightArm, leftArm, rightPad, leftPad, rightLeg, leftLeg];
  for (const f of parts) {
    fleckBox(p, f, deep, 0.2);
    fleckBox(p, f, scaleColor(slate, 1.18), 0.12);
  }

  // Fissures with an ember burning somewhere behind them.
  cracks(p, body.front, 3, ember, glow);
  cracks(p, body.back, 2, ember, glow);
  cracks(p, rightArm.front, 2, ember, glow);
  cracks(p, leftArm.front, 2, ember, glow);
  cracks(p, rightLeg.front, 1, ember, glow);
  cracks(p, leftLeg.front, 1, ember, glow);
  cracks(p, head.left, 1, ember, glow);
  cracks(p, head.right, 1, ember, glow);

  const face = head.front;
  fillRect(p, face, deep);
  sub(p, face, 1, 3, 2, 1, ember);                       // eye slits
  sub(p, face, 5, 3, 2, 1, ember);
  dot(p, face, 2, 3, glow);
  dot(p, face, 5, 3, glow);
  sub(p, face, 2, 6, 4, 1, scaleColor(ember, 0.55));
  fleck(p, face, scaleColor(deep, 1.2), 0.1);

  // The core in the chest, the thing the whole story is about.
  sub(p, body.front, 3, 3, 3, 3, ember);
  sub(p, body.front, 4, 4, 1, 1, glow);
}

function paintItem(p) {
  const sack = 0xb08a55;
  const tie = 0x6b4d2b;
  const f = cube(p, 0, 0, 8, 8, 8, sack);
  for (const k of SIDES) sub(p, f[k], 0, 2, f[k][2], 1, tie);
  fillRect(p, f.top, scaleColor(sack, 1.08));
  sub(p, f.top, 3, 3, 2, 2, tie);
  fleckBox(p, f, scaleColor(sack, 0.85), 0.2);
}

/** A soft radial blob; the shader's alpha test trims the faint outer ring. */
function paintShadow(p) {
  const c = (SKIN_SIZE - 1) / 2;
  const r = SKIN_SIZE / 2;
  for (let y = 0; y < SKIN_SIZE; y++) {
    for (let x = 0; x < SKIN_SIZE; x++) {
      const d = Math.hypot(x - c, y - c) / r;
      if (d >= 1) continue;
      p.set(x, y, 0x000000, Math.round(Math.pow(1 - d, 1.6) * 215));
    }
  }
}

// ---------------------------------------------------------------- registry

/** Layer order is stable: saves and the renderer both look skins up by name. */
const SKINS = [
  { name: 'player', paint: paintPlayer },
  { name: 'zombie', paint: paintZombie },
  { name: 'withered_husk', paint: paintWitheredHusk },
  { name: 'skeleton', paint: paintSkeleton },
  { name: 'creeper', paint: paintCreeper },
  { name: 'spider', paint: paintSpider },
  { name: 'pig', paint: paintPig },
  { name: 'cow', paint: paintCow },
  { name: 'sheep', paint: paintSheep },
  { name: 'chicken', paint: paintChicken },
  { name: 'villager', paint: paintVillager },
  { name: 'boss', paint: paintBoss },
  { name: 'item', paint: paintItem },
  { name: 'shadow', paint: paintShadow, noise: false },
];

/** Name of the soft blob layer the entity renderer draws ground shadows with. */
export const SHADOW_SKIN = 'shadow';

export class SkinAtlas {
  constructor() {
    this.size = SKIN_SIZE;
    /** @type {Map<string, number>} skin name -> array layer */
    this.index = new Map();
    /** @type {string[]} layer -> name */
    this.names = [];
    /** @type {Uint8Array|null} layers * size * size * 4 */
    this.pixels = null;
    /** @type {HTMLCanvasElement[]} per-layer canvas, for 2D previews */
    this.canvases = [];
    this.layers = 0;
    this.texture = null;
    this.gl = null;
    this.built = false;
    this._warned = null;
  }

  /** Paints every skin. Cheap enough (14 * 64x64) to do in one boot step. */
  buildSync() {
    if (this.built) return this;
    const px = SKIN_SIZE * SKIN_SIZE * 4;
    this.layers = SKINS.length;
    this.pixels = new Uint8Array(this.layers * px);
    this.names = SKINS.map((s) => s.name);
    this.canvases = [];
    this.index.clear();

    for (let i = 0; i < SKINS.length; i++) {
      const def = SKINS[i];
      const p = new Painter(`entityskin:${def.name}`, SKIN_SIZE);
      def.paint(p);
      // Per-pixel shading noise, so nothing reads as a flat plastic colour.
      if (def.noise !== false) p.jitter(0.9, 1.1);
      this.index.set(def.name, i);
      this.pixels.set(p.data, i * px);
      this.canvases.push(p.toCanvas());
    }
    this.built = true;
    return this;
  }

  upload(gl) {
    if (!this.pixels) this.buildSync();
    this.gl = gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, this.size, this.size, this.layers);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0,
      this.size, this.size, this.layers,
      gl.RGBA, gl.UNSIGNED_BYTE, this.pixels,
    );
    // No mipmaps: a mip chain over a 64x64 unwrap bleeds one face into the next.
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    this.texture = tex;
    return tex;
  }

  has(name) { return this.index.has(name); }

  /** Layer index for a skin name; unknown names fall back to the player. */
  layerOf(name) {
    const l = this.index.get(name);
    if (l === undefined) {
      if (!this._warned) this._warned = new Set();
      if (!this._warned.has(name)) {
        console.warn(`[entityskins] missing skin "${name}"`);
        this._warned.add(name);
      }
      return 0;
    }
    return l;
  }

  canvasOf(name) {
    const l = this.index.get(name);
    return l === undefined ? null : this.canvases[l];
  }

  destroy() {
    if (this.texture && this.gl) this.gl.deleteTexture(this.texture);
    this.texture = null;
  }
}

export const skins = new SkinAtlas();
