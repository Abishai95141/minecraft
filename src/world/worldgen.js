// World generation: a climate-blended heightmap, surface layers, caves,
// ravines, ore veins and per-biome decoration. Everything is a pure function of
// the seed and world coordinates, so a chunk regenerates identically forever.

import { WORLD } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { Random, hash2, hash3, hash3f } from '../core/rng.js';
import { fbm2, fbm3, simplex3, ridged2, NoiseCache } from '../core/noise.js';
import { B } from './blocks.js';
import { CHUNK_SIZE, MIN_Y, MAX_Y, columnIndex } from './chunk.js';
import { Biome, BIOMES, biomeAt as climateBiomeAt } from './biomes.js';

const SEA = WORLD.SEA_LEVEL;              // 62
const MAX_TERRAIN = MAX_Y - 8;            // leave headroom for trees and snow
const BEDROCK_TOP = MIN_Y + 4;
const DEEPSLATE_TOP = -8;                 // stone becomes deepslate below this
const LAVA_LEVEL = -50;                   // carved space this deep floods with lava
const SHORE = 7;                          // half-width of the sea-level flattening

// Terrain profile blend kernel: [dx, dz, weight] triples summing to BLEND_W.
// A radius of ~9 blocks is wide enough that an ocean/land border becomes a
// slope rather than a wall, and narrow enough to keep ridgelines sharp.
const BLEND = [
  0, 0, 4,
  9, 0, 2, -9, 0, 2, 0, 9, 2, 0, -9, 2,
  7, 7, 1, -7, 7, 1, 7, -7, 1, -7, -7, 1,
];
const BLEND_W = 16;

// Biomes that turn into a beach when their column sits at the waterline.
const BEACHABLE = new Uint8Array(BIOMES.length);
BEACHABLE[Biome.PLAINS] = 1;
BEACHABLE[Biome.FOREST] = 1;
BEACHABLE[Biome.BIRCH_FOREST] = 1;
BEACHABLE[Biome.SAVANNA] = 1;
BEACHABLE[Biome.TAIGA] = 1;

// --- caves -------------------------------------------------------------
// The 3D fields are evaluated on a 4x4x4 lattice and trilinearly interpolated,
// the same trick Minecraft uses; sampling per voxel would cost 30x as much.
const CAVE_MIN_Y = MIN_Y + 5;
const CAVE_TOP_MAX = 96;
const CAVE_Y_STRIDE = 4;
const CAVE_LEVELS = (((CAVE_TOP_MAX - CAVE_MIN_Y) / CAVE_Y_STRIDE) | 0) + 2;
const LAT_N = CHUNK_SIZE / 4 + 1;         // 5 lattice columns across a chunk
const LAT_PLANE = LAT_N * LAT_N;
const TUBE_T = 0.082;                     // half-width of a spaghetti tunnel
const CHEESE_T = 0.56;                    // threshold for open chambers

const RAVINE_CELL = 128;

// --- ores --------------------------------------------------------------
// `tries` veins per chunk, each centred on a triangular distribution around
// `peak` and rejected outside [min, max], which is what gives each ore its
// characteristic depth curve.
const ORES = [
  { id: B.COAL_ORE, deep: B.DEEPSLATE_COAL_ORE, tries: 20, min: 0, max: 120, peak: 45, spread: 48, lo: 8, hi: 17 },
  { id: B.IRON_ORE, deep: B.DEEPSLATE_IRON_ORE, tries: 12, min: -24, max: 56, peak: 15, spread: 34, lo: 4, hi: 9 },
  { id: B.COPPER_ORE, deep: B.COPPER_ORE, tries: 8, min: 0, max: 70, peak: 35, spread: 30, lo: 6, hi: 12 },
  { id: B.GOLD_ORE, deep: B.DEEPSLATE_GOLD_ORE, tries: 5, min: -60, max: 30, peak: -16, spread: 34, lo: 4, hi: 8 },
  { id: B.REDSTONE_ORE, deep: B.DEEPSLATE_REDSTONE_ORE, tries: 8, min: -60, max: 15, peak: -58, spread: 32, lo: 4, hi: 8 },
  { id: B.LAPIS_ORE, deep: B.DEEPSLATE_LAPIS_ORE, tries: 3, min: -60, max: 30, peak: 0, spread: 26, lo: 3, hi: 6 },
  { id: B.DIAMOND_ORE, deep: B.DEEPSLATE_DIAMOND_ORE, tries: 2, min: -60, max: 14, peak: -58, spread: 28, lo: 3, hi: 8 },
  { id: B.EMERALD_ORE, deep: B.EMERALD_ORE, tries: 4, min: 62, max: 118, peak: 92, spread: 26, lo: 1, hi: 3, peaksOnly: true },
];

