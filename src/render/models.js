// Boxy Minecraft-style entity models: cuboid parts in 1/16-block model space
// (y up, origin between the feet, the model faces +Z so yaw 0 needs no fixup),
// the static mesh builder that flattens one into a VAO, and the animation that
// poses an entity into the 16 part matrices `ENTITY_VS` reads from `uParts`.

import { mat4, clamp, angleDelta } from '../core/math.js';

/** Must match `uniform mat4 uParts[16]` in render/shaders.js. */
const MAX_PARTS = 16;
const HALF_PI = Math.PI / 2;

const box = (from, size, uv, extra = {}) => ({ from, size, uv, ...extra });
const part = (name, pivot, boxes, def = {}) =>
  ({ name, pivot, boxes, default: { rx: 0, ry: 0, rz: 0, ...def } });

// ---------------------------------------------------------------- model data

/**
 * The player/zombie/skeleton family, on vanilla's 64x64 skin layout.
 * `limb` is arm and leg thickness — 4 for flesh, 2 for bone.
 */
function humanoid({ limb = 4, hat = false } = {}) {
  const half = limb / 2;
  const headBoxes = [box([-4, 24, -4], [8, 8, 8], [0, 0])];
  // The hat layer is what gives a humanoid hair instead of a bald cube.
  if (hat) headBoxes.push(box([-4, 24, -4], [8, 8, 8], [32, 0], { inflate: 0.5 }));
  return {
    texW: 64,
    texH: 64,
    parts: [
      part('head', [0, 24, 0], headBoxes),
      part('body', [0, 24, 0], [box([-4, 12, -2], [8, 12, 4], [16, 16])]),
      part('rightArm', [-5, 22, 0], [box([-4 - limb, 12, -half], [limb, 12, limb], [40, 16])]),
      part('leftArm', [5, 22, 0], [box([4, 12, -half], [limb, 12, limb], [32, 48])]),
      part('rightLeg', [-2, 12, 0], [box([-2 - half, 0, -half], [limb, 12, limb], [0, 16])]),
      part('leftLeg', [2, 12, 0], [box([2 - half, 0, -half], [limb, 12, limb], [16, 48])]),
    ],
  };
}

/** One splayed spider leg. 0-3 walk the -X side front-to-back, 4-7 the +X side. */
function spiderLeg(i) {
  const rank = i % 4;
  const minus = i < 4;
  const px = minus ? -3 : 3;
  const pz = 4.5 - rank * 3;
  const from = minus ? [px - 16, 8, pz - 1] : [px, 8, pz - 1];
  return part('leg' + i, [px, 9, pz], [box(from, [16, 2, 2], [0, 40])], {
    // Splay front-to-back, then drop the tip roughly to the ground.
    ry: (0.62 - rank * 0.4) * (minus ? 1 : -1),
    rz: minus ? 0.62 : -0.62,
  });
}

const player = humanoid({ hat: true });
const zombie = humanoid();
const skeleton = humanoid({ limb: 2 });

const villager = {
  texW: 64,
  texH: 64,
  parts: [
    part('head', [0, 24, 0], [
      box([-4, 24, -4], [8, 8, 8], [0, 0]),
      box([-1, 27, 4], [2, 4, 2], [32, 0]),                 // the famous nose
    ]),
    part('body', [0, 24, 0], [box([-4, 12, -3], [8, 12, 6], [0, 18])]),
    // Villager arms are one robed block folded across the chest.
    part('arms', [0, 22, 0], [box([-4, 14, -2], [8, 8, 4], [28, 18])], { rx: -0.75 }),
    part('rightLeg', [-2, 12, 0], [box([-4, 0, -2], [4, 12, 4], [0, 36])]),
    part('leftLeg', [2, 12, 0], [box([0, 0, -2], [4, 12, 4], [16, 36])]),
  ],
};

