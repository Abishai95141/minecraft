// The world: chunk storage and lifecycle, block access in world coordinates,
// collision queries, raycasting, entity management and the tick loop.

import { WORLD, TPS } from '../core/constants.js';
import { AABB } from '../core/math.js';
import { Random } from '../core/rng.js';
import {
  B, BLOCKS, RenderType, RENDER_TYPE, IS_SOLID, IS_FLUID, IS_REPLACEABLE,
  SLIPPERINESS, IS_CLIMBABLE, CONTACT_DAMAGE, LIGHT_EMIT, needsSupport,
} from './blocks.js';
import { Chunk, CHUNK_SIZE, MIN_Y, MAX_Y, chunkKey, columnIndex } from './chunk.js';

export const FACE_OFFSETS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

export class World {
  constructor(seed = 0, opts = {}) {
    this.seed = seed >>> 0;
    this.rng = new Random(this.seed);
    /** @type {Map<string, Chunk>} */
    this.chunks = new Map();
    /** @type {import('./worldgen.js').WorldGenerator|null} */
    this.generator = null;
    /** @type {import('./lighting.js').LightEngine|null} */
    this.lighting = null;

    /** @type {import('../entity/entity.js').Entity[]} */
    this.entities = [];
    this.entitiesById = new Map();
    this.nextEntityId = 1;

    this.timeOfDay = opts.timeOfDay ?? 1000;   // ticks; 1000 = early morning
    this.totalTicks = 0;
    this.difficulty = opts.difficulty || 'normal';
    /** Story mode freezes hostile spawning outside scripted events. */
    this.spawnHostiles = opts.spawnHostiles !== false;
    this.doDaylightCycle = opts.doDaylightCycle !== false;
    this.doMobSpawning = opts.doMobSpawning !== false;
    this.keepInventory = !!opts.keepInventory;

    /** Chunks awaiting generation / lighting / meshing, in priority order. */
    this.generateQueue = [];
    this.lightQueue = [];
    this.meshQueue = [];
    /** Scheduled block updates: { x, y, z, tick }. */
    this.scheduledTicks = [];

    /** Listeners: (event, payload) => void */
    this._listeners = new Set();

    this.stats = { chunksLoaded: 0, entitiesTicked: 0, blockUpdates: 0 };
  }

  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  emit(event, payload) { for (const fn of this._listeners) fn(event, payload); }

  // ================================================================ chunks

  getChunk(cx, cz) { return this.chunks.get(chunkKey(cx, cz)) || null; }

  hasChunk(cx, cz) { return this.chunks.has(chunkKey(cx, cz)); }

  getOrCreateChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      c = new Chunk(cx, cz);
      this.chunks.set(key, c);
      this.stats.chunksLoaded = this.chunks.size;
    }
    return c;
  }

  addChunk(chunk) {
    this.chunks.set(chunkKey(chunk.cx, chunk.cz), chunk);
    this.stats.chunksLoaded = this.chunks.size;
    // Neighbours must re-mesh so the seam between them culls correctly.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      this.getChunk(chunk.cx + dx, chunk.cz + dz)?.markAllDirty();
    }
    return chunk;
  }

  unloadChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    const c = this.chunks.get(key);
    if (!c) return null;
    this.chunks.delete(key);
    this.stats.chunksLoaded = this.chunks.size;
    this.emit('chunkUnload', c);
    return c;
  }

  chunkAt(wx, wz) { return this.getChunk(wx >> 4, wz >> 4); }

  /** Every loaded chunk within `radius` chunks of a world position. */
  chunksAround(wx, wz, radius) {
    const cx0 = (wx >> 4) - radius, cx1 = (wx >> 4) + radius;
    const cz0 = (wz >> 4) - radius, cz1 = (wz >> 4) + radius;
    const out = [];
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.getChunk(cx, cz);
        if (c) out.push(c);
      }
    }
    return out;
  }

  // ================================================================ blocks

  getBlock(x, y, z) {
    if (y < MIN_Y || y > MAX_Y) return B.AIR;
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.getBlock(x & 15, y, z & 15) : B.AIR;
  }

  getMeta(x, y, z) {
    if (y < MIN_Y || y > MAX_Y) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.getMeta(x & 15, y, z & 15) : 0;
  }

  getBlockDef(x, y, z) { return BLOCKS[this.getBlock(x, y, z)]; }

  /**
   * Places a block and runs the follow-up work: lighting, neighbour updates,
   * mesh invalidation and gravity checks.
   */
  setBlock(x, y, z, id, meta = 0, opts = {}) {
    if (y < MIN_Y || y > MAX_Y) return false;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return false;

    const prev = c.getBlock(x & 15, y, z & 15);
    if (!c.setBlock(x & 15, y, z & 15, id, meta)) return false;

    this.stats.blockUpdates++;

    // A change on a chunk edge invalidates the neighbour's mesh too.
    const lx = x & 15, lz = z & 15;
    if (lx === 0) this.getChunk((x >> 4) - 1, z >> 4)?.markDirty(y);
    if (lx === 15) this.getChunk((x >> 4) + 1, z >> 4)?.markDirty(y);
    if (lz === 0) this.getChunk(x >> 4, (z >> 4) - 1)?.markDirty(y);
    if (lz === 15) this.getChunk(x >> 4, (z >> 4) + 1)?.markDirty(y);

    if (!opts.skipLight) this.lighting?.onBlockChanged(x, y, z, prev, id);
    if (!opts.skipUpdates) this.updateNeighbours(x, y, z);

    this.emit('blockChanged', { x, y, z, prev, id, meta });
    return true;
  }

  /** Generation-time write: no lighting, no updates, no events. */
  setBlockFast(x, y, z, id, meta = 0) {
    const c = this.getOrCreateChunk(x >> 4, z >> 4);
    c.setBlockRaw(x & 15, y, z & 15, id, meta);
  }

  getSkyLight(x, y, z) {
    if (y > MAX_Y) return 15;
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.getSkyLight(x & 15, y, z & 15) : 15;
  }

  getBlockLight(x, y, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.getBlockLight(x & 15, y, z & 15) : 0;
  }

  /** Combined light level 0-15 as the player experiences it right now. */
  getLightLevel(x, y, z) {
    const sky = this.getSkyLight(x, y, z) * this.skyLightFactor();
    return Math.max(Math.round(sky), this.getBlockLight(x, y, z));
  }

  /** 0..1 daylight multiplier applied to sky light. */
  skyLightFactor() {
    const t = this.timeOfDay % WORLD.DAY_LENGTH_TICKS;
    const angle = (t / WORLD.DAY_LENGTH_TICKS) * Math.PI * 2;
    // 1.0 through the day, floors at 0.2 at midnight, with smooth dawn/dusk.
    const f = Math.cos(angle - Math.PI / 2) * 2 + 0.5;
    return Math.max(0.2, Math.min(1, f));
  }

  get isDay() {
    const t = this.timeOfDay % WORLD.DAY_LENGTH_TICKS;
    return t < WORLD.SUNSET_START || t > WORLD.SUNRISE_START;
  }

  getHeight(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.getHeight(x & 15, z & 15) : MIN_Y;
  }

  getBiome(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.getBiome(x & 15, z & 15) : 0;
  }

  getBlockEntity(x, y, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.getBlockEntity(x & 15, y, z & 15) : null;
  }

  setBlockEntity(x, y, z, data) {
    const c = this.getChunk(x >> 4, z >> 4);
    c?.setBlockEntity(x & 15, y, z & 15, data);
  }

  // ================================================================ block updates

  /** Notifies the 6 neighbours that a block changed; drops unsupported blocks. */
  updateNeighbours(x, y, z) {
    for (const [dx, dy, dz] of FACE_OFFSETS) {
      this.updateBlock(x + dx, y + dy, z + dz);
    }
    this.updateBlock(x, y, z);
  }

  updateBlock(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id === B.AIR) return;

    // Plants, torches and snow fall off when their support goes away.
    if (needsSupport(id)) {
      const below = this.getBlock(x, y - 1, z);
      const ok = id === B.SUGAR_CANE
        ? (below === B.SUGAR_CANE || below === B.GRASS_BLOCK || below === B.DIRT || below === B.SAND)
        : id === B.CACTUS
          ? (below === B.CACTUS || below === B.SAND || below === B.RED_SAND)
          : IS_SOLID[below];
      if (!ok) { this.breakBlockNaturally(x, y, z); return; }
    }

    // Wall torches need the block they are attached to.
    if (id === B.WALL_TORCH) {
      const face = this.getMeta(x, y, z) & 7;
      const [dx, dy, dz] = FACE_OFFSETS[face] || [0, -1, 0];
      if (!IS_SOLID[this.getBlock(x - dx, y - dy, z - dz)]) { this.breakBlockNaturally(x, y, z); return; }
    }

    // A door's other half goes with it.
    if (id === B.OAK_DOOR_UPPER && this.getBlock(x, y - 1, z) !== B.OAK_DOOR_LOWER) {
      this.setBlock(x, y, z, B.AIR); return;
    }
    if (id === B.OAK_DOOR_LOWER && this.getBlock(x, y + 1, z) !== B.OAK_DOOR_UPPER) {
      this.breakBlockNaturally(x, y, z); return;
    }

    if (BLOCKS[id].gravity) this.scheduleTick(x, y, z, 2);
    if (IS_FLUID[id]) this.scheduleTick(x, y, z, id === B.WATER ? 5 : 30);
  }

  /** Breaks a block and drops its item, as if it decayed. */
  breakBlockNaturally(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id === B.AIR) return;
    this.setBlock(x, y, z, B.AIR);
    this.emit('blockBroken', { x, y, z, id, natural: true });
  }

  scheduleTick(x, y, z, delay) {
    const at = this.totalTicks + Math.max(1, delay);
    // Avoid piling up duplicate updates for the same block.
    for (const t of this.scheduledTicks) {
      if (t.x === x && t.y === y && t.z === z) return;
    }
    this.scheduledTicks.push({ x, y, z, at });
  }

  // ================================================================ collision

  /**
   * Collects the collision boxes of every solid block overlapping `box`.
   * Returns an array of AABBs in world coordinates.
   */
  getCollisionBoxes(box, out = []) {
    out.length = 0;
    const x0 = Math.floor(box.minX), x1 = Math.floor(box.maxX);
    const y0 = Math.floor(box.minY), y1 = Math.floor(box.maxY);
    const z0 = Math.floor(box.minZ), z1 = Math.floor(box.maxZ);
    for (let y = y0; y <= y1; y++) {
      if (y < MIN_Y || y > MAX_Y) continue;
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = this.getBlock(x, y, z);
          if (id === B.AIR || !IS_SOLID[id]) continue;
          const boxes = this.blockCollisionBoxes(x, y, z, id);
          for (const b of boxes) if (b.intersects(box)) out.push(b);
        }
      }
    }
    return out;
  }

  /** The collision shape of one block, in world coordinates. */
  blockCollisionBoxes(x, y, z, id = this.getBlock(x, y, z)) {
    const rt = RENDER_TYPE[id];
    switch (rt) {
      case RenderType.SLAB: {
        const top = (this.getMeta(x, y, z) & 1) === 1;
        return [new AABB(x, y + (top ? 0.5 : 0), z, x + 1, y + (top ? 1 : 0.5), z + 1)];
      }
      case RenderType.CARPET:
        return [new AABB(x, y, z, x + 1, y + 1 / 16, z + 1)];
      case RenderType.SNOW_LAYER: {
        const layers = (this.getMeta(x, y, z) & 7) + 1;
        if (layers <= 1) return [];
        return [new AABB(x, y, z, x + 1, y + layers / 8, z + 1)];
      }
      case RenderType.FENCE:
        return [new AABB(x + 0.375, y, z + 0.375, x + 0.625, y + 1.5, z + 0.625)];
      case RenderType.PANE:
        return [new AABB(x + 0.4375, y, z + 0.4375, x + 0.5625, y + 1, z + 0.5625)];
      case RenderType.STAIRS: {
        const meta = this.getMeta(x, y, z);
        const facing = meta & 3;
        const top = (meta & 4) !== 0;
        const base = top
          ? new AABB(x, y + 0.5, z, x + 1, y + 1, z + 1)
          : new AABB(x, y, z, x + 1, y + 0.5, z + 1);
        // The upper step occupies half the block on the facing side.
        const half = top
          ? new AABB(x, y, z, x + 1, y + 0.5, z + 1)
          : new AABB(x, y + 0.5, z, x + 1, y + 1, z + 1);
        const step = facing === 0 ? new AABB(x + 0.5, half.minY, z, x + 1, half.maxY, z + 1)
          : facing === 1 ? new AABB(x, half.minY, z, x + 0.5, half.maxY, z + 1)
            : facing === 2 ? new AABB(x, half.minY, z + 0.5, x + 1, half.maxY, z + 1)
              : new AABB(x, half.minY, z, x + 1, half.maxY, z + 0.5);
        return [base, step];
      }
      case RenderType.DOOR: {
        const meta = this.getMeta(x, y, z);
        const open = (meta & 4) !== 0;
        const facing = meta & 3;
        const t = 3 / 16;
        if (open) {
          return facing === 0 || facing === 1
            ? [new AABB(x, y, z, x + 1, y + 1, z + t)]
            : [new AABB(x, y, z, x + t, y + 1, z + 1)];
        }
        return facing === 0 ? [new AABB(x, y, z, x + t, y + 1, z + 1)]
          : facing === 1 ? [new AABB(x + 1 - t, y, z, x + 1, y + 1, z + 1)]
            : facing === 2 ? [new AABB(x, y, z, x + 1, y + 1, z + t)]
              : [new AABB(x, y, z + 1 - t, x + 1, y + 1, z + 1)];
      }
      case RenderType.BED:
        return [new AABB(x, y, z, x + 1, y + 9 / 16, z + 1)];
      default: {
        if (id === B.CACTUS) return [new AABB(x + 1 / 16, y, z + 1 / 16, x + 15 / 16, y + 1, z + 15 / 16)];
        if (id === B.CHEST) return [new AABB(x + 1 / 16, y, z + 1 / 16, x + 15 / 16, y + 14 / 16, z + 15 / 16)];
        return [new AABB(x, y, z, x + 1, y + 1, z + 1)];
      }
    }
  }

  /** True when any block overlapping `box` matches `predicate`. */
  anyBlockIn(box, predicate) {
    const x0 = Math.floor(box.minX), x1 = Math.floor(box.maxX);
    const y0 = Math.floor(box.minY), y1 = Math.floor(box.maxY);
    const z0 = Math.floor(box.minZ), z1 = Math.floor(box.maxZ);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = this.getBlock(x, y, z);
          if (predicate(id, x, y, z)) return true;
        }
      }
    }
    return false;
  }

  isFluidAt(x, y, z) { return IS_FLUID[this.getBlock(x, y, z)]; }

  /** Slipperiness of the block the entity is standing on. */
  slipperinessAt(x, y, z) {
    const id = this.getBlock(Math.floor(x), Math.floor(y) - 1, Math.floor(z));
    return SLIPPERINESS[id] || 0.6;
  }

  isClimbable(x, y, z) { return !!IS_CLIMBABLE[this.getBlock(x, y, z)]; }

  contactDamageIn(box) {
    let worst = 0;
    this.anyBlockIn(box, (id) => { worst = Math.max(worst, CONTACT_DAMAGE[id]); return false; });
    return worst;
  }

  /** True when `pos` is a legal place to stand: solid below, 2 free above. */
  canStandAt(x, y, z) {
    return IS_SOLID[this.getBlock(x, y - 1, z)] &&
           !IS_SOLID[this.getBlock(x, y, z)] &&
           !IS_SOLID[this.getBlock(x, y + 1, z)];
  }

  /** Finds a safe spawn Y at a column, searching down from the surface. */
  findSpawnY(x, z, startY = 120) {
    for (let y = Math.min(startY, MAX_Y - 2); y > MIN_Y + 1; y--) {
      if (this.canStandAt(x, y, z) && !IS_FLUID[this.getBlock(x, y - 1, z)]) return y;
    }
    return WORLD.SEA_LEVEL + 1;
  }

  // ================================================================ raycast

  /**
   * Amanatides-Woo voxel traversal.
   * @returns {{x,y,z,face,blockId,hitPos:[number,number,number],distance:number}|null}
   */
  raycast(origin, dir, maxDistance = 5, opts = {}) {
    const includeFluids = !!opts.includeFluids;
    const filter = opts.filter || null;

    let x = Math.floor(origin[0]), y = Math.floor(origin[1]), z = Math.floor(origin[2]);
    const dx = dir[0], dy = dir[1], dz = dir[2];
    const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);

    const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

    const boundary = (o, i, step) => (step > 0 ? i + 1 - o : o - i);
    let tMaxX = stepX !== 0 ? boundary(origin[0], x, stepX) * tDeltaX : Infinity;
    let tMaxY = stepY !== 0 ? boundary(origin[1], y, stepY) * tDeltaY : Infinity;
    let tMaxZ = stepZ !== 0 ? boundary(origin[2], z, stepZ) * tDeltaZ : Infinity;

    let face = -1;
    let t = 0;

    for (let i = 0; i < 512; i++) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && (includeFluids || !IS_FLUID[id]) && (!filter || filter(id, x, y, z))) {
        const rt = RENDER_TYPE[id];
        // Non-cube shapes need a precise test so you cannot mine a torch from
        // across the room by clipping the corner of its voxel.
        const boxes = rt === RenderType.CROSS || rt === RenderType.CROP || rt === RenderType.TORCH
          ? [new AABB(x + 0.3, y, z + 0.3, x + 0.7, y + 0.8, z + 0.7)]
          : this.blockCollisionBoxes(x, y, z, id);
        const hit = boxes.length === 0
          ? { t, face }
          : rayBoxes(origin, dir, boxes, maxDistance);
        if (hit) {
          const ht = hit.t ?? t;
          return {
            x, y, z,
            face: hit.face >= 0 ? hit.face : face,
            blockId: id,
            distance: ht,
            hitPos: [origin[0] + dx * ht, origin[1] + dy * ht, origin[2] + dz * ht],
          };
        }
      }

      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        if (tMaxX > maxDistance) break;
        x += stepX; t = tMaxX; tMaxX += tDeltaX; face = stepX > 0 ? 1 : 0;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > maxDistance) break;
        y += stepY; t = tMaxY; tMaxY += tDeltaY; face = stepY > 0 ? 3 : 2;
      } else {
        if (tMaxZ > maxDistance) break;
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = stepZ > 0 ? 5 : 4;
      }
      if (y < MIN_Y - 1 || y > MAX_Y + 1) break;
    }
    return null;
  }

  /** Nearest entity hit by a ray, for melee targeting. */
  raycastEntities(origin, dir, maxDistance, exclude = null) {
    let best = null, bestT = maxDistance;
    for (const e of this.entities) {
      if (e === exclude || e.dead || e.noHit) continue;
      const box = e.getBoundingBox().grow(0.1);
      const hit = rayBox(origin, dir, box);
      if (hit && hit.t >= 0 && hit.t < bestT) { bestT = hit.t; best = { entity: e, t: hit.t }; }
    }
    return best;
  }

  // ================================================================ entities

  addEntity(entity) {
    entity.id = this.nextEntityId++;
    entity.world = this;
    this.entities.push(entity);
    this.entitiesById.set(entity.id, entity);
    this.emit('entityAdded', entity);
    return entity;
  }

  removeEntity(entity) {
    const i = this.entities.indexOf(entity);
    if (i >= 0) this.entities.splice(i, 1);
    this.entitiesById.delete(entity.id);
    this.emit('entityRemoved', entity);
  }

  getEntity(id) { return this.entitiesById.get(id) || null; }

  entitiesIn(box, filter = null) {
    const out = [];
    for (const e of this.entities) {
      if (e.dead) continue;
      if (filter && !filter(e)) continue;
      if (e.getBoundingBox().intersects(box)) out.push(e);
    }
    return out;
  }

  entitiesNear(x, y, z, radius, filter = null) {
    const r2 = radius * radius;
    const out = [];
    for (const e of this.entities) {
      if (e.dead) continue;
      if (filter && !filter(e)) continue;
      const dx = e.x - x, dy = e.y - y, dz = e.z - z;
      if (dx * dx + dy * dy + dz * dz <= r2) out.push(e);
    }
    return out;
  }

  nearestEntity(x, y, z, radius, filter = null) {
    let best = null, bestD = radius * radius;
    for (const e of this.entities) {
      if (e.dead) continue;
      if (filter && !filter(e)) continue;
      const dx = e.x - x, dy = e.y - y, dz = e.z - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // ================================================================ tick

  tick(deltaTicks = 1) {
    for (let i = 0; i < deltaTicks; i++) this.tickOnce();
  }

  tickOnce() {
    this.totalTicks++;
    if (this.doDaylightCycle) this.timeOfDay = (this.timeOfDay + 1) % WORLD.DAY_LENGTH_TICKS;

    // --- scheduled block updates ---
    if (this.scheduledTicks.length) {
      const due = [];
      const pending = [];
      for (const t of this.scheduledTicks) (t.at <= this.totalTicks ? due : pending).push(t);
      this.scheduledTicks = pending;
      for (const t of due) this.emit('scheduledTick', t);
    }

    // --- entities ---
    this.stats.entitiesTicked = 0;
    // Iterate a copy: entities may spawn or remove others while ticking.
    const snapshot = this.entities.slice();
    for (const e of snapshot) {
      if (e.dead) continue;
      e.tick();
      this.stats.entitiesTicked++;
    }
    for (let i = this.entities.length - 1; i >= 0; i--) {
      if (this.entities[i].dead) this.removeEntity(this.entities[i]);
    }

    this.emit('tick', this.totalTicks);
  }

  /** Random block ticks in the chunks around a position (crops, grass spread). */
  randomTick(centerX, centerZ, radius, handler) {
    const speed = WORLD.RANDOM_TICK_SPEED;
    for (const c of this.chunksAround(centerX, centerZ, radius)) {
      for (let si = 0; si < c.sections.length; si++) {
        const s = c.sections[si];
        if (!s || s.nonAir === 0) continue;
        const baseY = Chunk.sectionBaseY(si);
        for (let k = 0; k < speed; k++) {
          const x = this.rng.below(16), y = this.rng.below(16), z = this.rng.below(16);
          const id = s.blocks[((y & 15) << 8) | ((z & 15) << 4) | (x & 15)];
          if (id === B.AIR) continue;
          handler(c.x0 + x, baseY + y, c.z0 + z, id);
        }
      }
    }
  }

  // ================================================================ save

  serialize(opts = {}) {
    const chunks = [];
    for (const c of this.chunks.values()) {
      if (opts.onlyModified && !c.version) continue;
      chunks.push(c.serialize());
    }
    return {
      seed: this.seed,
      timeOfDay: this.timeOfDay,
      totalTicks: this.totalTicks,
      difficulty: this.difficulty,
      chunks,
    };
  }

  loadSerialized(data) {
    this.seed = data.seed >>> 0;
    this.timeOfDay = data.timeOfDay ?? 1000;
    this.totalTicks = data.totalTicks ?? 0;
    this.difficulty = data.difficulty || 'normal';
    this.chunks.clear();
    for (const cd of data.chunks || []) this.addChunk(Chunk.deserialize(cd));
    return this;
  }
}

// ================================================================ ray helpers

/** Slab-method ray/AABB intersection. Returns { t, face } or null. */
export function rayBox(origin, dir, box) {
  let tmin = -Infinity, tmax = Infinity;
  let face = -1;
  const lo = [box.minX, box.minY, box.minZ];
  const hi = [box.maxX, box.maxY, box.maxZ];
  const axisFace = [[1, 0], [3, 2], [5, 4]];   // [negFace, posFace] per axis

  for (let a = 0; a < 3; a++) {
    const d = dir[a];
    if (Math.abs(d) < 1e-9) {
      if (origin[a] < lo[a] || origin[a] > hi[a]) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (lo[a] - origin[a]) * inv;
    let t2 = (hi[a] - origin[a]) * inv;
    let f = d > 0 ? axisFace[a][0] : axisFace[a][1];
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) { tmin = t1; face = f; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: tmin < 0 ? 0 : tmin, face };
}

function rayBoxes(origin, dir, boxes, maxDistance) {
  let best = null;
  for (const b of boxes) {
    const hit = rayBox(origin, dir, b);
    if (hit && hit.t <= maxDistance && (!best || hit.t < best.t)) best = hit;
  }
  return best;
}
