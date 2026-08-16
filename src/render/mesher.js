// Chunk meshing. Turns one 16^3 chunk section into the three vertex streams the
// chunk shader consumes (opaque, cutout, translucent), with vanilla-style smooth
// lighting, ambient occlusion, biome tint and a shape for every RenderType.

import {
  B, BLOCKS, RenderType, RENDER_TYPE, TINT_TYPE, Tint,
  IS_OPAQUE, IS_FULL_CUBE, FACE_VERTS, FACE_UVS, FACE_SHADE, FACE_NORMALS,
  AO_OFFSETS, occludes,
} from '../world/blocks.js';
import {
  NeighbourView, sectionIndex, CHUNK_SIZE, CHUNK_HEIGHT, MIN_Y,
  SECTION_HEIGHT, SECTION_COUNT,
} from '../world/chunk.js';
import { blendedTint } from '../world/biomes.js';
import { settings } from '../core/settings.js';
import { hash2f } from '../core/rng.js';
import { atlas } from './atlas.js';

export const VERTEX_STRIDE_U16 = 7;   // x, y, z, u, v, layer, overlay
export const VERTEX_STRIDE_U8 = 8;    // sky, block, shade, flags, tintR, tintG, tintB, pad

// ------------------------------------------------------------------ constants

/** Padded 18^3 block/light cache: one block of margin on every side. */
const DIM = SECTION_HEIGHT + 2;
const DIM3 = DIM * DIM * DIM;
/** `x`, `y`, `z` are section-local and may range from -1 to 16. */
const gi = (x, y, z) => ((y + 1) * DIM + (z + 1)) * DIM + (x + 1);

const NO_OVERLAY = 65535;
/** Classic voxel AO ramp; index is the 0..3 occlusion level. */
const AO_CURVE = [0.5, 0.7, 0.85, 1.0];
const MAX_XZ = CHUNK_SIZE * 32;
const MAX_Y32 = CHUNK_HEIGHT * 32;

const PASS_OPAQUE = 0, PASS_CUTOUT = 1, PASS_TRANSLUCENT = 2;

const SHAPE_NO_CULL = 1;      // never hide a face against its neighbour
const SHAPE_SHADELESS = 2;    // skip FACE_SHADE (plants, torches, fire-lit things)
const SHAPE_FORCE_FLUSH = 4;  // light from the neighbour cell even when inset

/** Bit i of a face mask enables face i. */
const ALL_FACES = 0b111111;

// ------------------------------------------------------------------ flat geometry tables
// The inner loop runs millions of times per world load, so the nested arrays in
// blocks.js are flattened once into typed arrays here.

const NORM = new Int8Array(6 * 3);
const FV = new Uint8Array(6 * 4 * 3);
const AOFF = new Int8Array(6 * 4 * 9);
/** [face*2+0] = u source axis, [face*2+1] = v source axis. */
const UV_AXIS = new Int8Array(12);
/** 1 when that component is `1 - position` rather than `position`. */
const UV_FLIP = new Int8Array(12);

for (let f = 0; f < 6; f++) {
  NORM[f * 3] = FACE_NORMALS[f][0];
  NORM[f * 3 + 1] = FACE_NORMALS[f][1];
  NORM[f * 3 + 2] = FACE_NORMALS[f][2];
  for (let v = 0; v < 4; v++) {
    for (let a = 0; a < 3; a++) FV[(f * 4 + v) * 3 + a] = FACE_VERTS[f][v][a];
    for (let k = 0; k < 3; k++) {
      for (let a = 0; a < 3; a++) AOFF[(f * 4 + v) * 9 + k * 3 + a] = AO_OFFSETS[f][v][k][a];
    }
  }
  // Derive "UV as a function of position" from the winding tables instead of
  // hard-coding it, so a change to FACE_VERTS/FACE_UVS can never silently
  // desynchronise the two. Sub-cube shapes then sample the matching sub-rect of
  // the texture, which is what makes slabs and torches look right.
  const nAxis = NORM[f * 3] !== 0 ? 0 : NORM[f * 3 + 1] !== 0 ? 1 : 2;
  for (let c = 0; c < 2; c++) {
    for (let a = 0; a < 3; a++) {
      if (a === nAxis) continue;
      let direct = true, flipped = true;
      for (let v = 0; v < 4; v++) {
        const p = FACE_VERTS[f][v][a], t = FACE_UVS[f][v][c];
        if (p !== t) direct = false;
        if (p !== 1 - t) flipped = false;
      }
      if (direct || flipped) {
        UV_AXIS[f * 2 + c] = a;
        UV_FLIP[f * 2 + c] = direct ? 0 : 1;
        break;
      }
    }
  }
}