const creeper = {
  texW: 64,
  texH: 64,
  parts: [
    part('head', [0, 18, 0], [box([-4, 18, -4], [8, 8, 8], [0, 0])]),
    part('body', [0, 6, 0], [box([-4, 6, -2], [8, 12, 4], [16, 16])]),
    part('frontRightLeg', [-2, 6, 4], [box([-4, 0, 2], [4, 6, 4], [0, 16])]),
    part('frontLeftLeg', [2, 6, 4], [box([0, 0, 2], [4, 6, 4], [0, 16])]),
    part('backRightLeg', [-2, 6, -4], [box([-4, 0, -6], [4, 6, 4], [0, 16])]),
    part('backLeftLeg', [2, 6, -4], [box([0, 0, -6], [4, 6, 4], [0, 16])]),
  ],
};

const spider = {
  texW: 64,
  texH: 64,
  parts: [
    part('body', [0, 9, 0], [box([-3, 4, -3], [6, 9, 6], [0, 0])]),
    part('head', [0, 9, 3], [box([-4, 4, 3], [8, 8, 8], [24, 0])]),
    part('abdomen', [0, 9, -3], [box([-5, 3, -15], [10, 8, 12], [0, 16])]),
    spiderLeg(0), spiderLeg(1), spiderLeg(2), spiderLeg(3),
    spiderLeg(4), spiderLeg(5), spiderLeg(6), spiderLeg(7),
  ],
};

const pig = {
  texW: 64,
  texH: 64,
  parts: [
    part('head', [0, 12, 6], [
      box([-4, 8, 6], [8, 8, 8], [0, 0]),
      box([-2, 10, 14], [4, 3, 1], [16, 16]),               // snout
    ]),
    // Quadruped barrels are authored upright and laid down, exactly as vanilla
    // does, so the long side lands on the big w*h face of the unwrap.
    part('body', [0, 10, 0], [box([-5, 2, -4], [10, 16, 8], [28, 16])], { rx: -HALF_PI }),
    part('frontRightLeg', [-3, 6, 5], [box([-5, 0, 3], [4, 6, 4], [0, 16])]),
    part('frontLeftLeg', [3, 6, 5], [box([1, 0, 3], [4, 6, 4], [0, 16])]),
    part('backRightLeg', [-3, 6, -5], [box([-5, 0, -7], [4, 6, 4], [0, 16])]),
    part('backLeftLeg', [3, 6, -5], [box([1, 0, -7], [4, 6, 4], [0, 16])]),
  ],
};

const cow = {
  texW: 64,
  texH: 64,
  parts: [
    part('head', [0, 20, 8], [
      box([-4, 16, 8], [8, 8, 6], [0, 0]),
      box([-5, 22, 10], [1, 3, 1], [28, 0]),                // horns
      box([4, 22, 10], [1, 3, 1], [28, 0]),
    ]),
    part('body', [0, 18, 0], [box([-6, 9, -5], [12, 18, 10], [0, 16])], { rx: -HALF_PI }),
    part('frontRightLeg', [-4, 12, 6], [box([-6, 0, 4], [4, 12, 4], [44, 16])]),
    part('frontLeftLeg', [4, 12, 6], [box([2, 0, 4], [4, 12, 4], [44, 16])]),
    part('backRightLeg', [-4, 12, -6], [box([-6, 0, -8], [4, 12, 4], [44, 16])]),
    part('backLeftLeg', [4, 12, -6], [box([2, 0, -8], [4, 12, 4], [44, 16])]),
  ],
};