const TREE_CELL = 5;

function isLeaf(id) {
  return id === B.OAK_LEAVES || id === B.BIRCH_LEAVES || id === B.SPRUCE_LEAVES;
}

function isSoftPlant(id) {
  return id === B.GRASS_PLANT || id === B.TALL_GRASS || id === B.FERN ||
         id === B.DEAD_BUSH || id === B.DANDELION || id === B.POPPY ||
         id === B.BLUE_ORCHID || id === B.CORNFLOWER || id === B.SNOW_LAYER;
}

function isRock(id) {
  return id === B.STONE || id === B.GRANITE || id === B.DIORITE ||
         id === B.ANDESITE || id === B.DEEPSLATE;
}

function pickTree(types, r) {
  if (!types || types.length === 0) return 'oak';
  let total = 0;
  for (let i = 0; i < types.length; i++) total += types[i].weight;
  let v = r.float(0, total);
  for (let i = 0; i < types.length; i++) {
    v -= types[i].weight;
    if (v <= 0) return types[i].type;
  }
  return types[types.length - 1].type;
}

function plantFor(biome, r) {
  if (biome === Biome.TAIGA || biome === Biome.SNOWY_PLAINS) return r < 0.55 ? B.FERN : B.GRASS_PLANT;
  if (biome === Biome.SAVANNA) return r < 0.4 ? B.TALL_GRASS : B.GRASS_PLANT;
  if (biome === Biome.SWAMP) return r < 0.25 ? B.TALL_GRASS : B.GRASS_PLANT;
  return r < 0.15 ? B.TALL_GRASS : B.GRASS_PLANT;
}

function flowerFor(biome, r) {
  if (biome === Biome.SWAMP) return r < 0.5 ? B.BLUE_ORCHID : B.BROWN_MUSHROOM;
  if (biome === Biome.BIRCH_FOREST) return r < 0.5 ? B.CORNFLOWER : B.POPPY;
  if (biome === Biome.TAIGA) return r < 0.5 ? B.RED_MUSHROOM : B.BROWN_MUSHROOM;
  if (r < 0.45) return B.DANDELION;
  return r < 0.8 ? B.POPPY : B.CORNFLOWER;
}

export class WorldGenerator {
  constructor(world, seed) {
    this.world = world || null;
    const s = seed === undefined || seed === null ? (world ? world.seed : 0) : seed;
    this.seed = s >>> 0;
    this.rng = new Random(this.seed);

    this._heightCache = new NoiseCache((x, z) => this._computeHeight(x, z), 1 << 16);
    this._biomeCache = new NoiseCache((x, z) => this._classify(x, z), 1 << 16);

    // Per-chunk scratch, allocated once so the inner loops never allocate.
    this._colH = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    this._colB = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this._lat1 = new Float32Array(LAT_PLANE * CAVE_LEVELS);
    this._lat2 = new Float32Array(LAT_PLANE * CAVE_LEVELS);
    this._lat3 = new Float32Array(LAT_PLANE * CAVE_LEVELS);
    this._prof1 = new Float32Array(CAVE_LEVELS);
    this._prof2 = new Float32Array(CAVE_LEVELS);
    this._prof3 = new Float32Array(CAVE_LEVELS);
  }

  // ================================================================ queries

  /**
   * Y of the first air block above the terrain — i.e. where something standing
   * on the ground would rest. Cached because structures and spawn logic hammer
   * it. Caves are cut off well below this, so it matches what generateChunk
   * actually places.
   */
  surfaceHeight(x, z) {
    return this._heightCache.get(Math.floor(x), Math.floor(z));
  }

  /** Final biome id, including the beaches and lake beds that need a height. */
  biomeAt(x, z) {
    return this._biomeCache.get(Math.floor(x), Math.floor(z));
  }