/** Meta 0..3 means facing +X, -X, +Z, -Z everywhere in the game. */
const FACING_NORMAL = [0, 1, 4, 5];
/** Quarter-turns of the top texture for each of those facings (beds). */
const FACING_UV_ROT = [1, 3, 2, 0];
/** Wall-mounted blocks store the attachment face; vertical values are nonsense. */
const wallFace = (m) => {
  const f = m & 7;
  return (f === 2 || f === 3 || f > 5) ? 5 : f;
};

// ------------------------------------------------------------------ texture caches
// `atlas.layerOf` is a Map lookup on a string; doing that per face per block is
// the single most expensive thing the mesher could do. Resolve lazily and keep
// it, rebuilding if the atlas is ever rebuilt underneath us.

const LAYER_CACHE = new Int32Array(256 * 6).fill(-1);
const OVERLAY_CACHE = new Int32Array(256 * 6).fill(NO_OVERLAY);
const TINT_OK = new Uint8Array(256 * 6);
let cacheEpoch = -1;

function refreshCaches() {
  if (cacheEpoch === atlas.layers) return;
  cacheEpoch = atlas.layers;
  LAYER_CACHE.fill(-1);
}

function layerFor(id, f) {
  const key = id * 6 + f;
  let l = LAYER_CACHE[key];
  if (l >= 0) return l;
  const name = BLOCKS[id].faceTex[f];
  l = atlas.layerOf(name);
  LAYER_CACHE[key] = l;
  // Grass block sides keep a neutral dirt base and put the biome colour on a
  // second, alpha-masked layer — that is what the overlay vertex slot is for.
  OVERLAY_CACHE[key] = name === 'grass_block_side'
    ? atlas.layerOf('grass_block_side_overlay')
    : NO_OVERLAY;
  // A tinted block's dirt underside must stay brown.
  TINT_OK[key] = name === 'dirt' ? 0 : 1;
  return l;
}

// ------------------------------------------------------------------ output buffers

class Pass {
  constructor() {
    this.u16 = new Uint16Array(1024 * 4 * VERTEX_STRIDE_U16);
    this.u8 = new Uint8Array(1024 * 4 * VERTEX_STRIDE_U8);
    this.quads = 0;
  }

  reset() { this.quads = 0; }

  /** Grows geometrically; the buffers are kept between calls, never per quad. */
  ensure() {
    if ((this.quads + 1) * 4 * VERTEX_STRIDE_U16 <= this.u16.length) return;
    const cap = (this.u16.length / (4 * VERTEX_STRIDE_U16)) * 2;
    const n16 = new Uint16Array(cap * 4 * VERTEX_STRIDE_U16);
    n16.set(this.u16);
    this.u16 = n16;
    const n8 = new Uint8Array(cap * 4 * VERTEX_STRIDE_U8);
    n8.set(this.u8);
    this.u8 = n8;
  }

  take() {
    return {
      u16: this.u16.slice(0, this.quads * 4 * VERTEX_STRIDE_U16),
      u8: this.u8.slice(0, this.quads * 4 * VERTEX_STRIDE_U8),
      quadCount: this.quads,
    };
  }
}

const PASSES = [new Pass(), new Pass(), new Pass()];

// ------------------------------------------------------------------ scratch state

const scratchBlocks = new Uint16Array(DIM3);
const scratchLight = new Uint8Array(DIM3);
/** 1 when the cell is a full opaque cube — the only thing AO and light care about. */
const scratchSolid = new Uint8Array(DIM3);
/** Per-column biome tint memo, three kinds wide. Reset each section. */
const tintCache = new Int32Array(CHUNK_SIZE * CHUNK_SIZE * 3);

const vSky = new Float32Array(4);
const vBlk = new Float32Array(4);
const vAo = new Float32Array(4);