const sheep = {
  texW: 64,
  texH: 64,
  parts: [
    part('head', [0, 18, 8], [
      box([-3, 15, 6], [6, 6, 8], [0, 0]),
      box([-3, 15, 6], [6, 6, 8], [28, 0], { inflate: 0.6 }),      // wool cap
    ]),
    part('body', [0, 17, 0], [
      box([-3, 9, -4], [6, 16, 8], [0, 16]),
      box([-3, 9, -4], [6, 16, 8], [28, 16], { inflate: 1.75 }),   // fleece
    ], { rx: -HALF_PI }),
    part('frontRightLeg', [-3, 12, 5], [box([-5, 0, 3], [4, 12, 4], [0, 40])]),
    part('frontLeftLeg', [3, 12, 5], [box([1, 0, 3], [4, 12, 4], [0, 40])]),
    part('backRightLeg', [-3, 12, -5], [box([-5, 0, -7], [4, 12, 4], [0, 40])]),
    part('backLeftLeg', [3, 12, -5], [box([1, 0, -7], [4, 12, 4], [0, 40])]),
  ],
};

const chicken = {
  texW: 64,
  texH: 64,
  parts: [
    part('head', [0, 12, 4], [
      box([-2, 9, 3], [4, 6, 3], [0, 0]),
      box([-2, 11, 6], [4, 2, 2], [14, 0]),                 // beak
      box([-1, 9, 6], [2, 2, 2], [14, 4]),                  // wattle
    ]),
    part('body', [0, 8, 0], [box([-3, 4, -3], [6, 8, 6], [0, 9])], { rx: -HALF_PI }),
    part('rightWing', [-3, 11, 0], [box([-4, 7, -3], [1, 4, 6], [24, 10])]),
    part('leftWing', [3, 11, 0], [box([3, 7, -3], [1, 4, 6], [24, 10])]),
    part('rightLeg', [-2, 5, 0], [box([-3.5, 0, -1.5], [3, 5, 3], [26, 0])]),
    part('leftLeg', [2, 5, 0], [box([0.5, 0, -1.5], [3, 5, 3], [26, 0])]),
  ],
};

// The Hollow Warden: 2.6 blocks of slate, with shoulders that carry the silhouette.
const boss = {
  texW: 64,
  texH: 64,
  parts: [
    part('head', [0, 32, 0], [box([-5, 32, -5], [10, 10, 10], [0, 0], { uvSize: [8, 8, 8] })]),
    part('body', [0, 16, 0], [box([-9, 16, -4], [18, 16, 8], [0, 16], { uvSize: [9, 8, 4] })]),
    part('rightArm', [-11, 30, 0], [
      box([-15, 12, -4], [8, 18, 8], [26, 16], { uvSize: [4, 9, 4] }),
      box([-16, 26, -5], [10, 6, 10], [0, 30], { uvSize: [5, 3, 5] }),
    ]),
    part('leftArm', [11, 30, 0], [
      box([7, 12, -4], [8, 18, 8], [42, 16], { uvSize: [4, 9, 4] }),
      box([6, 26, -5], [10, 6, 10], [20, 30], { uvSize: [5, 3, 5] }),
    ]),
    part('rightLeg', [-4, 16, 0], [box([-7, 0, -3], [6, 16, 6], [40, 30], { uvSize: [3, 8, 3] })]),
    part('leftLeg', [4, 16, 0], [box([1, 0, -3], [6, 16, 6], [52, 30], { uvSize: [3, 8, 3] })]),
  ],
};

// Dropped items are a half-block bundle that bobs and turns on the spot.
const item = {
  texW: 64,
  texH: 64,
  parts: [part('item', [0, 0, 0], [box([-4, 0, -4], [8, 8, 8], [0, 0])])],
};

export const MODELS = {
  player, zombie, skeleton, creeper, spider, pig, cow, sheep, chicken, villager, item, boss,
};

// ---------------------------------------------------------------- mesh

/**
 * Box UV unwrap, vanilla's layout. For a box at (u,v) sized w*h*d the six faces
 * are laid out as a cross: the horizontal strip right -> front -> left -> back
 * wraps the box, with top and bottom sitting above it.
 */
function faceRects(u, v, w, h, d) {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + d + w + d, v + d, w, h],
  };
}

