// Deterministic RNG + hashing. Everything world-related must go through a seeded
// stream so a given seed always regenerates the same world.

/** mulberry32 — small, fast, good enough distribution for gameplay. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash (xxhash-ish finalizer). Returns a uint32. */
export function hash32(x) {
  x = x >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash 2 ints + seed into a uint32. */
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  return hash32(h);
}

/** Hash 3 ints + seed into a uint32. */
export function hash3(x, y, z, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^
          Math.imul(z | 0, 0x85ebca6b) ^ Math.imul(seed | 0, 0x9e3779b1);
  return hash32(h);
}

/** Deterministic float in [0,1) from a 2D coordinate. */
export const hash2f = (x, y, seed = 0) => hash2(x, y, seed) / 4294967296;
/** Deterministic float in [0,1) from a 3D coordinate. */
export const hash3f = (x, y, z, seed = 0) => hash3(x, y, z, seed) / 4294967296;

/**
 * A seeded random stream with the conveniences the game actually needs.
 * Derive sub-streams with `fork` so adding a new consumer never shifts
 * the numbers an existing one sees.
 */
export class Random {
  constructor(seed = 0) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }
  static fromString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return new Random(h >>> 0);
  }
  fork(salt) {
    const s = typeof salt === 'string'
      ? Random.fromString(salt).seed
      : (salt >>> 0);
    return new Random(hash32(this.seed ^ Math.imul(s, 0x9e3779b1)));
  }
  next() { return this._next(); }
  float(min = 0, max = 1) { return min + this._next() * (max - min); }
  /** Integer in [min, max] inclusive. */
  int(min, max) { return min + Math.floor(this._next() * (max - min + 1)); }
  /** Integer in [0, n). */
  below(n) { return Math.floor(this._next() * n); }
  bool(p = 0.5) { return this._next() < p; }
  pick(arr) { return arr[Math.floor(this._next() * arr.length)]; }
  /** Fisher-Yates, in place. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  /** Approximately gaussian via the sum of 3 uniforms. */
  gaussian(mean = 0, sd = 1) {
    const u = this._next() + this._next() + this._next() - 1.5;
    return mean + u * 1.1547 * sd;
  }
  /** Picks an index from an array of weights. */
  weighted(weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = this._next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }
}

/** Global, unseeded stream for cosmetic-only randomness (particles, sound pitch). */
export const fx = new Random((Math.random() * 0xffffffff) >>> 0);