let curPass = null;
let curWorld = null;
let cur_lx = 0, cur_ly = 0, cur_lz = 0;   // section-local block position
let cur_py = 0;                            // (worldY - MIN_Y), the y the vertex format wants
let cur_wx = 0, cur_wz = 0;                // world x/z, for tint and position hashes
let cur_tintR = 255, cur_tintG = 255, cur_tintB = 255;
let cur_flags = 0;
let cur_smooth = 1;

/** Optional box the UVs are read from when the geometry box is not the right source. */
const UVB = new Float32Array(6);
let uvOn = false;
/** 90-degree UV rotation applied to the top and bottom faces only (beds). */
let uvRotTop = 0;

function setUvBox(x0, y0, z0, x1, y1, z1) {
  UVB[0] = x0; UVB[1] = y0; UVB[2] = z0;
  UVB[3] = x1; UVB[4] = y1; UVB[5] = z1;
  uvOn = true;
}

const clampByte = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
const clampPos = (v, max) => (v <= 0 ? 0 : v >= max ? max : v);

// ------------------------------------------------------------------ tint

function tintFor(kind) {
  if (kind === Tint.REDSTONE) return 0xff5555;   // power level, not a biome colour
  const slot = (((cur_lz & 15) << 4) | (cur_lx & 15)) * 3 + (kind - 1);
  const memo = tintCache[slot];
  if (memo >= 0) return memo;
  const name = kind === Tint.GRASS ? 'grass' : kind === Tint.FOLIAGE ? 'foliage' : 'water';
  const c = blendedTint(curWorld, cur_wx, cur_wz, name) >>> 0;
  tintCache[slot] = c;
  return c;
}

// ------------------------------------------------------------------ face emission

/**
 * Emits one quad of an axis-aligned box, in FACE_VERTS order (counter-clockwise
 * from outside). `flush` says the face sits on the cell boundary, which is what
 * decides whether lighting comes from the neighbouring cell.
 */
