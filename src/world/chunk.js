// Chunk storage. A chunk is 16x16 in X/Z and spans the full world height,
// split into 16-tall sections so that all-air space above the terrain costs
// nothing. Block ids, per-block state and packed light all live here.

import { WORLD } from '../core/constants.js';
import { B, LIGHT_EMIT, LIGHT_OPACITY, IS_OPAQUE } from './blocks.js';

export const CHUNK_SIZE = WORLD.CHUNK_SIZE;          // 16
export const CHUNK_HEIGHT = WORLD.CHUNK_HEIGHT;      // 192
export const MIN_Y = WORLD.MIN_Y;                    // -64
export const MAX_Y = MIN_Y + CHUNK_HEIGHT - 1;       // 127
export const SECTION_HEIGHT = 16;
export const SECTION_COUNT = CHUNK_HEIGHT / SECTION_HEIGHT;   // 12
export const SECTION_VOLUME = SECTION_HEIGHT * CHUNK_SIZE * CHUNK_SIZE; // 4096

/** Index within a section, YZX-ordered for meshing locality. */
export const sectionIndex = (x, y, z) => ((y & 15) << 8) | ((z & 15) << 4) | (x & 15);
/** Index within a chunk column heightmap / biome map. */
export const columnIndex = (x, z) => ((z & 15) << 4) | (x & 15);

export const chunkKey = (cx, cz) => `${cx},${cz}`;

