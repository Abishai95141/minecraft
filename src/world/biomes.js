// The biome table: climate-driven biome selection, the per-biome terrain
// profile that worldgen blends into its heightmap, and the tint colours the
// mesher multiplies into grass, leaves and water.

import { simplex2, fbm2, NoiseCache } from '../core/noise.js';
import { hash2f } from '../core/rng.js';
import { B } from './blocks.js';

export const Biome = {
  PLAINS: 0, FOREST: 1, BIRCH_FOREST: 2, DESERT: 3, SAVANNA: 4,
  TAIGA: 5, SNOWY_PLAINS: 6, SWAMP: 7, BEACH: 8, OCEAN: 9,
  RIVER: 10, STONY_PEAKS: 11, WITHERED: 12,
};

// Shared mob rosters. Names must match the registry in entity/mobs.js.
const FARM = ['pig', 'cow', 'sheep', 'chicken'];
const NIGHT = ['zombie', 'skeleton', 'creeper', 'spider'];

const DEFAULTS = {
  grassTint: 0x91BD59, foliageTint: 0x77AB2F, waterTint: 0x3F76E4, skyTint: 0x78A7FF,
  surface: B.GRASS_BLOCK, filler: B.DIRT, underwater: B.DIRT,
  treeDensity: 0, treeTypes: null, grassDensity: 0, flowerDensity: 0,
  temperature: 0.8, downfall: 0.4,
  minY: 62, maxY: 96, heightScale: 4, heightOffset: 68,
  mobs: null,
};

/** @type {Array<object>} indexed by biome id. */
export const BIOMES = [];

function bio(id, name, display, o) {
  BIOMES[id] = Object.assign({ id, name, display }, DEFAULTS, o);
}

bio(Biome.PLAINS, 'plains', 'Plains', {
  grassTint: 0x91BD59, foliageTint: 0x77AB2F, skyTint: 0x78A7FF,
  treeDensity: 0.035, treeTypes: [{ type: 'oak', weight: 9 }, { type: 'birch', weight: 1 }],
  grassDensity: 0.24, flowerDensity: 0.035,
  temperature: 0.8, downfall: 0.4,
  minY: 62, maxY: 78, heightOffset: 68, heightScale: 3.2,
  mobs: { passive: FARM, hostile: NIGHT },
});

bio(Biome.FOREST, 'forest', 'Forest', {
  grassTint: 0x79C05A, foliageTint: 0x59AE30, skyTint: 0x79A6FF,
  treeDensity: 0.66, treeTypes: [{ type: 'oak', weight: 8 }, { type: 'birch', weight: 2 }],
  grassDensity: 0.34, flowerDensity: 0.05,
  temperature: 0.7, downfall: 0.8,
  minY: 62, maxY: 92, heightOffset: 73, heightScale: 7,
  mobs: { passive: FARM, hostile: NIGHT },
});

bio(Biome.BIRCH_FOREST, 'birch_forest', 'Birch Forest', {
  grassTint: 0x88BB67, foliageTint: 0x80A755, skyTint: 0x7BA9FF,
  treeDensity: 0.58, treeTypes: [{ type: 'birch', weight: 9 }, { type: 'oak', weight: 1 }],
  grassDensity: 0.3, flowerDensity: 0.06,
  temperature: 0.6, downfall: 0.6,
  minY: 62, maxY: 90, heightOffset: 71, heightScale: 5,
  mobs: { passive: FARM, hostile: NIGHT },
});

bio(Biome.DESERT, 'desert', 'Desert', {
  grassTint: 0xBFB755, foliageTint: 0xAEA42A, skyTint: 0x8CB4FF,
  surface: B.SAND, filler: B.SAND, underwater: B.SAND,
  treeDensity: 0, treeTypes: [],
  grassDensity: 0, flowerDensity: 0,
  temperature: 2, downfall: 0,
  minY: 62, maxY: 84, heightOffset: 68, heightScale: 5.5,
  mobs: { passive: [], hostile: NIGHT },
});

bio(Biome.SAVANNA, 'savanna', 'Savanna', {
  grassTint: 0xBFB755, foliageTint: 0xAEA42A, skyTint: 0x82ADFF,
  treeDensity: 0.07, treeTypes: [{ type: 'oak', weight: 1 }],
  grassDensity: 0.42, flowerDensity: 0.008,
  temperature: 1.2, downfall: 0,
  minY: 62, maxY: 90, heightOffset: 72, heightScale: 7,
  mobs: { passive: FARM, hostile: NIGHT },
});

bio(Biome.TAIGA, 'taiga', 'Taiga', {
  grassTint: 0x86B783, foliageTint: 0x68A464, skyTint: 0x84B0FF,
  treeDensity: 0.52, treeTypes: [{ type: 'spruce', weight: 1 }],
  grassDensity: 0.2, flowerDensity: 0.02,
  temperature: 0.25, downfall: 0.8,
  minY: 62, maxY: 100, heightOffset: 76, heightScale: 8,
  mobs: { passive: ['sheep', 'chicken', 'pig'], hostile: NIGHT },
});