function emitFace(f, x0, y0, z0, x1, y1, z1, id, shapeFlags, flush) {
  const P = curPass;
  const useNeighbour = flush || (shapeFlags & SHAPE_FORCE_FLUSH) !== 0;
  const fx = useNeighbour ? cur_lx + NORM[f * 3] : cur_lx;
  const fy = useNeighbour ? cur_ly + NORM[f * 3 + 1] : cur_ly;
  const fz = useNeighbour ? cur_lz + NORM[f * 3 + 2] : cur_lz;
  const gFront = gi(fx, fy, fz);
  const packed = scratchLight[gFront];
  const baseSky = packed >> 4, baseBlk = packed & 15;

  // Only a boundary face has meaningful neighbours to average over; an inset
  // face (a torch shaft, a crop plane) lives inside its own cell.
  const smooth = useNeighbour ? cur_smooth : 0;
  if (smooth <= 0) {
    vSky[0] = vSky[1] = vSky[2] = vSky[3] = baseSky;
    vBlk[0] = vBlk[1] = vBlk[2] = vBlk[3] = baseBlk;
    vAo[0] = vAo[1] = vAo[2] = vAo[3] = 1;
  } else {
    const frontOpen = scratchSolid[gFront] === 0;
    for (let v = 0; v < 4; v++) {
      const o = (f * 4 + v) * 9;
      const g1 = gi(fx + AOFF[o], fy + AOFF[o + 1], fz + AOFF[o + 2]);
      const g2 = gi(fx + AOFF[o + 3], fy + AOFF[o + 4], fz + AOFF[o + 5]);
      const g3 = gi(fx + AOFF[o + 6], fy + AOFF[o + 7], fz + AOFF[o + 8]);
      const s1 = scratchSolid[g1], s2 = scratchSolid[g2], sc = scratchSolid[g3];
      // Two solid edge neighbours bury the corner completely.
      const level = (s1 && s2) ? 0 : 3 - (s1 + s2 + sc);

      let sky = 0, blk = 0, n = 0;
      if (frontOpen) { sky += baseSky; blk += baseBlk; n++; }
      if (!s1) { const l = scratchLight[g1]; sky += l >> 4; blk += l & 15; n++; }
      if (!s2) { const l = scratchLight[g2]; sky += l >> 4; blk += l & 15; n++; }
      if (!sc) { const l = scratchLight[g3]; sky += l >> 4; blk += l & 15; n++; }
      if (n === 0) { sky = baseSky; blk = baseBlk; } else { sky /= n; blk /= n; }

      // "Minimum" smooth lighting blends part-way back to the flat result.
      vSky[v] = baseSky + (sky - baseSky) * smooth;
      vBlk[v] = baseBlk + (blk - baseBlk) * smooth;
      vAo[v] = 1 + (AO_CURVE[level] - 1) * smooth;
    }
  }

  // Splitting the quad along the darker diagonal removes the classic AO seam.
  const flip = (vAo[0] + vAo[2]) > (vAo[1] + vAo[3]) ? 1 : 0;

  const layer = layerFor(id, f);
  const key = id * 6 + f;
  const overlay = OVERLAY_CACHE[key];
  const tinted = TINT_OK[key];
  const tr = tinted ? cur_tintR : 255;
  const tg = tinted ? cur_tintG : 255;
  const tb = tinted ? cur_tintB : 255;
  const shadeBase = (shapeFlags & SHAPE_SHADELESS) ? 1 : FACE_SHADE[f];
  const rot = (f === 2 || f === 3) ? uvRotTop : 0;

  P.ensure();
  const u16 = P.u16, u8 = P.u8;
  let a = P.quads * 4 * VERTEX_STRIDE_U16;
  let b = P.quads * 4 * VERTEX_STRIDE_U8;

  for (let k = 0; k < 4; k++) {
    const v = (k + flip) & 3;
    const o = (f * 4 + v) * 3;
    const gx = FV[o] ? x1 : x0;
    const gy = FV[o + 1] ? y1 : y0;
    const gz = FV[o + 2] ? z1 : z0;
    const tx = uvOn ? (FV[o] ? UVB[3] : UVB[0]) : gx;
    const ty = uvOn ? (FV[o + 1] ? UVB[4] : UVB[1]) : gy;
    const tz = uvOn ? (FV[o + 2] ? UVB[5] : UVB[2]) : gz;

    const ua = UV_AXIS[f * 2], va = UV_AXIS[f * 2 + 1];
    let uu = ua === 0 ? tx : ua === 1 ? ty : tz;
    let vv = va === 0 ? tx : va === 1 ? ty : tz;
    if (UV_FLIP[f * 2]) uu = 1 - uu;
    if (UV_FLIP[f * 2 + 1]) vv = 1 - vv;
    if (rot) {
      for (let r = 0; r < rot; r++) { const t = uu; uu = vv; vv = 1 - t; }
    }

    u16[a] = clampPos(Math.round((cur_lx + gx) * 32), MAX_XZ);
    u16[a + 1] = clampPos(Math.round((cur_py + gy) * 32), MAX_Y32);
    u16[a + 2] = clampPos(Math.round((cur_lz + gz) * 32), MAX_XZ);
    u16[a + 3] = clampPos(Math.round(uu * 256), 65535);
    u16[a + 4] = clampPos(Math.round(vv * 256), 65535);
    u16[a + 5] = layer;
    u16[a + 6] = overlay;
    a += VERTEX_STRIDE_U16;

    u8[b] = clampByte(vSky[v] * 17);
    u8[b + 1] = clampByte(vBlk[v] * 17);
    u8[b + 2] = clampByte(shadeBase * vAo[v] * 255);
    u8[b + 3] = cur_flags;
    u8[b + 4] = tr;
    u8[b + 5] = tg;
    u8[b + 6] = tb;
    u8[b + 7] = 0;
    b += VERTEX_STRIDE_U8;
  }
  P.quads++;
}

/** Emits the masked faces of one axis-aligned box, culling boundary faces. */
function emitBox(id, x0, y0, z0, x1, y1, z1, mask, shapeFlags) {
  for (let f = 0; f < 6; f++) {
    if (!(mask & (1 << f))) continue;
    const nx = NORM[f * 3], ny = NORM[f * 3 + 1], nz = NORM[f * 3 + 2];
    const flush = nx !== 0
      ? (nx > 0 ? x1 >= 1 : x0 <= 0)
      : ny !== 0
        ? (ny > 0 ? y1 >= 1 : y0 <= 0)
        : (nz > 0 ? z1 >= 1 : z0 <= 0);
    if (flush && (shapeFlags & SHAPE_NO_CULL) === 0) {
      const nb = scratchBlocks[gi(cur_lx + nx, cur_ly + ny, cur_lz + nz)];
      if (occludes(nb, id)) continue;
    }
    emitFace(f, x0, y0, z0, x1, y1, z1, id, shapeFlags, flush);
  }
}