  _computeHeight(x, z) {
    const seed = this.seed;
    let off = 0, scale = 0, riverW = 0;
    for (let i = 0; i < BLEND.length; i += 3) {
      const w = BLEND[i + 2];
      const id = climateBiomeAt(x + BLEND[i], z + BLEND[i + 1], seed);
      const bd = BIOMES[id];
      off += bd.heightOffset * w;
      scale += bd.heightScale * w;
      if (id === Biome.RIVER) riverW += w;
    }
    off /= BLEND_W;
    scale /= BLEND_W;
    riverW /= BLEND_W;

    const hills = fbm2(x * 0.0042, z * 0.0042, seed + 911, 3);
    const detail = fbm2(x * 0.019, z * 0.019, seed + 1327, 2);
    let h = off + scale * (hills * 0.72 + detail * 0.28);

    // Ridges only bite where the blended profile is already alpine, so plains
    // stay plains while peaks get real relief.
    if (off > 76) {
      const alpine = Math.min(1, (off - 76) / 14);
      const ridge = ridged2(x * 0.0031, z * 0.0031, seed + 1733, 4);
      h += alpine * ridge * ridge * 34;
    }

    // Sampled at the column's own altitude, so cliffs get a 3D-looking wobble
    // while the column stays a pure function of x/z.
    if (scale > 5) {
      h += simplex3(x * 0.031, h * 0.031, z * 0.031, seed + 2111) * Math.min(3.5, scale * 0.28);
    }

    // Compress heights around sea level: the same slope now covers more than
    // twice the ground, which is what turns a coastal cliff into a beach.
    const d = h - SEA;
    if (d > -SHORE && d < SHORE) h = SEA + d * (0.45 + 0.55 * (Math.abs(d) / SHORE));

    // Rivers cut down to open water wherever their band is strong.
    if (riverW > 0) h = Math.min(h, SEA - 1 - riverW * 4);

    return clamp(Math.round(h), MIN_Y + 6, MAX_TERRAIN);
  }

  _classify(x, z) {
    const base = climateBiomeAt(x, z, this.seed);
    const h = this.surfaceHeight(x, z);
    if (base === Biome.OCEAN || base === Biome.RIVER) {
      // A water cell the blend pushed above the waterline reads as dry land.
      return h > SEA + 2 ? Biome.PLAINS : base;
    }
    if (BEACHABLE[base] && h >= SEA - 2 && h <= SEA + 3 && this._nearWater(x, z, h)) return Biome.BEACH;
    if (h <= SEA - 3) return Biome.OCEAN;
    return base;
  }

  _nearWater(x, z, h) {
    if (h <= SEA) return true;
    return this.surfaceHeight(x + 6, z) < SEA || this.surfaceHeight(x - 6, z) < SEA ||
           this.surfaceHeight(x, z + 6) < SEA || this.surfaceHeight(x, z - 6) < SEA;
  }

  _touchesWater(x, z) {
    return this.surfaceHeight(x + 1, z) <= SEA || this.surfaceHeight(x - 1, z) <= SEA ||
           this.surfaceHeight(x, z + 1) <= SEA || this.surfaceHeight(x, z - 1) <= SEA;
  }

  /** The block that ends up on top of a column, before decoration. */
  _surfaceTop(bd, biome, h) {
    if (h > SEA) {
      if (biome === Biome.STONY_PEAKS && h - 1 >= 104) return B.SNOW_BLOCK;
      return bd.surface;
    }
    return SEA - h <= 3 ? B.SAND : bd.underwater;
  }

  _stoneAt(x, y, z) {
    const seed = this.seed;
    if (y < DEEPSLATE_TOP) {
      // A ragged transition band instead of a dead-flat deepslate ceiling.
      if (y > DEEPSLATE_TOP - 5 && hash3f(x, y, z, seed + 4441) < (y - DEEPSLATE_TOP + 5) / 5) return B.STONE;
      return B.DEEPSLATE;
    }
    const v = hash3(x >> 2, y >> 2, z >> 2, seed + 5231) & 255;   // 4x4x4 blobs
    if (v < 9) return B.GRANITE;
    if (v < 18) return B.DIORITE;
    if (v < 27) return B.ANDESITE;
    return B.STONE;
  }

  // ================================================================ terrain