bio(Biome.SNOWY_PLAINS, 'snowy_plains', 'Snowy Plains', {
  grassTint: 0x80B497, foliageTint: 0x60A17B, waterTint: 0x3D57D6, skyTint: 0x94BAFF,
  treeDensity: 0.06, treeTypes: [{ type: 'spruce', weight: 1 }],
  grassDensity: 0.05, flowerDensity: 0,
  temperature: -0.5, downfall: 0.5,
  minY: 62, maxY: 84, heightOffset: 69, heightScale: 4,
  mobs: { passive: ['sheep', 'chicken'], hostile: NIGHT },
});

bio(Biome.SWAMP, 'swamp', 'Swamp', {
  grassTint: 0x6A7039, foliageTint: 0x6A7039, waterTint: 0x617B64, skyTint: 0x76A0E8,
  treeDensity: 0.17, treeTypes: [{ type: 'oak', weight: 1 }],
  grassDensity: 0.3, flowerDensity: 0.03,
  temperature: 0.8, downfall: 0.9,
  minY: 58, maxY: 68, heightOffset: 62.6, heightScale: 1.8,
  mobs: { passive: ['chicken', 'pig'], hostile: NIGHT },
});

bio(Biome.BEACH, 'beach', 'Beach', {
  grassTint: 0x91BD59, foliageTint: 0x77AB2F, skyTint: 0x78A7FF,
  surface: B.SAND, filler: B.SAND, underwater: B.SAND,
  treeDensity: 0, treeTypes: [],
  grassDensity: 0, flowerDensity: 0,
  temperature: 0.8, downfall: 0.4,
  minY: 59, maxY: 66, heightOffset: 64, heightScale: 1.2,
  mobs: { passive: [], hostile: NIGHT },
});

bio(Biome.OCEAN, 'ocean', 'Ocean', {
  grassTint: 0x8EB971, foliageTint: 0x71A74D, skyTint: 0x78A7FF,
  surface: B.GRAVEL, filler: B.DIRT, underwater: B.GRAVEL,
  treeDensity: 0, treeTypes: [],
  grassDensity: 0, flowerDensity: 0,
  temperature: 0.5, downfall: 0.5,
  minY: 30, maxY: 62, heightOffset: 46, heightScale: 4.5,
  mobs: { passive: [], hostile: [] },
});

bio(Biome.RIVER, 'river', 'River', {
  grassTint: 0x8EB971, foliageTint: 0x71A74D, skyTint: 0x78A7FF,
  surface: B.SAND, filler: B.SAND, underwater: B.SAND,
  treeDensity: 0, treeTypes: [],
  grassDensity: 0, flowerDensity: 0,
  temperature: 0.5, downfall: 0.5,
  minY: 50, maxY: 62, heightOffset: 57, heightScale: 1.2,
  mobs: { passive: [], hostile: [] },
});

bio(Biome.STONY_PEAKS, 'stony_peaks', 'Stony Peaks', {
  grassTint: 0x8AB689, foliageTint: 0x6DA36B, skyTint: 0x9CC4FF,
  surface: B.STONE, filler: B.STONE, underwater: B.GRAVEL,
  treeDensity: 0.012, treeTypes: [{ type: 'spruce', weight: 1 }],
  grassDensity: 0.02, flowerDensity: 0,
  temperature: -0.3, downfall: 0.3,
  minY: 70, maxY: 125, heightOffset: 92, heightScale: 14,
  mobs: { passive: ['sheep'], hostile: NIGHT },
});

bio(Biome.WITHERED, 'withered', 'Withered Land', {
  grassTint: 0x6B6656, foliageTint: 0x5A5443, waterTint: 0x51604F, skyTint: 0x6E6A72,
  surface: B.WITHERED_GRASS, filler: B.COARSE_DIRT, underwater: B.COARSE_DIRT,
  treeDensity: 0.03, treeTypes: [{ type: 'oak', weight: 1 }],
  grassDensity: 0.06, flowerDensity: 0,
  temperature: 0.4, downfall: 0.1,
  minY: 60, maxY: 84, heightOffset: 68, heightScale: 4,
  mobs: { passive: [], hostile: ['withered_husk', 'zombie', 'skeleton'] },
});

// ------------------------------------------------------------------ selection

/**
 * The climate lookup. Ocean and river come from the large-scale fields so that
 * coastlines and waterways stay coherent; everything else falls out of a
 * temperature / humidity / erosion table. Worldgen refines this with beaches
 * once it knows the column's actual height.
 */
/**
 * Gradient noise is exactly zero at a lattice point, so every field sampled at
 * the world origin returns 0 — which lands inside the river band on every seed
 * and drops the player into water at spawn. Shifting the whole domain by a
 * seed-derived, deliberately non-integer amount removes that degeneracy and
 * decorrelates the fields from one another as a bonus.
 */