// A hair off each rect edge: NEAREST sampling on an exact texel boundary is a
// coin flip, and a wrong flip shows up as a stripe of the neighbouring face.
const UV_INSET = 0.01;

function pushVertex(out, x, y, z, u, v, nx, ny, nz, partIndex) {
  out.push(x, y, z, u, v, nx, ny, nz, partIndex);
}

/** Emits two triangles for one quad, corners given CCW as seen from outside. */
function pushQuad(out, c, uv, n, partIndex) {
  const order = [0, 1, 2, 0, 2, 3];
  for (const i of order) {
    pushVertex(out, c[i][0], c[i][1], c[i][2], uv[i][0], uv[i][1], n[0], n[1], n[2], partIndex);
  }
}

function emitBox(out, b, pivot, partIndex, texW, texH) {
  const size = b.size;
  const uvSize = b.uvSize ?? size;
  const inf = (b.inflate ?? 0) / 16;

  const x0 = (b.from[0] - pivot[0]) / 16 - inf;
  const y0 = (b.from[1] - pivot[1]) / 16 - inf;
  const z0 = (b.from[2] - pivot[2]) / 16 - inf;
  const x1 = (b.from[0] + size[0] - pivot[0]) / 16 + inf;
  const y1 = (b.from[1] + size[1] - pivot[1]) / 16 + inf;
  const z1 = (b.from[2] + size[2] - pivot[2]) / 16 + inf;

  const r = faceRects(
    b.uv[0], b.uv[1],
    Math.round(uvSize[0]), Math.round(uvSize[1]), Math.round(uvSize[2]),
  );
  const su = 1 / texW;
  const sv = 1 / texH;
  // (u0,v0) is the top-left of the rect in texture space; v grows downward.
  const rect = (name) => {
    const [rx, ry, rw, rh] = r[name];
    return [
      (rx + UV_INSET) * su, (ry + UV_INSET) * sv,
      (rx + rw - UV_INSET) * su, (ry + rh - UV_INSET) * sv,
    ];
  };

  const F = rect('front');
  pushQuad(out,
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[F[0], F[3]], [F[2], F[3]], [F[2], F[1]], [F[0], F[1]]],
    [0, 0, 1], partIndex);

  const K = rect('back');
  pushQuad(out,
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    [[K[0], K[3]], [K[2], K[3]], [K[2], K[1]], [K[0], K[1]]],
    [0, 0, -1], partIndex);

  const L = rect('left');
  pushQuad(out,
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
    [[L[0], L[3]], [L[2], L[3]], [L[2], L[1]], [L[0], L[1]]],
    [1, 0, 0], partIndex);

  const R = rect('right');
  pushQuad(out,
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[R[0], R[3]], [R[2], R[3]], [R[2], R[1]], [R[0], R[1]]],
    [-1, 0, 0], partIndex);

  const T = rect('top');
  pushQuad(out,
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
    [[T[0], T[3]], [T[2], T[3]], [T[2], T[1]], [T[0], T[1]]],
    [0, 1, 0], partIndex);

  const B = rect('bottom');
  pushQuad(out,
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[B[0], B[3]], [B[2], B[3]], [B[2], B[1]], [B[0], B[1]]],
    [0, -1, 0], partIndex);
}

/** floats per vertex: pos3, uv2, normal3, part1. */
const STRIDE_FLOATS = 9;

let warnedPartCount = false;

/**
 * Flattens a model into one static interleaved VBO. `attribs` carries the
 * shader's attribute locations; the defaults match ENTITY_VS's declaration
 * order and are only a fallback — pass the real ones from `Shader.attrib`.
 */