  generateChunk(chunk) {
    if (chunk.generated) return;
    const x0 = chunk.x0, z0 = chunk.z0;
    const hs = this._colH, bs = this._colB;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const i = columnIndex(x, z);
        const h = this.surfaceHeight(x0 + x, z0 + z);
        const b = this.biomeAt(x0 + x, z0 + z);
        hs[i] = h;
        bs[i] = b;
        chunk.biomes[i] = b;
      }
    }

    this._fillColumns(chunk);
    this._carveCaves(chunk);
    this._carveRavines(chunk);

    chunk.recomputeHeightMap();
    chunk.generated = true;
    chunk.markAllDirty();
  }

  _fillColumns(chunk) {
    const x0 = chunk.x0, z0 = chunk.z0, hs = this._colH, bs = this._colB, seed = this.seed;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const i = columnIndex(x, z);
        const wx = x0 + x, wz = z0 + z;
        const h = hs[i], b = bs[i], bd = BIOMES[b];
        let top = this._surfaceTop(bd, b, h);
        // Clay dots the shallows the way it does on vanilla lake and river beds.
        if (top === B.SAND && h < SEA && hash3(wx >> 2, 0, wz >> 2, seed + 3701) % 12 === 0) top = B.CLAY;
        let filler = h > SEA || SEA - h > 3 ? bd.filler : B.SAND;
        if (top === B.SAND) filler = B.SAND;
        else if (top === B.SNOW_BLOCK) filler = B.STONE;
        const soil = 3 + ((hash2(wx, wz, seed + 77) >>> 3) & 1);

        chunk.setBlockRaw(x, MIN_Y, z, B.BEDROCK);
        for (let y = MIN_Y + 1; y < BEDROCK_TOP; y++) {
          const rough = hash3f(wx, y, wz, seed + 131) < (BEDROCK_TOP - y) / 4;
          chunk.setBlockRaw(x, y, z, rough ? B.BEDROCK : this._stoneAt(wx, y, wz));
        }
        for (let y = BEDROCK_TOP; y < h; y++) {
          let id;
          if (y === h - 1) id = top;
          else if (y >= h - 1 - soil) id = (filler === B.SAND && y < h - 4) ? B.SANDSTONE : filler;
          else id = this._stoneAt(wx, y, wz);
          chunk.setBlockRaw(x, y, z, id);
        }
        for (let y = h; y <= SEA; y++) chunk.setBlockRaw(x, y, z, B.WATER);
      }
    }
  }

  // ================================================================ caves

  _carveCaves(chunk) {
    const hs = this._colH;
    let maxH = MIN_Y;
    for (let i = 0; i < hs.length; i++) if (hs[i] > maxH) maxH = hs[i];
    const topY = Math.min(CAVE_TOP_MAX, maxH - 5);
    if (topY <= CAVE_MIN_Y + 4) return;

    const levels = Math.min(CAVE_LEVELS, (((topY - CAVE_MIN_Y) / CAVE_Y_STRIDE) | 0) + 2);
    const l1 = this._lat1, l2 = this._lat2, l3 = this._lat3;
    const seed = this.seed, x0 = chunk.x0, z0 = chunk.z0;

    for (let li = 0; li < levels; li++) {
      const wy = CAVE_MIN_Y + li * CAVE_Y_STRIDE;
      const plane = li * LAT_PLANE;
      for (let lz = 0; lz < LAT_N; lz++) {
        const wz = z0 + lz * 4;
        for (let lx = 0; lx < LAT_N; lx++) {
          const wx = x0 + lx * 4;
          const k = plane + lz * LAT_N + lx;
          // Two independent fields; their shared zero band is a tube, which is
          // what makes spaghetti caves instead of noise sheets.
          l1[k] = simplex3(wx * 0.021, wy * 0.030, wz * 0.021, seed + 7001);
          l2[k] = simplex3(wx * 0.0197, wy * 0.028, wz * 0.0197, seed + 7333);
          l3[k] = fbm3(wx * 0.0105, wy * 0.017, wz * 0.0105, seed + 7717, 2);
        }
      }
    }

    const p1 = this._prof1, p2 = this._prof2, p3 = this._prof3;
    const latTop = CAVE_MIN_Y + (levels - 1) * CAVE_Y_STRIDE;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      const lz = z >> 2, fz = (z & 3) * 0.25;
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const colTop = Math.min(topY, hs[columnIndex(x, z)] - 5, latTop);
        if (colTop <= CAVE_MIN_Y) continue;

        const lx = x >> 2, fx = (x & 3) * 0.25;
        const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz);
        const w01 = (1 - fx) * fz, w11 = fx * fz;
        const used = Math.min(levels, (((colTop - CAVE_MIN_Y) / CAVE_Y_STRIDE) | 0) + 2);
        for (let li = 0; li < used; li++) {
          const a = li * LAT_PLANE + lz * LAT_N + lx;
          const c = a + LAT_N;
          p1[li] = l1[a] * w00 + l1[a + 1] * w10 + l1[c] * w01 + l1[c + 1] * w11;
          p2[li] = l2[a] * w00 + l2[a + 1] * w10 + l2[c] * w01 + l2[c + 1] * w11;
          p3[li] = l3[a] * w00 + l3[a + 1] * w10 + l3[c] * w01 + l3[c + 1] * w11;
        }

        // Everything from CAVE_MIN_Y to colTop is guaranteed solid, non-bedrock
        // stone or soil: _fillColumns laid it down, the bedrock roughness stops
        // below CAVE_MIN_Y, water only ever sits above the terrain, and ravines
        // run after this pass. So the per-voxel block read is not needed.
        for (let y = CAVE_MIN_Y; y <= colTop; y++) {
          const t = (y - CAVE_MIN_Y) / CAVE_Y_STRIDE;
          const li = t | 0;
          const fy = t - li;
          const lj = li + 1 < used ? li + 1 : li;

          // Tunnels pinch shut as they approach daylight, so the surface stays
          // intact and surfaceHeight keeps telling the truth.
          const near = y > colTop - 12 ? (colTop - y) / 12 : 1;
          const tw = TUBE_T * near;
          const f1 = p1[li] + (p1[lj] - p1[li]) * fy;
          let carve = f1 > -tw && f1 < tw;
          if (carve) {
            const f2 = p2[li] + (p2[lj] - p2[li]) * fy;
            carve = f2 > -tw && f2 < tw;
          }
          if (!carve) {
            const f3 = p3[li] + (p3[lj] - p3[li]) * fy;
            carve = f3 > CHEESE_T + (1 - near) * 0.3;
          }
          if (carve) chunk.setBlockRaw(x, y, z, y < LAVA_LEVEL ? B.LAVA : B.AIR);
        }
      }
    }
  }

  _carveRavines(chunk) {
    const hs = this._colH, x0 = chunk.x0, z0 = chunk.z0;
    const gx0 = Math.floor(x0 / RAVINE_CELL), gz0 = Math.floor(z0 / RAVINE_CELL);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = gx0 + dx, gz = gz0 + dz;
        const r = new Random(hash2(gx, gz, this.seed ^ 0x2ac13f));
        if (!r.bool(0.5)) continue;

        const sx = gx * RAVINE_CELL + r.below(RAVINE_CELL);
        const sz = gz * RAVINE_CELL + r.below(RAVINE_CELL);
        const ang = r.float(0, Math.PI * 2);
        const len = r.int(46, 96);
        const ex = sx + Math.cos(ang) * len, ez = sz + Math.sin(ang) * len;
        const halfW = r.float(2.4, 4.4);
        const yTop = r.int(42, 54);
        const yBot = Math.max(MIN_Y + 8, yTop - r.int(22, 38));
        const yc = (yTop + yBot) * 0.5, yr = (yTop - yBot) * 0.5;
        if (yr < 4) continue;

        const pad = halfW + 2;
        if (Math.max(sx, ex) + pad < x0 || Math.min(sx, ex) - pad > x0 + CHUNK_SIZE - 1) continue;
        if (Math.max(sz, ez) + pad < z0 || Math.min(sz, ez) - pad > z0 + CHUNK_SIZE - 1) continue;

        const vx = ex - sx, vz = ez - sz;
        const vlen2 = vx * vx + vz * vz;
        if (vlen2 < 1) continue;

        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const wx = x0 + x, wz = z0 + z;
            const t = ((wx - sx) * vx + (wz - sz) * vz) / vlen2;
            if (t < 0 || t > 1) continue;
            const px = sx + vx * t, pz = sz + vz * t;
            const ox = wx - px, oz = wz - pz;
            const dist = Math.sqrt(ox * ox + oz * oz);
            const w = halfW * Math.sin(Math.PI * t);      // pinched at both ends
            if (dist > w) continue;

            const ceiling = Math.min(yTop, hs[columnIndex(x, z)] - 6);
            for (let y = yBot; y <= ceiling; y++) {
              const dy = (y - yc) / yr;
              if (dist > w * Math.sqrt(Math.max(0, 1 - dy * dy * 0.55))) continue;
              const cur = chunk.getBlock(x, y, z);
              if (cur === B.AIR || cur === B.BEDROCK || cur === B.WATER || cur === B.LAVA) continue;
              chunk.setBlockRaw(x, y, z, y < LAVA_LEVEL ? B.LAVA : B.AIR);
            }
          }
        }
      }
    }
  }

  // ================================================================ populate

  populateChunk(chunk) {
    if (chunk.populated) return;
    chunk.populated = true;
    if (!chunk.generated) this.generateChunk(chunk);

    this._loadColumns(chunk);
    this._placeOres(chunk);
    this._placeTrees(chunk);
    this._decorate(chunk);

    chunk.recomputeHeightMap();
    chunk.markAllDirty();
  }

  /** Refill the column scratch; generateChunk may have run many chunks ago. */
  _loadColumns(chunk) {
    const hs = this._colH, bs = this._colB;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const i = columnIndex(x, z);
        hs[i] = this.surfaceHeight(chunk.x0 + x, chunk.z0 + z);
        bs[i] = chunk.biomes[i];
      }
    }
  }

  // --- ores --------------------------------------------------------------

  _placeOres(chunk) {
    const r = this.rng.fork(`ore:${chunk.cx}:${chunk.cz}`);
    const bs = this._colB;
    for (let o = 0; o < ORES.length; o++) {
      const ore = ORES[o];
      for (let n = 0; n < ore.tries; n++) {
        // Keep the origin off the border so a vein is never sliced in half by
        // a chunk we are not allowed to write into.
        const x = r.int(3, CHUNK_SIZE - 4);
        const z = r.int(3, CHUNK_SIZE - 4);
        const y = Math.round(ore.peak + (r.next() + r.next() - 1) * ore.spread);
        if (y < ore.min || y > ore.max) continue;
        if (ore.peaksOnly && bs[columnIndex(x, z)] !== Biome.STONY_PEAKS) continue;
        this._placeVein(chunk, r, x, y, z, r.int(ore.lo, ore.hi), ore.id, ore.deep);
      }
    }
  }

  _placeVein(chunk, r, x, y, z, count, oreId, deepId) {
    const len = 1 + count * 0.12;
    const a = r.float(0, Math.PI * 2);
    const ux = Math.cos(a) * len, uz = Math.sin(a) * len, uy = r.float(-0.6, 0.6) * len;
    const steps = Math.max(2, Math.round(count / 3));
    let placed = 0;

    for (let s = 0; s <= steps && placed < count; s++) {
      const f = s / steps;
      const cx = x + ux * (f - 0.5), cy = y + uy * (f - 0.5), cz = z + uz * (f - 0.5);
      const rad = 0.7 + 0.9 * Math.sin(Math.PI * f);      // fat in the middle
      const bx = Math.round(cx), by = Math.round(cy), bz = Math.round(cz);
      for (let oz = -1; oz <= 1 && placed < count; oz++) {
        for (let oy = -1; oy <= 1 && placed < count; oy++) {
          for (let ox = -1; ox <= 1 && placed < count; ox++) {
            const px = bx + ox, py = by + oy, pz = bz + oz;
            const ddx = px - cx, ddy = py - cy, ddz = pz - cz;
            if (ddx * ddx + ddy * ddy + ddz * ddz > rad * rad) continue;
            if (this._setOre(chunk, px, py, pz, oreId, deepId)) placed++;
          }
        }
      }
    }
  }

  _setOre(chunk, x, y, z, oreId, deepId) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return false;
    if (y <= BEDROCK_TOP || y > MAX_Y) return false;
    const cur = chunk.getBlock(x, y, z);
    if (!isRock(cur)) return false;
    chunk.setBlockRaw(x, y, z, cur === B.DEEPSLATE ? deepId : oreId);
    return true;
  }

  // --- trees -------------------------------------------------------------

  /**
   * Trees live on a jittered grid in world space, so every chunk that a canopy
   * overlaps derives the same tree from the same cell seed and writes only its
   * own slice. That is what keeps forests seamless without ever touching a
   * neighbouring chunk.
   */
  _placeTrees(chunk) {
    const x0 = chunk.x0, z0 = chunk.z0;
    const c0x = Math.floor((x0 - 3) / TREE_CELL), c1x = Math.floor((x0 + CHUNK_SIZE + 2) / TREE_CELL);
    const c0z = Math.floor((z0 - 3) / TREE_CELL), c1z = Math.floor((z0 + CHUNK_SIZE + 2) / TREE_CELL);

    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const r = new Random(hash2(cx, cz, this.seed ^ 0x7a3ec1));
        const tx = cx * TREE_CELL + r.below(TREE_CELL);
        const tz = cz * TREE_CELL + r.below(TREE_CELL);
        const b = this.biomeAt(tx, tz);
        const bd = BIOMES[b];
        if (bd.treeDensity <= 0) continue;
        if (!r.bool(bd.treeDensity)) continue;

        const h = this.surfaceHeight(tx, tz);
        if (h <= SEA || h > 108) continue;

        // The block under the trunk must be soil, or the tree would float.
        const ground = this._surfaceTop(bd, b, h);
        if (ground !== B.GRASS_BLOCK && ground !== B.PODZOL && ground !== B.COARSE_DIRT &&
            ground !== B.DIRT && ground !== B.WITHERED_GRASS) continue;

        // Nothing clinging to a cliff face.
        if (Math.abs(this.surfaceHeight(tx + 1, tz) - h) > 1) continue;
        if (Math.abs(this.surfaceHeight(tx - 1, tz) - h) > 1) continue;
        if (Math.abs(this.surfaceHeight(tx, tz + 1) - h) > 1) continue;
        if (Math.abs(this.surfaceHeight(tx, tz - 1) - h) > 1) continue;

        this._buildTree(chunk, tx, tz, h, pickTree(bd.treeTypes, r), r);
      }
    }
  }

  _buildTree(chunk, x, z, h, type, r) {
    if (type === 'spruce') {
      const height = r.int(7, 11);
      const bare = 1 + r.below(2);
      for (let i = 0; i < height; i++) this._putLog(chunk, x, h + i, z, B.SPRUCE_LOG);

      const crownTop = h + height, crownBase = h + 1 + bare, trunkTop = h + height - 1;
      let layer = 0;
      for (let y = crownTop; y >= crownBase; y--, layer++) {
        const rad = layer === 0 ? 0 : (layer === 1 ? 1 : (layer % 2 === 0 ? 2 : 1));
        for (let dz = -rad; dz <= rad; dz++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (dx * dx + dz * dz > rad * rad + rad) continue;
            if (dx === 0 && dz === 0 && y <= trunkTop) continue;
            this._putLeaf(chunk, x + dx, y, z + dz, B.SPRUCE_LEAVES);
          }
        }
      }
      return;
    }

    const birch = type === 'birch';
    const log = birch ? B.BIRCH_LOG : B.OAK_LOG;
    const leaf = birch ? B.BIRCH_LEAVES : B.OAK_LEAVES;
    const height = birch ? r.int(6, 8) : r.int(4, 6);
    for (let i = 0; i < height; i++) this._putLog(chunk, x, h + i, z, log);

    const top = h + height - 1;
    for (let dy = -2; dy <= 1; dy++) {
      // Oak carries two wide layers, birch only one, which is what makes birch
      // read as the tall narrow tree.
      const rad = dy <= -1 && !(birch && dy === -1) ? 2 : 1;
      const y = top + dy;
      for (let dz = -rad; dz <= rad; dz++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx === 0 && dz === 0 && dy <= 0) continue;
          if (rad === 2 && dx * dx === 4 && dz * dz === 4 && (dy === -2 || r.bool(0.5))) continue;
          if (rad === 1 && dx * dx === 1 && dz * dz === 1 && dy === 1 && r.bool(0.65)) continue;
          this._putLeaf(chunk, x + dx, y, z + dz, leaf);
        }
      }
    }
  }

  _putLog(chunk, wx, y, wz, id) {
    const x = wx - chunk.x0, z = wz - chunk.z0;
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < MIN_Y || y > MAX_Y) return;
    const cur = chunk.getBlock(x, y, z);
    if (cur !== B.AIR && !isLeaf(cur) && !isSoftPlant(cur)) return;
    chunk.setBlockRaw(x, y, z, id);
  }

  _putLeaf(chunk, wx, y, wz, id) {
    const x = wx - chunk.x0, z = wz - chunk.z0;
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < MIN_Y || y > MAX_Y) return;
    const cur = chunk.getBlock(x, y, z);
    if (cur !== B.AIR && !isSoftPlant(cur)) return;
    chunk.setBlockRaw(x, y, z, id);
  }

  // --- plants ------------------------------------------------------------

  _decorate(chunk) {
    const x0 = chunk.x0, z0 = chunk.z0, hs = this._colH, seed = this.seed;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const i = columnIndex(x, z);
        const wx = x0 + x, wz = z0 + z;
        const h = hs[i], b = chunk.biomes[i], bd = BIOMES[b];
        const snowy = b === Biome.SNOWY_PLAINS;

        if (h <= SEA) {
          if (snowy) chunk.setBlockRaw(x, SEA, z, B.ICE);
          else if (b === Biome.SWAMP && SEA - h <= 3 && hash3f(wx, 3, wz, seed + 611) < 0.06) {
            chunk.setBlockRaw(x, SEA + 1, z, B.LILY_PAD);
          }
          continue;
        }

        if (chunk.getBlock(x, h, z) !== B.AIR) continue;    // a trunk or canopy landed here
        const ground = chunk.getBlock(x, h - 1, z);

        // Sugar cane on any bank that touches open water.
        if ((ground === B.SAND || ground === B.GRASS_BLOCK || ground === B.DIRT) && h === SEA + 1 &&
            hash3f(wx, 5, wz, seed + 733) < 0.22 && this._touchesWater(wx, wz)) {
          const n = 2 + ((hash3(wx, 6, wz, seed + 733) >>> 4) % 3);
          for (let k = 0; k < n; k++) chunk.setBlockRaw(x, h + k, z, B.SUGAR_CANE);
          continue;
        }

        if (ground === B.SAND && b === Biome.DESERT) {
          const rs = hash3f(wx, 7, wz, seed + 811);
          if (rs < 0.012) {
            const n = 1 + ((hash3(wx, 8, wz, seed + 811) >>> 5) % 3);
            for (let k = 0; k < n; k++) chunk.setBlockRaw(x, h + k, z, B.CACTUS);
            continue;
          }
          if (rs < 0.032) { chunk.setBlockRaw(x, h, z, B.DEAD_BUSH); continue; }
        }

        if (ground === B.GRASS_BLOCK || ground === B.PODZOL || ground === B.WITHERED_GRASS) {
          const rp = hash3f(wx, 9, wz, seed + 907);
          if (b === Biome.WITHERED) {
            if (rp < bd.grassDensity) chunk.setBlockRaw(x, h, z, B.DEAD_BUSH);
          } else if (rp < bd.grassDensity) {
            chunk.setBlockRaw(x, h, z, plantFor(b, hash3f(wx, 10, wz, seed + 1013)));
          } else if (rp < bd.grassDensity + bd.flowerDensity) {
            chunk.setBlockRaw(x, h, z, flowerFor(b, hash3f(wx, 11, wz, seed + 1117)));
          } else if (rp > 0.9985 && (b === Biome.PLAINS || b === Biome.FOREST || b === Biome.SAVANNA)) {
            chunk.setBlockRaw(x, h, z, B.PUMPKIN);
          }
        }

        // Snow settles on cold biomes and on anything high enough to be alpine.
        if ((snowy || h - 1 >= 102) && chunk.getBlock(x, h, z) === B.AIR) {
          const under = chunk.getBlock(x, h - 1, z);
          if (under !== B.WATER && under !== B.ICE && under !== B.AIR) {
            chunk.setBlockRaw(x, h, z, B.SNOW_LAYER);
          }
        }
      }
    }
  }
}