const _offsets = new Map();
function domainOffset(seed) {
  let o = _offsets.get(seed);
  if (!o) {
    if (_offsets.size >= 8) _offsets.clear();
    o = [1543.137 + hash2f(seed, 0x5eed) * 8192, 2081.719 + hash2f(0x5eed, seed) * 8192];
    _offsets.set(seed, o);
  }
  return o;
}

function classify(rawX, rawZ, seed) {
  const off = domainOffset(seed);
  const x = rawX + off[0];
  const z = rawZ + off[1];

  // A domain warp keeps borders ragged instead of perfectly smooth blobs.
  const w = simplex2(x * 0.0055, z * 0.0055, seed + 9013) * 24;
  const v = simplex2(x * 0.0055, z * 0.0055, seed + 4271) * 24;
  const wx = x + w, wz = z + v;

  // Every threshold below is a measured percentile of its own field, chosen to
  // land on a vanilla-ish mix: ~22% ocean, plains the largest land biome,
  // forest close behind, and peaks rare enough to be an event.
  const cont = fbm2(wx * 0.00072, wz * 0.00072, seed + 8101, 3);
  if (cont < -0.255) return Biome.OCEAN;

  // Rivers are the narrow band around the zero contour of a low-frequency field,
  // which naturally winds across every other biome.
  const river = fbm2(wx * 0.00098, wz * 0.00098, seed + 6199, 2);
  if (river > -0.011 && river < 0.011) return Biome.RIVER;

  const erosion = fbm2(wx * 0.0017, wz * 0.0017, seed + 3319, 2);
  if (cont > 0.48 && erosion > 0) return Biome.STONY_PEAKS;

  const temp = fbm2(wx * 0.00105, wz * 0.00105, seed + 4327, 2);
  const humid = fbm2(wx * 0.00135, wz * 0.00135, seed + 5501, 2);

  if (temp < -0.28) return humid > -0.25 ? Biome.TAIGA : Biome.SNOWY_PLAINS;
  if (temp > 0.37) return humid < 0.05 ? Biome.DESERT : Biome.SAVANNA;
  if (humid > 0.38 && erosion < -0.08) return Biome.SWAMP;
  if (humid > 0.05) return temp < -0.05 ? Biome.BIRCH_FOREST : Biome.FOREST;
  return Biome.PLAINS;
}

// Worldgen samples the same columns from several passes, so the classifier is
// memoised per seed. A handful of live seeds at most (world + menu panorama).
const _caches = new Map();

function cacheFor(seed) {
  let c = _caches.get(seed);
  if (!c) {
    if (_caches.size >= 4) _caches.clear();
    c = new NoiseCache((x, z) => classify(x, z, seed), 1 << 16);
    _caches.set(seed, c);
  }
  return c;
}

/** Climate biome id at a world column. Continuous in x/z and cached. */
export function biomeAt(x, z, seed = 0) {
  return cacheFor(seed >>> 0).get(Math.floor(x), Math.floor(z));
}

// ------------------------------------------------------------------ tints

/** @param {'grass'|'foliage'|'water'|'sky'} kind */
export function biomeTint(biomeId, kind) {
  const b = BIOMES[biomeId] || BIOMES[Biome.PLAINS];
  if (kind === 'foliage') return b.foliageTint;
  if (kind === 'water') return b.waterTint;
  if (kind === 'sky') return b.skyTint;
  return b.grassTint;
}

const KINDS = ['grass', 'foliage', 'water', 'sky'];
// One tint memo per world; dropped with the world because biome ids never
// change after generation, so an entry can never go stale while it is alive.
const _tintCaches = new WeakMap();

function tintMaps(world) {
  let maps = _tintCaches.get(world);
  if (!maps) {
    maps = [new Map(), new Map(), new Map(), new Map()];
    _tintCaches.set(world, maps);
  }
  return maps;
}

/**
 * The 3x3 column average the mesher uses, so grass and leaves fade across a
 * biome border instead of changing colour on a straight line.
 */
export function blendedTint(world, x, z, kind) {
  if (!world || !world.getBiome) return biomeTint(Biome.PLAINS, kind);
  let ki = KINDS.indexOf(kind);
  if (ki < 0) ki = 0;

  const map = tintMaps(world)[ki];
  const key = (x & 0x7fffffff) * 46341 + (z & 0x7fffffff);
  const hit = map.get(key);
  if (hit !== undefined) return hit;

  let r = 0, g = 0, b = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = biomeTint(world.getBiome(x + dx, z + dz), kind);
      r += (c >> 16) & 255;
      g += (c >> 8) & 255;
      b += c & 255;
    }
  }
  const out = (((r / 9) | 0) << 16) | (((g / 9) | 0) << 8) | ((b / 9) | 0);
  if (map.size >= 1 << 16) map.clear();
  map.set(key, out);
  return out;
}