export function buildModelMesh(gl, model, attribs = { aPos: 0, aUV: 1, aNormal: 2, aPart: 3 }) {
  const verts = [];
  const parts = model.parts;
  if (parts.length > MAX_PARTS && !warnedPartCount) {
    warnedPartCount = true;
    console.warn(`[models] a model has ${parts.length} parts; the entity shader only holds ${MAX_PARTS}`);
  }
  for (let i = 0; i < parts.length && i < MAX_PARTS; i++) {
    for (const b of parts[i].boxes) emitBox(verts, b, parts[i].pivot, i, model.texW, model.texH);
  }

  const data = new Float32Array(verts);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

  const stride = STRIDE_FLOATS * 4;
  const bind = (loc, size, offset) => {
    if (loc === undefined || loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
  };
  bind(attribs.aPos, 3, 0);
  bind(attribs.aUV, 2, 12);
  bind(attribs.aNormal, 3, 20);
  bind(attribs.aPart, 1, 32);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return {
    vao,
    vbo,
    vertexCount: data.length / STRIDE_FLOATS,
    partCount: Math.min(parts.length, MAX_PARTS),
    destroy() {
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
    },
  };
}

// ---------------------------------------------------------------- animation

const IDENTITY = mat4.create();
const TMP = mat4.create();
const GLOBAL = mat4.create();
const PART_MATRICES = new Float32Array(MAX_PARTS * 16);

/** Reused pose slots — one per part, plus a bin for parts a model doesn't have. */
const POSE = [];
for (let i = 0; i < MAX_PARTS; i++) {
  POSE.push({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 });
}
const SINK = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };

const clearPose = (p) => {
  p.x = 0; p.y = 0; p.z = 0;
  p.rx = 0; p.ry = 0; p.rz = 0;
  p.sx = 1; p.sy = 1; p.sz = 1;
};

const INDEX_CACHE = new WeakMap();

function partIndex(model, name) {
  let map = INDEX_CACHE.get(model);
  if (!map) {
    map = new Map();
    for (let i = 0; i < model.parts.length; i++) map.set(model.parts[i].name, i);
    INDEX_CACHE.set(model, map);
  }
  const i = map.get(name);
  return i === undefined ? -1 : i;
}

/** Pose slot for a named part; unknown names get the sink so callers stay simple. */
function P(model, name) {
  const i = partIndex(model, name);
  return i < 0 || i >= MAX_PARTS ? SINK : POSE[i];
}

function resetPoses(model) {
  for (let i = 0; i < MAX_PARTS; i++) clearPose(POSE[i]);
  clearPose(SINK);
  const parts = model.parts;
  for (let i = 0; i < parts.length && i < MAX_PARTS; i++) {
    const d = parts[i].default;
    if (!d) continue;
    POSE[i].rx = d.rx ?? 0;
    POSE[i].ry = d.ry ?? 0;
    POSE[i].rz = d.rz ?? 0;
  }
}

const MOTION = { age: 0, limbSwing: 0, limbSwingAmount: 0, headRx: 0, headRy: 0, airborne: false };

/**
 * Different mob classes carry different fields, so every read is defensive: a
 * bare `{x,y,z}` still animates, it just stands still.
 */
function readMotion(e, pt) {
  const ls = e.limbSwing ?? 0;
  const pls = e.prevLimbSwing ?? ls;
  const la = e.limbSwingAmount ?? 0;
  const pla = e.prevLimbSwingAmount ?? la;
  const bodyYaw = e.bodyYaw ?? e.renderYaw ?? e.yaw ?? 0;
  const headYaw = e.headYaw ?? e.yaw ?? bodyYaw;

  MOTION.age = (e.age ?? 0) + pt;
  MOTION.limbSwing = pls + (ls - pls) * pt;
  MOTION.limbSwingAmount = clamp(pla + (la - pla) * pt, 0, 1);
  // uModel already turns the whole entity by its body yaw, so the head only
  // carries the difference — clamped, or mobs snap their necks.
  MOTION.headRy = -clamp(angleDelta(bodyYaw, headYaw), -1.309, 1.309);
  MOTION.headRx = clamp(e.pitch ?? 0, -1.05, 1.05);
  MOTION.airborne = e.onGround === false;
  return MOTION;
}