/**
 * One diagonal plant quad. Cross geometry is not axis-aligned, so it bypasses
 * the box path and writes its own vertices; light is flat from its own cell,
 * which is how vanilla lights plants.
 */
function emitCrossQuad(layer, overlay, ax, az, bx, bz, y0, y1, reverse) {
  const P = curPass;
  P.ensure();
  const packed = scratchLight[gi(cur_lx, cur_ly, cur_lz)];
  const sky = clampByte((packed >> 4) * 17);
  const blk = clampByte((packed & 15) * 17);
  const u16 = P.u16, u8 = P.u8;
  let a = P.quads * 4 * VERTEX_STRIDE_U16;
  let b = P.quads * 4 * VERTEX_STRIDE_U8;

  for (let k = 0; k < 4; k++) {
    const i = reverse ? 3 - k : k;
    const atA = i === 0 || i === 3;
    const low = i === 0 || i === 1;
    const gx = atA ? ax : bx;
    const gz = atA ? az : bz;
    const gy = low ? y0 : y1;

    // Plants sit at the cell edge, so keep them inside the chunk's u16 range.
    u16[a] = clampPos(Math.round((cur_lx + gx) * 32), MAX_XZ);
    u16[a + 1] = clampPos(Math.round((cur_py + gy) * 32), MAX_Y32);
    u16[a + 2] = clampPos(Math.round((cur_lz + gz) * 32), MAX_XZ);
    u16[a + 3] = atA ? 0 : 256;
    u16[a + 4] = low ? 256 : 0;
    u16[a + 5] = layer;
    u16[a + 6] = overlay;
    a += VERTEX_STRIDE_U16;

    u8[b] = sky;
    u8[b + 1] = blk;
    u8[b + 2] = 255;
    u8[b + 3] = cur_flags;
    u8[b + 4] = cur_tintR;
    u8[b + 5] = cur_tintG;
    u8[b + 6] = cur_tintB;
    u8[b + 7] = 0;
    b += VERTEX_STRIDE_U8;
  }
  P.quads++;
}

// ------------------------------------------------------------------ shapes

function emitCross(id) {
  const layer = layerFor(id, 0);
  const overlay = OVERLAY_CACHE[id * 6];
  // A grid of identical plants reads as wallpaper; nudge each one by position.
  const ox = (hash2f(cur_wx, cur_wz, 0x5eed01) - 0.5) * 0.3;
  const oz = (hash2f(cur_wx, cur_wz, 0x9e3779) - 0.5) * 0.3;
  const x0 = ox, x1 = 1 + ox, z0 = oz, z1 = 1 + oz;
  // Both diagonals, both windings, so plants show from every angle whatever the
  // renderer does with face culling.
  emitCrossQuad(layer, overlay, x0, z0, x1, z1, 0, 1, false);
  emitCrossQuad(layer, overlay, x0, z0, x1, z1, 0, 1, true);
  emitCrossQuad(layer, overlay, x0, z1, x1, z0, 0, 1, false);
  emitCrossQuad(layer, overlay, x0, z1, x1, z0, 0, 1, true);
}

function emitCrop(id) {
  // Four upright planes, inset a quarter block, drawn from both sides.
  const flags = SHAPE_SHADELESS | SHAPE_NO_CULL;
  emitBox(id, 0.25, 0, 0, 0.25, 1, 1, 0b000011, flags);
  emitBox(id, 0.75, 0, 0, 0.75, 1, 1, 0b000011, flags);
  emitBox(id, 0, 0, 0.25, 1, 1, 0.25, 0b110000, flags);
  emitBox(id, 0, 0, 0.75, 1, 1, 0.75, 0b110000, flags);
}