export class ChunkSection {
  constructor() {
    this.blocks = new Uint16Array(SECTION_VOLUME);
    this.meta = new Uint8Array(SECTION_VOLUME);
    /** (skyLight << 4) | blockLight */
    this.light = new Uint8Array(SECTION_VOLUME);
    /** Number of non-air blocks; a section that hits 0 can be dropped. */
    this.nonAir = 0;
    /** True when this section contains anything that needs a mesh. */
    this.empty = true;
  }
}

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.x0 = cx * CHUNK_SIZE;
    this.z0 = cz * CHUNK_SIZE;

    /** @type {Array<ChunkSection|null>} */
    this.sections = new Array(SECTION_COUNT).fill(null);
    /** Highest non-air block y + 1, per column. */
    this.heightMap = new Int16Array(CHUNK_SIZE * CHUNK_SIZE).fill(MIN_Y);
    /** Biome id per column. */
    this.biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    /** Furnace/chest contents, keyed by packed local position. */
    this.blockEntities = new Map();

    this.generated = false;   // terrain shape written
    this.populated = false;   // trees / ores / structures placed
    this.lit = false;         // initial light flood done
    this.meshDirty = true;
    this.lightDirty = true;
    /** Sections whose mesh needs rebuilding. */
    this.dirtySections = new Set();
    /** Renderer-owned mesh handles, one per section. */
    this.meshes = new Array(SECTION_COUNT).fill(null);
    /** Bumped on every block change; lets systems cheaply detect staleness. */
    this.version = 0;
  }

  // ---------------------------------------------------------------- sections

  sectionFor(y) {
    const si = (y - MIN_Y) >> 4;
    if (si < 0 || si >= SECTION_COUNT) return null;
    return this.sections[si];
  }

  ensureSection(y) {
    const si = (y - MIN_Y) >> 4;
    if (si < 0 || si >= SECTION_COUNT) return null;
    let s = this.sections[si];
    if (!s) {
      s = new ChunkSection();
      this.sections[si] = s;
    }
    return s;
  }

  static sectionIndexFor(y) { return (y - MIN_Y) >> 4; }
  static sectionBaseY(si) { return MIN_Y + si * SECTION_HEIGHT; }

  // ---------------------------------------------------------------- blocks
  // All coordinates are chunk-local: x,z in 0..15, y in MIN_Y..MAX_Y.

  getBlock(x, y, z) {
    if (y < MIN_Y || y > MAX_Y) return B.AIR;
    const s = this.sections[(y - MIN_Y) >> 4];
    return s ? s.blocks[sectionIndex(x, y, z)] : B.AIR;
  }

  getMeta(x, y, z) {
    if (y < MIN_Y || y > MAX_Y) return 0;
    const s = this.sections[(y - MIN_Y) >> 4];
    return s ? s.meta[sectionIndex(x, y, z)] : 0;
  }

  /** Fast path used by world generation; skips heightmap and dirty tracking. */
  setBlockRaw(x, y, z, id, meta = 0) {
    if (y < MIN_Y || y > MAX_Y) return;
    if (id === B.AIR) {
      const s = this.sections[(y - MIN_Y) >> 4];
      if (!s) return;
      const i = sectionIndex(x, y, z);
      if (s.blocks[i] !== B.AIR) s.nonAir--;
      s.blocks[i] = B.AIR;
      s.meta[i] = 0;
      return;
    }
    const s = this.ensureSection(y);
    if (!s) return;
    const i = sectionIndex(x, y, z);
    if (s.blocks[i] === B.AIR) s.nonAir++;
    s.blocks[i] = id;
    s.meta[i] = meta;
    s.empty = false;
  }

  setBlock(x, y, z, id, meta = 0) {
    if (y < MIN_Y || y > MAX_Y) return false;
    const prev = this.getBlock(x, y, z);
    if (prev === id && this.getMeta(x, y, z) === meta) return false;

    this.setBlockRaw(x, y, z, id, meta);
    this.version++;

    // Keep the heightmap current so lighting and mob spawning stay cheap.
    const ci = columnIndex(x, z);
    const h = this.heightMap[ci];
    if (id !== B.AIR && y >= h) {
      this.heightMap[ci] = y + 1;
    } else if (id === B.AIR && y === h - 1) {
      let ny = y;
      while (ny > MIN_Y && this.getBlock(x, ny - 1, z) === B.AIR) ny--;
      this.heightMap[ci] = ny;
    }

    if (id === B.AIR) this.blockEntities.delete(this._beKey(x, y, z));

    this.markDirty(y);
    return true;
  }

  markDirty(y) {
    this.meshDirty = true;
    this.lightDirty = true;
    const si = (y - MIN_Y) >> 4;
    if (si >= 0 && si < SECTION_COUNT) {
      this.dirtySections.add(si);
      // A block on a section boundary changes the neighbour's face culling.
      if (((y - MIN_Y) & 15) === 0 && si > 0) this.dirtySections.add(si - 1);
      if (((y - MIN_Y) & 15) === 15 && si < SECTION_COUNT - 1) this.dirtySections.add(si + 1);
    }
  }

  markAllDirty() {
    this.meshDirty = true;
    for (let si = 0; si < SECTION_COUNT; si++) if (this.sections[si]) this.dirtySections.add(si);
  }

  // ---------------------------------------------------------------- light

  getLight(x, y, z) {
    if (y < MIN_Y) return 0;
    if (y > MAX_Y) return 0xf0;        // above the world: full sky, no block light
    const s = this.sections[(y - MIN_Y) >> 4];
    if (!s) {
      // An absent section is air; it is lit iff it is above the terrain.
      return y >= this.heightMap[columnIndex(x, z)] ? 0xf0 : 0;
    }
    return s.light[sectionIndex(x, y, z)];
  }

  getSkyLight(x, y, z) { return (this.getLight(x, y, z) >> 4) & 15; }
  getBlockLight(x, y, z) { return this.getLight(x, y, z) & 15; }

  setSkyLight(x, y, z, level) {
    const s = this.ensureSection(y);
    if (!s) return;
    const i = sectionIndex(x, y, z);
    s.light[i] = (s.light[i] & 0x0f) | ((level & 15) << 4);
  }

  setBlockLight(x, y, z, level) {
    const s = this.ensureSection(y);
    if (!s) return;
    const i = sectionIndex(x, y, z);
    s.light[i] = (s.light[i] & 0xf0) | (level & 15);
  }

  setLight(x, y, z, sky, block) {
    const s = this.ensureSection(y);
    if (!s) return;
    s.light[sectionIndex(x, y, z)] = ((sky & 15) << 4) | (block & 15);
  }

  // ---------------------------------------------------------------- columns

  getHeight(x, z) { return this.heightMap[columnIndex(x, z)]; }

  recomputeHeightMap() {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        let y = MAX_Y;
        while (y > MIN_Y && this.getBlock(x, y, z) === B.AIR) y--;
        this.heightMap[columnIndex(x, z)] = this.getBlock(x, y, z) === B.AIR ? MIN_Y : y + 1;
      }
    }
  }

  getBiome(x, z) { return this.biomes[columnIndex(x, z)]; }
  setBiome(x, z, id) { this.biomes[columnIndex(x, z)] = id; }

  // ---------------------------------------------------------------- block entities

  _beKey(x, y, z) { return ((y - MIN_Y) << 8) | ((z & 15) << 4) | (x & 15); }

  getBlockEntity(x, y, z) { return this.blockEntities.get(this._beKey(x, y, z)) || null; }
  setBlockEntity(x, y, z, data) { this.blockEntities.set(this._beKey(x, y, z), data); }
  removeBlockEntity(x, y, z) { this.blockEntities.delete(this._beKey(x, y, z)); }

  // ---------------------------------------------------------------- maintenance

  /** Drops sections that became pure air; keeps memory flat while mining. */
  compact() {
    for (let si = 0; si < SECTION_COUNT; si++) {
      const s = this.sections[si];
      if (s && s.nonAir === 0) {
        // Only drop it if nothing is relying on its stored light values.
        let hasLight = false;
        for (let i = 0; i < SECTION_VOLUME; i++) {
          if ((s.light[i] & 0x0f) !== 0) { hasLight = true; break; }
        }
        if (!hasLight) this.sections[si] = null;
      }
    }
  }

  /** Rough byte cost, shown on the debug screen. */
  memoryBytes() {
    let n = this.heightMap.byteLength + this.biomes.byteLength;
    for (const s of this.sections) {
      if (s) n += s.blocks.byteLength + s.meta.byteLength + s.light.byteLength;
    }
    return n;
  }

  // ---------------------------------------------------------------- serialisation
  // Run-length encoded so a save fits comfortably in localStorage.

  serialize() {
    const sections = [];
    for (let si = 0; si < SECTION_COUNT; si++) {
      const s = this.sections[si];
      if (!s || s.nonAir === 0) { sections.push(null); continue; }
      sections.push({
        b: rle(s.blocks),
        m: rle(s.meta),
      });
    }
    const be = [];
    for (const [k, v] of this.blockEntities) be.push([k, v]);
    return {
      cx: this.cx, cz: this.cz,
      s: sections,
      bio: rle(this.biomes),
      be,
    };
  }

  static deserialize(data) {
    const c = new Chunk(data.cx, data.cz);
    for (let si = 0; si < SECTION_COUNT; si++) {
      const raw = data.s?.[si];
      if (!raw) continue;
      const s = new ChunkSection();
      unrle(raw.b, s.blocks);
      unrle(raw.m, s.meta);
      let n = 0;
      for (let i = 0; i < SECTION_VOLUME; i++) if (s.blocks[i] !== B.AIR) n++;
      s.nonAir = n;
      s.empty = n === 0;
      c.sections[si] = s;
    }
    if (data.bio) unrle(data.bio, c.biomes);
    if (data.be) for (const [k, v] of data.be) c.blockEntities.set(k, v);
    c.recomputeHeightMap();
    c.generated = true;
    c.populated = true;
    c.lit = false;
    c.markAllDirty();
    return c;
  }
}