function poseHumanoid(model, e, m, o = {}) {
  const head = P(model, 'head');
  head.rx = m.headRx;
  head.ry = m.headRy;

  const body = P(model, 'body');
  body.y = Math.sin(m.age * 0.067) * 0.25;

  const swing = Math.cos(m.limbSwing * 0.6662);
  const counter = Math.cos(m.limbSwing * 0.6662 + Math.PI);
  const legAmp = (o.legAmp ?? 1.4) * m.limbSwingAmount;
  const armAmp = (o.armAmp ?? 1.4) * m.limbSwingAmount;

  const rl = P(model, 'rightLeg');
  const ll = P(model, 'leftLeg');
  rl.rx = swing * legAmp;
  ll.rx = counter * legAmp;

  const ra = P(model, 'rightArm');
  const la = P(model, 'leftArm');
  ra.rx = counter * armAmp;
  la.rx = swing * armAmp;

  // Idle sway, so a mob standing still is never a statue.
  const sway = Math.cos(m.age * 0.09) * 0.05 + 0.05;
  ra.rz = -sway;
  la.rz = sway;
  ra.rx += Math.sin(m.age * 0.067) * 0.05;
  la.rx -= Math.sin(m.age * 0.067) * 0.05;

  if (o.armsOut) {
    const reach = Math.cos(m.age * 0.09) * 0.06;
    ra.rx = -1.5 + reach;
    la.rx = -1.5 - reach;
    ra.rz = -0.06;
    la.rz = 0.06;
    ra.ry = 0.05;
    la.ry = -0.05;
  }

  const swingProgress = clamp(e.swingProgress ?? 0, 0, 1);
  if (swingProgress > 0) {
    const s = Math.sin(Math.sqrt(swingProgress) * Math.PI);
    ra.rx -= s * 1.9;
    ra.ry = -s * 0.35;
    ra.rz -= s * 0.25;
  }

  if (e.sneaking) {
    body.rx += 0.5;
    body.y -= 3.2;
    head.y -= 4.2;
    ra.y -= 3.2;
    la.y -= 3.2;
    ra.rx += 0.4;
    la.rx += 0.4;
    rl.z -= 4;
    ll.z -= 4;
  }
}

function poseQuadruped(model, e, m, o = {}) {
  const head = P(model, 'head');
  head.ry = m.headRy;
  head.rx = m.headRx * 0.5 + (e.headDown ? 0.9 : 0);

  const swing = Math.cos(m.limbSwing * 0.6662);
  const counter = Math.cos(m.limbSwing * 0.6662 + Math.PI);
  const amp = (o.legAmp ?? 1.4) * m.limbSwingAmount;

  P(model, 'frontRightLeg').rx = swing * amp;
  P(model, 'frontLeftLeg').rx = counter * amp;
  P(model, 'backRightLeg').rx = counter * amp;
  P(model, 'backLeftLeg').rx = swing * amp;

  const body = P(model, 'body');
  body.y = Math.abs(Math.sin(m.limbSwing * 0.6662)) * 0.5 * m.limbSwingAmount
    + Math.sin(m.age * 0.05) * 0.15;
}