function emitLiquid(id) {
  const above = scratchBlocks[gi(cur_lx, cur_ly + 1, cur_lz)];
  const submerged = above === id;
  const h = submerged ? 1 : 14 / 16;
  const mask = ALL_FACES & ~(1 << 2);
  emitBox(id, 0, 0, 0, 1, h, 1, mask, 0);
  if (!submerged && !occludes(above, id)) {
    // The lowered surface still wants the light and AO of the cell above it.
    emitFace(2, 0, 0, 0, 1, h, 1, id, SHAPE_FORCE_FLUSH, false);
  }
}

function emitTorch(id, meta) {
  const w = 1 / 16;
  if (id === B.WALL_TORCH) {
    const f = wallFace(meta);
    // The support block is behind the face, so the torch hugs the far wall.
    const cx = 0.5 - NORM[f * 3] * (5 / 16);
    const cz = 0.5 - NORM[f * 3 + 2] * (5 / 16);
    // Sample the texture as if it were standing, or the flame lands mid-shaft.
    setUvBox(0.5 - w, 0, 0.5 - w, 0.5 + w, 10 / 16, 0.5 + w);
    emitBox(id, cx - w, 3 / 16, cz - w, cx + w, 13 / 16, cz + w, ALL_FACES, SHAPE_SHADELESS);
    uvOn = false;
    return;
  }
  emitBox(id, 0.5 - w, 0, 0.5 - w, 0.5 + w, 10 / 16, 0.5 + w, ALL_FACES, SHAPE_SHADELESS);
}

function emitStairs(id, meta) {
  const facing = meta & 3;
  const top = (meta & 4) !== 0;
  emitBox(id, 0, top ? 0.5 : 0, 0, 1, top ? 1 : 0.5, 1, ALL_FACES, 0);

  let sx0 = 0, sz0 = 0, sx1 = 1, sz1 = 1;
  if (facing === 0) sx0 = 0.5;
  else if (facing === 1) sx1 = 0.5;
  else if (facing === 2) sz0 = 0.5;
  else sz1 = 0.5;
  // Drop the face that lies flat against the slab, or the two z-fight.
  const stepMask = ALL_FACES & ~(1 << (top ? 2 : 3));
  emitBox(id, sx0, top ? 0 : 0.5, sz0, sx1, top ? 0.5 : 1, sz1, stepMask, 0);
}

function emitDoor(id, meta) {
  const open = (meta & 4) !== 0;
  const facing = meta & 3;
  const t = 3 / 16;
  let x0 = 0, z0 = 0, x1 = 1, z1 = 1;
  if (open) {
    // Matches world.blockCollisionBoxes exactly so the visual and the hitbox agree.
    if (facing === 0 || facing === 1) z1 = t; else x1 = t;
  } else if (facing === 0) x1 = t;
  else if (facing === 1) x0 = 1 - t;
  else if (facing === 2) z1 = t;
  else z0 = 1 - t;
  emitBox(id, x0, 0, z0, x1, 1, z1, ALL_FACES, 0);
}

function emitLadder(id, meta) {
  const f = wallFace(meta);
  const t = 1 / 16;
  const nx = NORM[f * 3], nz = NORM[f * 3 + 2];
  const mask = (1 << f) | (1 << (f ^ 1));
  if (nx !== 0) {
    const x = nx > 0 ? t : 1 - t;
    emitBox(id, x, 0, 0, x, 1, 1, mask, SHAPE_NO_CULL);
  } else {
    const z = nz > 0 ? t : 1 - t;
    emitBox(id, 0, 0, z, 1, 1, z, mask, SHAPE_NO_CULL);
  }
}

const connectsFence = (nb) => RENDER_TYPE[nb] === RenderType.FENCE ||
  (IS_FULL_CUBE[nb] && IS_OPAQUE[nb]) || RENDER_TYPE[nb] === RenderType.DOOR;

