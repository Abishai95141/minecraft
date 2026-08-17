// Light propagation. Sky light and block light each flood outward with their
// own BFS plus a removal pass, so a block change can darken as well as brighten.
// Every queue is drained under a millisecond budget, never all at once.

import { WORLD } from '../core/constants.js';
import { LIGHT_EMIT, LIGHT_OPACITY } from './blocks.js';
import {
  CHUNK_SIZE, MIN_Y, MAX_Y, SECTION_COUNT, SECTION_HEIGHT,
  sectionIndex, columnIndex,
} from './chunk.js';

const MAX_LIGHT = WORLD.MAX_LIGHT;               // 15

/** The 6 face neighbours in FACE order, flattened: the BFS reads these constantly. */
const NEIGHBOURS = new Int8Array([
  1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
]);

/**
 * Nodes to burn between performance.now() samples. The clock is not free, but
 * sampling too rarely is what turns a budget overrun into a dropped frame.
 */
const CLOCK_INTERVAL = 128;

/**
 * A FIFO of (x, y, z, level) quadruples packed into one flat Int32Array.
 * Lighting is the hottest loop in the game, so nodes are never boxed.
 */
class LightQueue {
  constructor(capacity = 256) {
    this._data = new Int32Array(capacity * 4);
    this._head = 0;
    this._tail = 0;
  }

  get length() { return this._tail - this._head; }

  push(x, y, z, level) {
    if ((this._tail + 1) * 4 > this._data.length) this._compact();
    const i = this._tail++ * 4;
    const d = this._data;
    d[i] = x; d[i + 1] = y; d[i + 2] = z; d[i + 3] = level;
  }

  /** Copies the head node into `out` (length 4) and drops it. */
  shift(out) {
    const i = this._head++ * 4;
    const d = this._data;
    out[0] = d[i]; out[1] = d[i + 1]; out[2] = d[i + 2]; out[3] = d[i + 3];
    if (this._head === this._tail) { this._head = 0; this._tail = 0; }
  }

  /** Slides live nodes to the front; only grows when they genuinely fill it. */
  _compact() {
    const live = this._tail - this._head;
    if (live * 2 <= this._data.length / 4) {
      this._data.copyWithin(0, this._head * 4, this._tail * 4);
    } else {
      const next = new Int32Array(this._data.length * 2);
      next.set(this._data.subarray(this._head * 4, this._tail * 4));
      this._data = next;
    }
    this._head = 0;
    this._tail = live;
  }
}

export class LightEngine {
  constructor(world) {
    this.world = world;

    this._skyAdd = new LightQueue(4096);
    this._blockAdd = new LightQueue(1024);
    this._skyRemove = new LightQueue(1024);
    this._blockRemove = new LightQueue(512);

    /** Scratch for LightQueue.shift so popping a node allocates nothing. */
    this._node = new Int32Array(4);

    // Chunk.setBlockRaw creates sections with an all-zero light array, which
    // silently contradicts Chunk.getLight's "an absent section is open sky"
    // rule. This records the sections whose stored light is known to be real.
    this._seeded = new WeakSet();

    this._cx = NaN;
    this._cz = NaN;
    this._cc = null;
  }

  /** Nodes still queued. The loading screen waits on this, so keep it honest. */
  get pending() {
    return this._skyRemove.length + this._blockRemove.length +
           this._skyAdd.length + this._blockAdd.length;
  }

  // ================================================================ initial light

  /**
   * Full sky-column flood plus every emitter in the chunk, then a seam pass so
   * an already-lit neighbour does not leave a dark stripe along the border.
   */
  initialLight(chunk) {
    if (!chunk || chunk.lit) return;
    this._resetCache();

    // Sky light is meaningless without a heightmap. The generator owns it, but
    // a chunk that arrives with the default fill would flood as solid rock.
    if (!this._heightMapLooksReal(chunk)) chunk.recomputeHeightMap();

    for (let si = 0; si < SECTION_COUNT; si++) {
      const s = chunk.sections[si];
      if (s) this._seeded.add(s);
    }

    this._floodColumns(chunk);
    this._seedEmitters(chunk);
    this._seedSeams(chunk);

    chunk.lit = true;
    chunk.lightDirty = false;
    chunk.markAllDirty();
  }

  /**
   * A heightmap left at its MIN_Y fill is only believable for a chunk that is
   * genuinely empty; anything else means it was never written.
   */
  _heightMapLooksReal(chunk) {
    const h = chunk.heightMap;
    for (let i = 0; i < h.length; i++) if (h[i] !== MIN_Y) return true;
    for (let si = 0; si < SECTION_COUNT; si++) if (chunk.sections[si]?.nonAir) return false;
    return true;
  }