/** Run-length encode a typed array into a flat [value, count, ...] array. */
function rle(arr) {
  const out = [];
  let prev = arr[0], count = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === prev && count < 65535) { count++; continue; }
    out.push(prev, count);
    prev = arr[i]; count = 1;
  }
  out.push(prev, count);
  return out;
}

function unrle(pairs, target) {
  let i = 0;
  for (let p = 0; p < pairs.length; p += 2) {
    const v = pairs[p], n = pairs[p + 1];
    for (let k = 0; k < n && i < target.length; k++) target[i++] = v;
  }
  return target;
}

// ---------------------------------------------------------------- neighbour access
// The mesher and the lighting engine both need to read one block outside the
// chunk they are working on. This helper centralises that.

/**
 * A read-only 18x18x(H) view centred on one chunk, used while meshing so the
 * inner loops never do a hash lookup.
 */
export class NeighbourView {
  constructor(world, cx, cz) {
    this.world = world;
    this.cx = cx;
    this.cz = cz;
    this.center = world.getChunk(cx, cz);
    this.n = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.n.push(world.getChunk(cx + dx, cz + dz));
      }
    }
  }
  /** `x`,`z` may range from -1 to CHUNK_SIZE; `y` is absolute. */
  chunkAt(x, z) {
    const dx = x < 0 ? -1 : x >= CHUNK_SIZE ? 1 : 0;
    const dz = z < 0 ? -1 : z >= CHUNK_SIZE ? 1 : 0;
    return this.n[(dz + 1) * 3 + (dx + 1)];
  }
  block(x, y, z) {
    const c = this.chunkAt(x, z);
    return c ? c.getBlock(x & 15, y, z & 15) : B.AIR;
  }
  meta(x, y, z) {
    const c = this.chunkAt(x, z);
    return c ? c.getMeta(x & 15, y, z & 15) : 0;
  }
  light(x, y, z) {
    const c = this.chunkAt(x, z);
    return c ? c.getLight(x & 15, y, z & 15) : 0xf0;
  }
  biome(x, z) {
    const c = this.chunkAt(x, z);
    return c ? c.getBiome(x & 15, z & 15) : 0;
  }
  /** True when every neighbour needed for a correct mesh is loaded. */
  get complete() { return this.n.every(Boolean); }
}