function emitFence(id) {
  let postMask = ALL_FACES;
  let links = 0;
  for (let i = 0; i < 4; i++) {
    const f = FACING_NORMAL[i];
    const nb = scratchBlocks[gi(cur_lx + NORM[f * 3], cur_ly, cur_lz + NORM[f * 3 + 2])];
    if (!connectsFence(nb)) continue;
    links |= 1 << f;
    postMask &= ~(1 << f);   // the arm seals this side of the post
  }
  emitBox(id, 6 / 16, 0, 6 / 16, 10 / 16, 1, 10 / 16, postMask, 0);

  for (let i = 0; i < 4; i++) {
    const f = FACING_NORMAL[i];
    if (!(links & (1 << f))) continue;
    const armMask = ALL_FACES & ~(1 << (f ^ 1));
    const nx = NORM[f * 3], nz = NORM[f * 3 + 2];
    const x0 = nx > 0 ? 10 / 16 : nx < 0 ? 0 : 7 / 16;
    const x1 = nx > 0 ? 1 : nx < 0 ? 6 / 16 : 9 / 16;
    const z0 = nz > 0 ? 10 / 16 : nz < 0 ? 0 : 7 / 16;
    const z1 = nz > 0 ? 1 : nz < 0 ? 6 / 16 : 9 / 16;
    emitBox(id, x0, 6 / 16, z0, x1, 9 / 16, z1, armMask, 0);
    emitBox(id, x0, 12 / 16, z0, x1, 15 / 16, z1, armMask, 0);
  }
}

const connectsPane = (nb) => RENDER_TYPE[nb] === RenderType.PANE ||
  (IS_FULL_CUBE[nb] && IS_OPAQUE[nb]);

function emitPane(id) {
  let postMask = ALL_FACES;
  let links = 0;
  for (let i = 0; i < 4; i++) {
    const f = FACING_NORMAL[i];
    const nb = scratchBlocks[gi(cur_lx + NORM[f * 3], cur_ly, cur_lz + NORM[f * 3 + 2])];
    if (!connectsPane(nb)) continue;
    links |= 1 << f;
    postMask &= ~(1 << f);
  }
  emitBox(id, 7 / 16, 0, 7 / 16, 9 / 16, 1, 9 / 16, postMask, 0);

  for (let i = 0; i < 4; i++) {
    const f = FACING_NORMAL[i];
    if (!(links & (1 << f))) continue;
    const armMask = ALL_FACES & ~(1 << (f ^ 1));
    const nx = NORM[f * 3], nz = NORM[f * 3 + 2];
    const x0 = nx > 0 ? 9 / 16 : nx < 0 ? 0 : 7 / 16;
    const x1 = nx > 0 ? 1 : nx < 0 ? 7 / 16 : 9 / 16;
    const z0 = nz > 0 ? 9 / 16 : nz < 0 ? 0 : 7 / 16;
    const z1 = nz > 0 ? 1 : nz < 0 ? 7 / 16 : 9 / 16;
    emitBox(id, x0, 0, z0, x1, 1, z1, armMask, 0);
  }
}

// ------------------------------------------------------------------ entry point

/**
 * Builds the vertex data for one section.
 * @returns {{opaque:object, cutout:object, translucent:object, empty:boolean}|null}
 *   `null` when the section holds nothing at all.
 */
