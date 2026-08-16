// Gradient + value noise used by world generation. All noise is seeded and
// stateless per-call so chunks can be generated in any order and still match.

import { hash2, hash3 } from './rng.js';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

// 12 gradient directions on the edges of a cube (classic Perlin set).
const GRAD3 = new Int8Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

function grad2(hash, x, y) {
  const h = (hash & 7) * 3;
  return GRAD3[h] * x + GRAD3[h + 1] * y;
}

function grad3(hash, x, y, z) {
  const h = (hash % 12) * 3;
  return GRAD3[h] * x + GRAD3[h + 1] * y + GRAD3[h + 2] * z;
}

/** 2D simplex noise in roughly [-1, 1]. */
export function simplex2(x, y, seed = 0) {
  const s = (x + y) * F2;
  const i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);

  let i1, j1;
  if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }

  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;

  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { t0 *= t0; n += t0 * t0 * grad2(hash2(i, j, seed), x0, y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { t1 *= t1; n += t1 * t1 * grad2(hash2(i + i1, j + j1, seed), x1, y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { t2 *= t2; n += t2 * t2 * grad2(hash2(i + 1, j + 1, seed), x2, y2); }

  return 70 * n;
}

/** 3D simplex noise in roughly [-1, 1]. Used for caves and 3D density. */
export function simplex3(x, y, z, seed = 0) {
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);

  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0)      { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else               { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0)       { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0)  { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else               { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }

  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;

  let n = 0;
  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 > 0) { t0 *= t0; n += t0 * t0 * grad3(hash3(i, j, k, seed), x0, y0, z0); }
  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 > 0) { t1 *= t1; n += t1 * t1 * grad3(hash3(i + i1, j + j1, k + k1, seed), x1, y1, z1); }
  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 > 0) { t2 *= t2; n += t2 * t2 * grad3(hash3(i + i2, j + j2, k + k2, seed), x2, y2, z2); }
  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 > 0) { t3 *= t3; n += t3 * t3 * grad3(hash3(i + 1, j + 1, k + 1, seed), x3, y3, z3); }

  return 32 * n;
}

/** Fractal Brownian motion over simplex2. Returns roughly [-1, 1]. */
export function fbm2(x, y, seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += simplex2(x * freq, y * freq, seed + o * 8191) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Fractal Brownian motion over simplex3. */
export function fbm3(x, y, z, seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += simplex3(x * freq, y * freq, z * freq, seed + o * 8191) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal — produces mountain ridges and spaghetti-cave tubes. */
export function ridged2(x, y, seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(simplex2(x * freq, y * freq, seed + o * 7919));
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Billowy noise — rounded hills / cloud puffs. */
export function billow2(x, y, seed, octaves = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += Math.abs(simplex2(x * freq, y * freq, seed + o * 6151)) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return (sum / norm) * 2 - 1;
}

/**
 * Voronoi / cellular noise. Returns { dist, cellX, cellY, id } where dist is
 * the distance to the nearest feature point. Used for biome regions.
 */
const _cell = { dist: 0, cellX: 0, cellY: 0, id: 0 };
export function voronoi2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let best = Infinity, bx = 0, by = 0, bid = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const h = hash2(cx, cy, seed);
      const px = cx + (h & 0xffff) / 65536;
      const py = cy + ((h >>> 16) & 0xffff) / 65536;
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < best) { best = d; bx = cx; by = cy; bid = h; }
    }
  }
  _cell.dist = Math.sqrt(best);
  _cell.cellX = bx;
  _cell.cellY = by;
  _cell.id = bid;
  return _cell;
}

/**
 * A cached 2D noise sampler. World gen samples the same columns repeatedly
 * (terrain height, then decoration, then structures) so memoising pays off.
 */
export class NoiseCache {
  constructor(fn, capacity = 1 << 16) {
    this.fn = fn;
    this.capacity = capacity;
    this.map = new Map();
  }
  get(x, z) {
    const key = (x & 0x7fffffff) * 46341 + (z & 0x7fffffff);
    let v = this.map.get(key);
    if (v === undefined) {
      v = this.fn(x, z);
      if (this.map.size >= this.capacity) this.map.clear();
      this.map.set(key, v);
    }
    return v;
  }
  clear() { this.map.clear(); }
}