const ANIMATORS = {
  player(model, e, m) {
    poseHumanoid(model, e, m);
  },

  zombie(model, e, m) {
    poseHumanoid(model, e, m, { armsOut: true });
  },

  skeleton(model, e, m) {
    // Bows are held level, so the arms ride a little higher than a zombie's.
    poseHumanoid(model, e, m, { armAmp: 1.1 });
    if (e.aiming || (e.drawProgress ?? 0) > 0) {
      const draw = clamp(e.drawProgress ?? 1, 0, 1);
      const ra = P(model, 'rightArm');
      const la = P(model, 'leftArm');
      ra.rx = -1.45 + m.headRx;
      la.rx = -1.45 + m.headRx;
      ra.ry = -0.15 - draw * 0.35;
      la.ry = 0.35;
      ra.rz = 0;
      la.rz = 0;
    }
  },

  villager(model, e, m) {
    const head = P(model, 'head');
    head.rx = m.headRx * 0.8;
    head.ry = m.headRy;
    // A slow "hmm" nod is most of a villager's personality.
    head.y = Math.sin(m.age * 0.06) * 0.3;

    const swing = Math.cos(m.limbSwing * 0.6662);
    const amp = 1.4 * m.limbSwingAmount;
    P(model, 'rightLeg').rx = swing * amp;
    P(model, 'leftLeg').rx = Math.cos(m.limbSwing * 0.6662 + Math.PI) * amp;

    const arms = P(model, 'arms');
    arms.rx += Math.sin(m.age * 0.067) * 0.06 - m.limbSwingAmount * 0.15;
    arms.y = Math.sin(m.age * 0.067) * 0.2;
    if (e.talking) arms.rx += Math.sin(m.age * 0.4) * 0.25;
  },

  creeper(model, e, m) {
    const head = P(model, 'head');
    head.rx = m.headRx;
    head.ry = m.headRy;

    const swing = Math.cos(m.limbSwing * 0.6662) * 1.4 * m.limbSwingAmount;
    P(model, 'frontRightLeg').rx = swing;
    P(model, 'frontLeftLeg').rx = -swing;
    P(model, 'backRightLeg').rx = -swing;
    P(model, 'backLeftLeg').rx = swing;

    const fuse = e.fuseTime ?? e.fuse ?? 0;
    if (fuse > 0) {
      const t = clamp(fuse / (e.maxFuse ?? 30), 0, 1);
      // Swell and squash on a rising throb, and rear back before it goes off.
      const throb = Math.sin(fuse * 1.6) * 0.5 + 0.5;
      const grow = t * (0.18 + 0.22 * throb);
      const body = P(model, 'body');
      for (const p of [head, body]) {
        p.sx = 1 + grow;
        p.sz = 1 + grow;
        p.sy = 1 - grow * 0.3;
      }
      body.rx -= t * 0.35;
      head.rx -= t * 0.45;
      head.y += t * 1.5;
    }
  },

  spider(model, e, m) {
    const head = P(model, 'head');
    head.ry = m.headRy;
    head.rx = m.headRx * 0.35;

    const t = m.limbSwing * 0.6662;
    for (let i = 0; i < 8; i++) {
      const leg = P(model, 'leg' + i);
      const side = i < 4 ? 1 : -1;
      const phase = (i % 4) * HALF_PI;
      leg.ry += -Math.cos(t * 2 + phase) * 0.4 * m.limbSwingAmount * side;
      leg.rz += Math.abs(Math.sin(t + phase)) * 0.4 * m.limbSwingAmount * side;
    }
    // A spider settles low and lifts its abdomen when it is agitated.
    P(model, 'abdomen').y = Math.sin(m.age * 0.08) * 0.2 + (e.target ? 0.8 : 0);
  },

  pig(model, e, m) {
    poseQuadruped(model, e, m);
  },

  cow(model, e, m) {
    poseQuadruped(model, e, m, { legAmp: 1.2 });
  },

  sheep(model, e, m) {
    poseQuadruped(model, e, m, { legAmp: 1.3 });
  },

  chicken(model, e, m) {
    const head = P(model, 'head');
    head.rx = m.headRx * 0.4;
    head.ry = m.headRy;
    head.y = Math.sin(m.age * 0.28) * 0.25;

    const swing = Math.cos(m.limbSwing * 0.6662) * 1.4 * m.limbSwingAmount;
    P(model, 'rightLeg').rx = swing;
    P(model, 'leftLeg').rx = -swing;

    // Chickens flap on the way down — that is the whole joke of the mob.
    const flap = clamp(e.flapProgress ?? (m.airborne ? 1 : 0), 0, 1);
    const beat = (Math.sin(m.age * 0.9) * 0.5 + 0.5) * flap;
    P(model, 'rightWing').rz = -beat * 1.1 - flap * 0.1;
    P(model, 'leftWing').rz = beat * 1.1 + flap * 0.1;
  },

  boss(model, e, m) {
    poseHumanoid(model, e, m, { legAmp: 0.9, armAmp: 0.8 });
    const head = P(model, 'head');
    const body = P(model, 'body');
    const ra = P(model, 'rightArm');
    const la = P(model, 'leftArm');

    // Heavy breathing reads as mass even when the warden is standing still.
    const breath = Math.sin(m.age * 0.045);
    body.y += breath * 0.5;
    head.y += breath * 0.5;
    body.rx += breath * 0.02;

    const slam = clamp(e.attackAnim ?? e.slamProgress ?? 0, 0, 1);
    if (slam > 0) {
      // Telegraph: arms overhead through the first half, driven down after.
      const rise = slam < 0.5 ? slam * 2 : 1 - (slam - 0.5) * 2;
      const drop = slam < 0.5 ? 0 : (slam - 0.5) * 2;
      const lift = -2.7 * rise + 1.1 * drop;
      ra.rx = lift;
      la.rx = lift;
      ra.rz = -0.25 * rise;
      la.rz = 0.25 * rise;
      body.rx += 0.25 * drop;
    }
  },

  item(model, e, m) {
    const p = P(model, 'item');
    p.ry = m.age * 0.08;
    p.y = 2 + Math.sin(m.age * 0.12) * 1.2;
  },
};