export function meshSection(world, chunk, si) {
  if (!world || !chunk || si < 0 || si >= SECTION_COUNT) return null;
  const sec = chunk.sections?.[si];
  if (!sec || sec.nonAir === 0) return null;

  refreshCaches();
  curWorld = world;
  tintCache.fill(-1);
  const smoothOpt = settings?.get('smoothLighting');
  cur_smooth = typeof smoothOpt === 'number' ? smoothOpt : 1;
  for (let i = 0; i < 3; i++) PASSES[i].reset();

  // --- fill the padded neighbourhood cache -------------------------------
  const blocks = sec.blocks, light = sec.light;
  for (let y = 0; y < SECTION_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const src = (y << 8) | (z << 4);
      const dst = gi(0, y, z);
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = blocks[src + x];
        scratchBlocks[dst + x] = id;
        scratchLight[dst + x] = light[src + x];
        scratchSolid[dst + x] = (IS_OPAQUE[id] && IS_FULL_CUBE[id]) ? 1 : 0;
      }
    }
  }

  const view = new NeighbourView(world, chunk.cx, chunk.cz);
  const baseY = MIN_Y + si * SECTION_HEIGHT;
  for (let y = -1; y <= SECTION_HEIGHT; y++) {
    const inY = y >= 0 && y < SECTION_HEIGHT;
    for (let z = -1; z <= CHUNK_SIZE; z++) {
      const inZ = z >= 0 && z < CHUNK_SIZE;
      for (let x = -1; x <= CHUNK_SIZE; x++) {
        if (inY && inZ && x >= 0 && x < CHUNK_SIZE) continue;   // already copied
        const g = gi(x, y, z);
        const id = view.block(x, baseY + y, z);
        scratchBlocks[g] = id;
        scratchLight[g] = view.light(x, baseY + y, z);
        scratchSolid[g] = (IS_OPAQUE[id] && IS_FULL_CUBE[id]) ? 1 : 0;
      }
    }
  }

  // --- walk the section --------------------------------------------------
  for (let ly = 0; ly < SECTION_HEIGHT; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const id = scratchBlocks[gi(lx, ly, lz)];
        if (id === B.AIR) continue;
        const rt = RENDER_TYPE[id];
        if (rt === RenderType.AIR) continue;

        cur_lx = lx; cur_ly = ly; cur_lz = lz;
        cur_py = si * SECTION_HEIGHT + ly;
        cur_wx = chunk.x0 + lx;
        cur_wz = chunk.z0 + lz;
        cur_flags = 0;
        uvOn = false;
        uvRotTop = 0;

        const kind = TINT_TYPE[id];
        if (kind) {
          const c = tintFor(kind);
          cur_tintR = (c >> 16) & 255;
          cur_tintG = (c >> 8) & 255;
          cur_tintB = c & 255;
        } else {
          cur_tintR = cur_tintG = cur_tintB = 255;
        }

        curPass = PASSES[
          (id === B.WATER || id === B.ICE) ? PASS_TRANSLUCENT
            : (IS_OPAQUE[id] && IS_FULL_CUBE[id]) ? PASS_OPAQUE
              : PASS_CUTOUT
        ];

        const meta = sec.meta[sectionIndex(lx, ly, lz)];

        switch (rt) {
          case RenderType.CROSS:
            emitCross(id);
            break;
          case RenderType.CROP:
            emitCrop(id);
            break;
          case RenderType.LIQUID:
            cur_flags = id === B.LAVA ? 2 : 1;
            emitLiquid(id);
            break;
          case RenderType.TORCH:
            emitTorch(id, meta);
            break;
          case RenderType.SLAB: {
            const top = (meta & 1) === 1;
            emitBox(id, 0, top ? 0.5 : 0, 0, 1, top ? 1 : 0.5, 1, ALL_FACES, 0);
            break;
          }
          case RenderType.STAIRS:
            emitStairs(id, meta);
            break;
          case RenderType.PANE:
            emitPane(id);
            break;
          case RenderType.DOOR:
            emitDoor(id, meta);
            break;
          case RenderType.FENCE:
            emitFence(id);
            break;
          case RenderType.LADDER:
            emitLadder(id, meta);
            break;
          case RenderType.CARPET:
            emitBox(id, 0, 0, 0, 1, 1 / 16, 1, ALL_FACES, 0);
            break;
          case RenderType.SNOW_LAYER:
            emitBox(id, 0, 0, 0, 1, ((meta & 7) + 1) / 8, 1, ALL_FACES, 0);
            break;
          case RenderType.BED:
            // Turn the top texture so the pillow points the way the bed faces.
            uvRotTop = FACING_UV_ROT[meta & 3];
            emitBox(id, 0, 0, 0, 1, 9 / 16, 1, ALL_FACES, 0);
            uvRotTop = 0;
            break;
          default:
            // A couple of "cube" blocks are visibly inset; keep the mesh and the
            // collision box in world.js telling the same story.
            if (id === B.CHEST) emitBox(id, 1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16, ALL_FACES, 0);
            else if (id === B.CACTUS) emitBox(id, 1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16, ALL_FACES, 0);
            else emitBox(id, 0, 0, 0, 1, 1, 1, ALL_FACES, 0);
            break;
        }
      }
    }
  }

  curPass = null;
  curWorld = null;
  const opaque = PASSES[PASS_OPAQUE].take();
  const cutout = PASSES[PASS_CUTOUT].take();
  const translucent = PASSES[PASS_TRANSLUCENT].take();
  return {
    opaque,
    cutout,
    translucent,
    empty: opaque.quadCount + cutout.quadCount + translucent.quadCount === 0,
  };
}