  /** Drops sky light down every column at full strength until something blocks it. */
  _floodColumns(chunk) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = chunk.x0 + lx;
        const wz = chunk.z0 + lz;

        // A full-strength cell only has somewhere to spread sideways when a
        // neighbouring column is taller than it. Everything above that is
        // already 15 on all four sides, so queueing it would be pure waste.
        const spreadBelow = Math.max(
          this._columnHeight(chunk, lx - 1, lz, wx - 1, wz),
          this._columnHeight(chunk, lx + 1, lz, wx + 1, wz),
          this._columnHeight(chunk, lx, lz - 1, wx, wz - 1),
          this._columnHeight(chunk, lx, lz + 1, wx, wz + 1),
        );

        let level = MAX_LIGHT;
        for (let y = MAX_Y; y >= MIN_Y; y--) {
          const op = LIGHT_OPACITY[chunk.getBlock(lx, y, lz)];
          if (level === MAX_LIGHT && op === 0) {
            this._setSky(chunk, lx, y, lz, MAX_LIGHT);
            if (y < spreadBelow) this._skyAdd.push(wx, y, wz, MAX_LIGHT);
            continue;
          }
          // Past the first obstruction, sky light pays only for what it passes
          // THROUGH. Charging a flat 1 per block made air cost light too, so a
          // canopy at y=80 left the forest floor fourteen steps later at zero —
          // pitch black under every tree. Leaves (opacity 1) dim by one each,
          // air is free, and a solid block ends the column.
          level -= op;
          if (level <= 0) break;
          this._setSky(chunk, lx, y, lz, level);
          this._skyAdd.push(wx, y, wz, level);
        }
      }
    }
  }

  _columnHeight(chunk, lx, lz, wx, wz) {
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      return chunk.heightMap[columnIndex(lx, lz)];
    }
    const n = this.world.getChunk(wx >> 4, wz >> 4);
    // An unloaded neighbour cannot be flooded into; its seam is seeded later.
    return n ? n.heightMap[columnIndex(wx & 15, wz & 15)] : MIN_Y;
  }

  _seedEmitters(chunk) {
    for (let si = 0; si < SECTION_COUNT; si++) {
      const s = chunk.sections[si];
      if (!s || s.nonAir === 0) continue;
      const baseY = MIN_Y + si * SECTION_HEIGHT;
      const blocks = s.blocks;
      for (let i = 0; i < blocks.length; i++) {
        const emit = LIGHT_EMIT[blocks[i]];
        if (emit === 0 || (s.light[i] & 0x0f) >= emit) continue;
        s.light[i] = (s.light[i] & 0xf0) | emit;
        this._blockAdd.push(chunk.x0 + (i & 15), baseY + (i >> 8), chunk.z0 + ((i >> 4) & 15), emit);
      }
    }
  }

  /**
   * Queues both sides of every border with an already-lit chunk. Without this
   * a chunk that loads next to a lit one shows a hard dark stripe at the seam.
   */
  _seedSeams(chunk) {
    for (let e = 0; e < 4; e++) {
      const dx = e === 0 ? -1 : e === 1 ? 1 : 0;
      const dz = e === 2 ? -1 : e === 3 ? 1 : 0;
      const other = this.world.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (!other || !other.lit) continue;

      for (let i = 0; i < CHUNK_SIZE; i++) {
        const ox = dx === 0 ? i : dx < 0 ? 0 : CHUNK_SIZE - 1;
        const oz = dz === 0 ? i : dz < 0 ? 0 : CHUNK_SIZE - 1;
        const tx = dx === 0 ? i : dx < 0 ? CHUNK_SIZE - 1 : 0;
        const tz = dz === 0 ? i : dz < 0 ? CHUNK_SIZE - 1 : 0;
        const wox = chunk.x0 + ox, woz = chunk.z0 + oz;
        const wtx = other.x0 + tx, wtz = other.z0 + tz;

        // Above both column tops everything is open sky on both sides; the
        // MAX_LIGHT margin covers block light spilling out of the terrain.
        const top = Math.min(MAX_Y, Math.max(
          chunk.heightMap[columnIndex(ox, oz)],
          other.heightMap[columnIndex(tx, tz)],
        ) + MAX_LIGHT);

        for (let y = top; y >= MIN_Y; y--) {
          const a = chunk.getLight(ox, y, oz);
          const b = other.getLight(tx, y, tz);
          const as = (a >> 4) & 15, ab = a & 15;
          const bs = (b >> 4) & 15, bb = b & 15;
          if (bs > as + 1) this._skyAdd.push(wtx, y, wtz, bs);
          else if (as > bs + 1) this._skyAdd.push(wox, y, woz, as);
          if (bb > ab + 1) this._blockAdd.push(wtx, y, wtz, bb);
          else if (ab > bb + 1) this._blockAdd.push(wox, y, woz, ab);
        }
      }
    }
  }

  // ================================================================ incremental

  /**
   * Queues the work a single block change implies: tear down whatever light the
   * old block held, seed the new emission, and re-offer every neighbour so light
   * can flow back into the hole (or fail to, behind the new wall).
   */
  onBlockChanged(x, y, z, prevId, newId) {
    if (y < MIN_Y || y > MAX_Y) return;
    const prevOp = LIGHT_OPACITY[prevId], newOp = LIGHT_OPACITY[newId];
    const prevEmit = LIGHT_EMIT[prevId], newEmit = LIGHT_EMIT[newId];
    if (prevOp === newOp && prevEmit === newEmit) return;

    this._resetCache();
    const c = this._chunk(x, z);
    // An unlit chunk gets a full flood later; doing it twice would only be slow.
    if (!c || !c.lit) return;

    const lx = x & 15, lz = z & 15;
    // The placement may have materialised a section behind our back, in which
    // case its zeroed light array is a lie about the open sky it replaced.
    this._ensureSeeded(c, y, lx, lz);

    const packed = c.getLight(lx, y, lz);
    const oldSky = (packed >> 4) & 15;
    const oldBlock = packed & 15;

    // Removals are queued before propagation and drained first, so the shadow
    // is cleared before anything tries to refill it.
    if (oldBlock > 0) {
      this._setBlockLight(c, lx, y, lz, 0);
      this._blockRemove.push(x, y, z, oldBlock);
    }
    if (oldSky > 0) {
      this._setSky(c, lx, y, lz, 0);
      this._skyRemove.push(x, y, z, oldSky);
    }
    this._markDirty(c, lx, y, lz);

    if (newEmit > 0) {
      this._setBlockLight(c, lx, y, lz, newEmit);
      this._blockAdd.push(x, y, z, newEmit);
    }

    for (let f = 0; f < 6; f++) {
      const nx = x + NEIGHBOURS[f * 3];
      const ny = y + NEIGHBOURS[f * 3 + 1];
      const nz = z + NEIGHBOURS[f * 3 + 2];
      if (ny < MIN_Y || ny > MAX_Y) continue;
      const nc = this._chunk(nx, nz);
      if (!nc) continue;
      const p = nc.getLight(nx & 15, ny, nz & 15);
      const s = (p >> 4) & 15, b = p & 15;
      if (s > 1) this._skyAdd.push(nx, ny, nz, s);
      if (b > 1) this._blockAdd.push(nx, ny, nz, b);
    }
  }

  // ================================================================ draining

  /**
   * Drains the queues for at most `budgetMs`. Returns the number of nodes
   * processed so callers can tell whether the backlog is actually shrinking.
   */
  process(budgetMs = 4) {
    if (this.pending === 0) return 0;
    this._resetCache();

    const deadline = performance.now() + (budgetMs > 0 ? budgetMs : 0);
    let processed = 0;
    let untilClock = CLOCK_INTERVAL;

    for (;;) {
      // Removal before propagation: otherwise the light being taken away is
      // immediately re-flooded from the cells that still hold it.
      if (this._skyRemove.length) this._stepSkyRemove();
      else if (this._blockRemove.length) this._stepBlockRemove();
      else if (this._skyAdd.length) this._stepSkyAdd();
      else if (this._blockAdd.length) this._stepBlockAdd();
      else break;

      processed++;
      if (--untilClock <= 0) {
        untilClock = CLOCK_INTERVAL;
        if (performance.now() >= deadline) break;
      }
    }
    return processed;
  }

  _stepSkyAdd() {
    const n = this._node;
    this._skyAdd.shift(n);
    const x = n[0], y = n[1], z = n[2];
    const c = this._chunk(x, z);
    if (!c) return;
    // Re-read: the queued level may have been raised or removed since.
    const level = (c.getLight(x & 15, y, z & 15) >> 4) & 15;
    if (level <= 1) return;

    for (let f = 0; f < 6; f++) {
      const dy = NEIGHBOURS[f * 3 + 1];
      const nx = x + NEIGHBOURS[f * 3];
      const ny = y + dy;
      const nz = z + NEIGHBOURS[f * 3 + 2];
      if (ny < MIN_Y || ny > MAX_Y) continue;
      const nc = this._chunk(nx, nz);
      if (!nc) continue;
      const lx = nx & 15, lz = nz & 15;
      const op = LIGHT_OPACITY[nc.getBlock(lx, ny, lz)];
      // Sunlight falls straight down a clear column without losing a level.
      const next = (dy < 0 && level === MAX_LIGHT && op === 0)
        ? MAX_LIGHT
        : level - (op > 1 ? op : 1);
      if (next <= 0) continue;
      const cur = (nc.getLight(lx, ny, lz) >> 4) & 15;
      if (cur >= next) {
        // An absent section reports open sky without storing it, so a
        // full-strength descent has to walk through one to reach the sections
        // below, which may still hold the darker value from before.
        if (dy < 0 && next === MAX_LIGHT && cur === MAX_LIGHT && !nc.sections[(ny - MIN_Y) >> 4]) {
          this._skyAdd.push(nx, ny, nz, MAX_LIGHT);
        }
        continue;
      }
      this._setSky(nc, lx, ny, lz, next);
      this._markDirty(nc, lx, ny, lz);
      this._skyAdd.push(nx, ny, nz, next);
    }
  }

  _stepBlockAdd() {
    const n = this._node;
    this._blockAdd.shift(n);
    const x = n[0], y = n[1], z = n[2];
    const c = this._chunk(x, z);
    if (!c) return;
    const level = c.getLight(x & 15, y, z & 15) & 15;
    if (level <= 1) return;

    for (let f = 0; f < 6; f++) {
      const nx = x + NEIGHBOURS[f * 3];
      const ny = y + NEIGHBOURS[f * 3 + 1];
      const nz = z + NEIGHBOURS[f * 3 + 2];
      if (ny < MIN_Y || ny > MAX_Y) continue;
      const nc = this._chunk(nx, nz);
      if (!nc) continue;
      const lx = nx & 15, lz = nz & 15;
      const op = LIGHT_OPACITY[nc.getBlock(lx, ny, lz)];
      const next = level - (op > 1 ? op : 1);
      if (next <= 0) continue;
      if ((nc.getLight(lx, ny, lz) & 15) >= next) continue;
      this._setBlockLight(nc, lx, ny, lz, next);
      this._markDirty(nc, lx, ny, lz);
      this._blockAdd.push(nx, ny, nz, next);
    }
  }

  _stepSkyRemove() {
    const n = this._node;
    this._skyRemove.shift(n);
    const x = n[0], y = n[1], z = n[2], old = n[3];

    for (let f = 0; f < 6; f++) {
      const dy = NEIGHBOURS[f * 3 + 1];
      const nx = x + NEIGHBOURS[f * 3];
      const ny = y + dy;
      const nz = z + NEIGHBOURS[f * 3 + 2];
      if (ny < MIN_Y || ny > MAX_Y) continue;
      const nc = this._chunk(nx, nz);
      if (!nc) continue;
      const lx = nx & 15, lz = nz & 15;
      const lvl = (nc.getLight(lx, ny, lz) >> 4) & 15;
      if (lvl === 0) {
        // Placing a block raises the heightmap, which flips every absent
        // section below it from open sky to dark without storing a thing. The
        // cascade must walk through that nothing, or the real sections further
        // down keep the full-strength light they are no longer entitled to.
        if (dy < 0 && old === MAX_LIGHT && !nc.sections[(ny - MIN_Y) >> 4]) {
          this._skyRemove.push(nx, ny, nz, MAX_LIGHT);
        }
        continue;
      }

      // Anything dimmer than the level being removed was lit by it (with
      // variable opacity "dimmer" generalises "exactly one less"), and so is
      // the column underneath a full-strength cell, which inherits all 15.
      if (lvl < old || (dy < 0 && old === MAX_LIGHT && lvl === MAX_LIGHT)) {
        this._setSky(nc, lx, ny, lz, 0);
        this._markDirty(nc, lx, ny, lz);
        this._skyRemove.push(nx, ny, nz, lvl);
      } else {
        // Brighter: it came from elsewhere, so it refills the hole afterwards.
        this._skyAdd.push(nx, ny, nz, lvl);
      }
    }
  }

  _stepBlockRemove() {
    const n = this._node;
    this._blockRemove.shift(n);
    const x = n[0], y = n[1], z = n[2], old = n[3];

    for (let f = 0; f < 6; f++) {
      const nx = x + NEIGHBOURS[f * 3];
      const ny = y + NEIGHBOURS[f * 3 + 1];
      const nz = z + NEIGHBOURS[f * 3 + 2];
      if (ny < MIN_Y || ny > MAX_Y) continue;
      const nc = this._chunk(nx, nz);
      if (!nc) continue;
      const lx = nx & 15, lz = nz & 15;
      const lvl = nc.getLight(lx, ny, lz) & 15;
      if (lvl === 0) continue;

      if (lvl < old) {
        this._setBlockLight(nc, lx, ny, lz, 0);
        this._markDirty(nc, lx, ny, lz);
        this._blockRemove.push(nx, ny, nz, lvl);
      } else {
        this._blockAdd.push(nx, ny, nz, lvl);
      }
    }
  }

  // ================================================================ storage

  _resetCache() {
    this._cx = NaN;
    this._cz = NaN;
    this._cc = null;
  }

  /** Chunk lookup memoised on the last (cx, cz); the BFS walks in straight lines. */
  _chunk(x, z) {
    const cx = x >> 4, cz = z >> 4;
    if (cx === this._cx && cz === this._cz) return this._cc;
    const c = this.world.getChunk(cx, cz);
    this._cx = cx;
    this._cz = cz;
    this._cc = c;
    return c;
  }

  _setSky(chunk, lx, y, lz, level) {
    const si = (y - MIN_Y) >> 4;
    if (si < 0 || si >= SECTION_COUNT) return;
    let s = chunk.sections[si];
    if (!s) {
      // An absent section already reads back as the implicit value, so storing
      // it would allocate 12 KB of arrays to change nothing.
      if (level === (y >= chunk.heightMap[columnIndex(lx, lz)] ? MAX_LIGHT : 0)) return;
      s = this._materialise(chunk, si, -1, -1);
      if (!s) return;
    }
    const i = sectionIndex(lx, y, lz);
    s.light[i] = (s.light[i] & 0x0f) | (level << 4);
  }

  _setBlockLight(chunk, lx, y, lz, level) {
    const si = (y - MIN_Y) >> 4;
    if (si < 0 || si >= SECTION_COUNT) return;
    let s = chunk.sections[si];
    if (!s) {
      if (level === 0) return;
      s = this._materialise(chunk, si, -1, -1);
      if (!s) return;
    }
    const i = sectionIndex(lx, y, lz);
    s.light[i] = (s.light[i] & 0xf0) | level;
  }

  /** Creates a section and back-fills the light the absent-section rule implied. */
  _materialise(chunk, si, openLx, openLz) {
    const s = chunk.ensureSection(MIN_Y + si * SECTION_HEIGHT);
    if (!s) return null;
    this._seedSection(chunk, si, s, openLx, openLz);
    return s;
  }

  _ensureSeeded(chunk, y, openLx, openLz) {
    const si = (y - MIN_Y) >> 4;
    if (si < 0 || si >= SECTION_COUNT) return;
    const s = chunk.sections[si];
    if (s && !this._seeded.has(s)) this._seedSection(chunk, si, s, openLx, openLz);
  }

  /**
   * Writes the light an absent section used to report: full sky above each
   * column's height, nothing below it. `openLx`/`openLz` name the column whose
   * height was just raised by the very block that created this section — it was
   * open sky a moment ago, and the removal pass needs to see that.
   */
  _seedSection(chunk, si, s, openLx, openLz) {
    const base = MIN_Y + si * SECTION_HEIGHT;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const h = chunk.heightMap[columnIndex(lx, lz)];
        const top = (lx === openLx && lz === openLz && h <= base + SECTION_HEIGHT) ? base : h;
        for (let dy = top > base ? top - base : 0; dy < SECTION_HEIGHT; dy++) {
          s.light[(dy << 8) | (lz << 4) | lx] = 0xf0;
        }
      }
    }
    this._seeded.add(s);
  }

  /** Light changed at this cell, so its section (and any seam it sits on) re-meshes. */
  _markDirty(chunk, lx, y, lz) {
    chunk.meshDirty = true;
    const si = (y - MIN_Y) >> 4;
    if (si < 0 || si >= SECTION_COUNT) return;
    chunk.dirtySections.add(si);

    const ly = (y - MIN_Y) & 15;
    if (ly === 0 && si > 0) chunk.dirtySections.add(si - 1);
    else if (ly === 15 && si < SECTION_COUNT - 1) chunk.dirtySections.add(si + 1);

    // Smooth lighting samples across the border, so the neighbour is stale too.
    if (lx === 0) this.world.getChunk(chunk.cx - 1, chunk.cz)?.markDirty(y);
    else if (lx === 15) this.world.getChunk(chunk.cx + 1, chunk.cz)?.markDirty(y);
    if (lz === 0) this.world.getChunk(chunk.cx, chunk.cz - 1)?.markDirty(y);
    else if (lz === 15) this.world.getChunk(chunk.cx, chunk.cz + 1)?.markDirty(y);
  }
}