/** Whole-model transform: the death collapse, applied about the feet. */
function buildGlobal(e, pt) {
  mat4.identity(GLOBAL);
  const deathTime = e.deathTime ?? 0;
  if (deathTime <= 0) return;
  const t = clamp((deathTime + pt - 1) / 20, 0, 1);
  mat4.rotateY(GLOBAL, GLOBAL, t * 1.2);
  mat4.rotateZ(GLOBAL, GLOBAL, Math.sqrt(t) * HALF_PI * 0.94);
  mat4.translate(GLOBAL, GLOBAL, 0, -t * 0.06, 0);
}

function compose(model) {
  const parts = model.parts;
  for (let i = 0; i < MAX_PARTS; i++) {
    const at = i * 16;
    if (i >= parts.length) {
      PART_MATRICES.set(IDENTITY, at);
      continue;
    }
    const p = POSE[i];
    const pv = parts[i].pivot;
    mat4.copy(TMP, GLOBAL);
    mat4.translate(TMP, TMP, (pv[0] + p.x) / 16, (pv[1] + p.y) / 16, (pv[2] + p.z) / 16);
    if (p.rz) mat4.rotateZ(TMP, TMP, p.rz);
    if (p.ry) mat4.rotateY(TMP, TMP, p.ry);
    if (p.rx) mat4.rotateX(TMP, TMP, p.rx);
    if (p.sx !== 1 || p.sy !== 1 || p.sz !== 1) mat4.scale(TMP, TMP, p.sx, p.sy, p.sz);
    PART_MATRICES.set(TMP, at);
  }
}

/**
 * Poses `entity` on `modelName` and returns the 16 part matrices packed back to
 * back, ready for `uniformMatrix4fv(uParts, ...)`. The buffer is reused between
 * calls, so upload it before animating the next entity.
 */
export function animate(modelName, entity, partialTicks = 0) {
  const model = MODELS[modelName] ?? MODELS.player;
  const e = entity ?? {};
  const pt = clamp(partialTicks ?? 0, 0, 1);
  resetPoses(model);
  const m = readMotion(e, pt);
  (ANIMATORS[modelName] ?? ANIMATORS.player)(model, e, m);
  buildGlobal(e, pt);
  compose(model);
  return PART_MATRICES;
}
