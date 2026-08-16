// Hand-placed structures: the Emberhold village, the ruined tower and the
// Deep Hollow boss dungeon. Every block goes through `world.setBlockFast`, and
// every random choice comes from the seeded `Random` the caller hands in.

import { WORLD } from '../core/constants.js';
import { Random, hash2 } from '../core/rng.js';
import { B } from './blocks.js';
import { MIN_Y, MAX_Y } from './chunk.js';

// ---------------------------------------------------------------- conventions
// Facing codes match the shapes in `world.blockCollisionBoxes`: for stairs the
// code names the side the *tall* half sits on, for doors the wall edge the
// panel is flush with, for beds the direction from the foot to the head.

const EAST = 0, WEST = 1, SOUTH = 2, NORTH = 3;   // +X, -X, +Z, -Z

const DOOR_UPPER = 8;      // free bit; the collision code only reads 0..2
const SLAB_TOP = 1;

/** One 90-degree clockwise turn applied to a facing code. */
const ROT_FACING = [SOUTH, NORTH, WEST, EAST];
/** The same turn applied to a 6-way FACE index (used by wall torches). */
const ROT_FACE6 = [4, 5, 2, 3, 1, 0];
/** Step vector per facing code. */
const FACING_STEP = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const SEA = WORLD.SEA_LEVEL;
/** How far a foundation is allowed to reach before we accept it has bottomed out. */
const FILL_DEPTH = 28;

/** Blocks a structure may overwrite, and that never count as solid ground. */
const SOFT = new Set([
  B.AIR, B.WATER, B.LAVA, B.SNOW_LAYER, B.COBWEB,
  B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES,
  B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG,
  B.GRASS_PLANT, B.TALL_GRASS, B.FERN, B.DEAD_BUSH, B.DANDELION, B.POPPY,
  B.BLUE_ORCHID, B.CORNFLOWER, B.RED_MUSHROOM, B.BROWN_MUSHROOM,
  B.CACTUS, B.SUGAR_CANE, B.WHEAT, B.OAK_SAPLING, B.VINE, B.LILY_PAD,
]);

/** Blocks that read as "the top of the terrain" when we probe a column. */
const GROUND = new Set([
  B.GRASS_BLOCK, B.DIRT, B.COARSE_DIRT, B.PODZOL, B.MYCELIUM, B.WITHERED_GRASS,
  B.STONE, B.GRANITE, B.DIORITE, B.ANDESITE, B.DEEPSLATE, B.WITHERED_STONE,
  B.SAND, B.RED_SAND, B.SANDSTONE, B.GRAVEL, B.CLAY, B.SNOW_BLOCK,
  B.COBBLESTONE, B.MOSSY_COBBLESTONE, B.STONE_BRICKS, B.VILLAGE_PATH,
  B.FARMLAND, B.FARMLAND_WET,
]);

// ---------------------------------------------------------------- primitives

function set(world, x, y, z, id, meta = 0) {
  if (y < MIN_Y || y > MAX_Y) return;
  world.setBlockFast(x, y, z, id, meta);
}

/** Only writes where there is nothing solid yet, so decoration never eats walls. */
function setSoft(world, x, y, z, id, meta = 0) {
  if (y < MIN_Y || y > MAX_Y) return;
  if (!SOFT.has(world.getBlock(x, y, z))) return;
  world.setBlockFast(x, y, z, id, meta);
}

/**
 * The y of the topmost ground block of a column. Prefers the generator's cheap
 * noise probe because a structure often spills into chunks that have no blocks
 * in them yet.
 */
function terrainY(world, x, z) {
  const g = world.generator;
  if (g && typeof g.surfaceHeight === 'function') {
    const y = g.surfaceHeight(x, z);
    if (Number.isFinite(y)) return Math.max(MIN_Y + 4, Math.min(MAX_Y - 24, Math.floor(y)));
  }
  const c = world.getChunk(x >> 4, z >> 4);
  if (c) {
    let y = Math.min(MAX_Y, c.getHeight(x & 15, z & 15));
    for (let n = 0; n < 200 && y > MIN_Y; n++, y--) {
      if (GROUND.has(c.getBlock(x & 15, y, z & 15))) return y;
    }
  }
  return SEA;
}

/** Median terrain height over a rectangle — the level a footprint gets cut to. */
function levelOf(world, x0, z0, x1, z1) {
  const samples = [];
  const stepX = Math.max(1, (x1 - x0) >> 2);
  const stepZ = Math.max(1, (z1 - z0) >> 2);
  for (let z = z0; z <= z1; z += stepZ) {
    for (let x = x0; x <= x1; x += stepX) samples.push(terrainY(world, x, z));
  }
  samples.sort((a, b) => a - b);
  const y = samples[samples.length >> 1];
  // Never sink a building into the sea: the story wants dry feet.
  return Math.max(y, SEA + 1);
}

/** Packs earth under a column until it meets something that will hold it up. */
function underpin(world, x, yTop, z, id) {
  for (let y = yTop, n = 0; y > MIN_Y && n < FILL_DEPTH; y--, n++) {
    if (!SOFT.has(world.getBlock(x, y, z))) return;
    set(world, x, y, z, id, 0);
  }
}

function flattenColumn(world, x, z, y, surfaceId, clearHeight, fillId) {
  set(world, x, y, z, surfaceId, 0);
  for (let yy = y + 1; yy <= y + clearHeight; yy++) {
    if (world.getBlock(x, yy, z) !== B.AIR) set(world, x, yy, z, B.AIR, 0);
  }
  underpin(world, x, y - 1, z, fillId);
}

function flattenArea(world, x0, z0, x1, z1, y, surfaceId, clearHeight = 9, fillId = B.DIRT) {
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      set(world, x, y, z, surfaceId, 0);
      for (let yy = y + 1; yy <= y + clearHeight; yy++) {
        if (world.getBlock(x, yy, z) !== B.AIR) set(world, x, yy, z, B.AIR, 0);
      }
      underpin(world, x, y - 1, z, fillId);
    }
  }
}

function fillBox(world, x0, y0, z0, x1, y1, z1, id, meta = 0) {
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) set(world, x, y, z, id, meta);
    }
  }
}

/** Hollow box: walls only, interior untouched. */
function shellBox(world, x0, y0, z0, x1, y1, z1, pick) {
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (x > x0 && x < x1 && y > y0 && y < y1 && z > z0 && z < z1) continue;
        set(world, x, y, z, pick(x, y, z), 0);
      }
    }
  }
}

// Re-entrancy guard: ensureArea can ask the generator for chunks, and the
// generator is what called us in the first place.
const _ensuring = new Set();

/**
 * Makes sure the terrain a structure is about to carve actually exists. Village
 * generation runs from one chunk's populate pass but writes across several.
 */
function ensureArea(world, x0, z0, x1, z1) {
  const g = world.generator;
  for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) {
    for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) {
      const chunk = world.getOrCreateChunk(cx, cz);
      if (chunk.generated || !g || typeof g.generateChunk !== 'function') continue;
      const key = `${cx},${cz}`;
      if (_ensuring.has(key)) continue;
      _ensuring.add(key);
      try { g.generateChunk(chunk); } finally { _ensuring.delete(key); }
    }
  }
}

/** Puts the touched chunks back in a state the lighting and mesher trust. */
function finishArea(world, x0, z0, x1, z1) {
  for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) {
    for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) {
      const chunk = world.getChunk(cx, cz);
      if (!chunk) continue;
      chunk.recomputeHeightMap();
      chunk.lit = false;
      chunk.lightDirty = true;
      chunk.markAllDirty();
    }
  }
}

// ---------------------------------------------------------------- templates

/**
 * Small hand-authored layouts. `layers[y][z]` is a string indexed by x, `.` and
 * a space leave whatever is already there. A palette entry is either a block id
 * or `[id, meta]`.
 */
export const TEMPLATES = {
  // A cobblestone well with a flush pool, four fence posts and a slab canopy.
  // Placed with its origin four blocks below the plaza so the shaft is lined.
  well: {
    w: 5, d: 5,
    palette: {
      C: B.COBBLESTONE, M: B.MOSSY_COBBLESTONE, w: B.WATER,
      f: B.OAK_FENCE, s: [B.OAK_SLAB, 0],
    },
    layers: [
      ['CCCCC', 'CCCCC', 'CCMCC', 'CCCCC', 'CCCCC'],
      ['CCCCC', 'CwwwC', 'MwwwC', 'CwwwC', 'CCCCC'],
      ['CCMCC', 'CwwwC', 'CwwwM', 'CwwwC', 'CCCCC'],
      ['CCCCC', 'MwwwC', 'CwwwC', 'CwwwM', 'CCMCC'],
      ['CMCCC', 'CwwwC', 'CwwwC', 'CwwwC', 'CCCMC'],
      ['f...f', '.....', '.....', '.....', 'f...f'],
      ['f...f', '.....', '.....', '.....', 'f...f'],
      ['sssss', 'sssss', 'sssss', 'sssss', 'sssss'],
    ],
  },

  // The beacon dais. Stairs on all four sides so the pedestal is reachable.
  dais: {
    w: 5, d: 5,
    palette: {
      K: B.STONE_BRICKS, M: B.MOSSY_STONE_BRICKS, C: B.CHISELED_STONE_BRICKS,
      P: B.BEACON_PEDESTAL,
      n: [B.STONE_BRICK_STAIRS, NORTH], s: [B.STONE_BRICK_STAIRS, SOUTH],
      e: [B.STONE_BRICK_STAIRS, EAST], w: [B.STONE_BRICK_STAIRS, WEST],
    },
    layers: [
      ['KKKKK', 'KMKKK', 'KKKMK', 'KKKKK', 'KMKKK'],
      ['..s..', '.KKK.', 'eKKKw', '.KKK.', '..n..'],
      ['.....', '.C.C.', '..P..', '.C.C.', '.....'],
    ],
  },

  // Plaza lighting. The lit variant is what quest 7 swaps these to.
  lamp_post: {
    w: 1, d: 1,
    palette: { C: B.COBBLESTONE, f: B.OAK_FENCE, L: B.EMBER_LANTERN },
    layers: [['C'], ['f'], ['f'], ['L']],
  },

  torch_post: {
    w: 1, d: 1,
    palette: { C: B.COBBLESTONE, f: B.OAK_FENCE, T: B.TORCH },
    layers: [['C'], ['f'], ['f'], ['T']],
  },

  // Farm-yard hay, stacked so it reads as stored harvest rather than a cube.
  hay_stack: {
    w: 3, d: 3,
    palette: { H: B.HAY_BLOCK },
    layers: [
      ['HHH', 'HHH', 'HHH'],
      ['HH.', 'HHH', '.HH'],
      ['...', '.H.', '...'],
    ],
  },

  // Collapsed masonry, scattered around the ruined tower.
  rubble: {
    w: 3, d: 3,
    palette: { C: B.COBBLESTONE, M: B.MOSSY_COBBLESTONE, K: B.CRACKED_STONE_BRICKS },
    layers: [
      ['M.C', 'CKM', '.MC'],
      ['...', '.M.', '...'],
    ],
  },

  // The mouth of the dungeon stair. The 3x3 core is left untouched so the
  // shaft below stays open; the gap is the far (+Z) row.
  ruin_arch: {
    w: 5, d: 5,
    palette: {
      K: B.STONE_BRICKS, M: B.MOSSY_STONE_BRICKS, R: B.CRACKED_STONE_BRICKS,
      U: B.RUNE_STONE,
    },
    layers: [
      ['KMKRK', 'K...M', 'R...K', 'K...R', 'K...K'],
      ['KURUK', 'M...K', 'K...R', 'R...M', 'K...K'],
      ['KKMKK', 'R...M', 'K...K', 'M...R', 'K...K'],
    ],
  },
};

// ---------------------------------------------------------------- placement

function rotOffset(lx, lz, w, d, r) {
  switch (r) {
    case 1: return [d - 1 - lz, lx];
    case 2: return [w - 1 - lx, d - 1 - lz];
    case 3: return [lz, w - 1 - lx];
    default: return [lx, lz];
  }
}

function rotateMeta(id, meta, r) {
  if (r === 0) return meta;
  if (id === B.WALL_TORCH) {
    let f = meta & 7;
    for (let i = 0; i < r; i++) f = ROT_FACE6[f] ?? f;
    return (meta & ~7) | f;
  }
  if (id === B.OAK_STAIRS || id === B.COBBLESTONE_STAIRS || id === B.STONE_BRICK_STAIRS ||
      id === B.OAK_DOOR_LOWER || id === B.OAK_DOOR_UPPER ||
      id === B.BED_FOOT || id === B.BED_HEAD) {
    let f = meta & 3;
    for (let i = 0; i < r; i++) f = ROT_FACING[f];
    return (meta & ~3) | f;
  }
  return meta;
}

/**
 * Stamps a template with its minimum corner at (x, y, z).
 * @param {number} rotation 0..3, quarter turns clockwise seen from above.
 */
export function placeStructure(world, x, y, z, template, rotation = 0) {
  const t = typeof template === 'string' ? TEMPLATES[template] : template;
  if (!t || !t.layers) return null;
  const r = ((rotation | 0) % 4 + 4) % 4;
  const w = t.w, d = t.d;

  for (let ly = 0; ly < t.layers.length; ly++) {
    const layer = t.layers[ly];
    for (let lz = 0; lz < d; lz++) {
      const row = layer[lz] || '';
      for (let lx = 0; lx < w; lx++) {
        const ch = row[lx];
        if (!ch || ch === '.' || ch === ' ') continue;
        const entry = t.palette[ch];
        if (entry === undefined) continue;
        const id = Array.isArray(entry) ? entry[0] : entry;
        const meta = Array.isArray(entry) ? (entry[1] | 0) : 0;
        const [rx, rz] = rotOffset(lx, lz, w, d, r);
        set(world, x + rx, y + ly, z + rz, id, rotateMeta(id, meta, r));
      }
    }
  }
  return {
    x, y, z,
    w: (r & 1) ? d : w,
    d: (r & 1) ? w : d,
    h: t.layers.length,
  };
}

// ---------------------------------------------------------------- siting

/** Chunks between village grid cells, and how far a village may drift inside one. */
const VILLAGE_SPACING = 24;

/**
 * Deterministic village siting. `x`/`z` are **chunk** coordinates; the result is
 * the chunk the village in that grid cell is centred on, or null when the cell
 * is empty. A given seed always answers the same way.
 */
export function villageAt(x, z, seed) {
  const rx = Math.floor(x / VILLAGE_SPACING);
  const rz = Math.floor(z / VILLAGE_SPACING);
  const r = new Random(hash2(rx, rz, (seed >>> 0) ^ 0x5e11a6e));
  // The origin cell always holds one: story mode wakes the player in it.
  const home = rx === 0 && rz === 0;
  if (!home && r.next() > 0.7) return null;
  const span = home ? 3 : VILLAGE_SPACING - 9;
  return {
    x: rx * VILLAGE_SPACING + r.below(span),
    z: rz * VILLAGE_SPACING + r.below(span),
  };
}

// ---------------------------------------------------------------- containers

/**
 * Block-entity payloads are plain JSON so `Chunk.serialize` can carry them.
 * Shape: { kind, items: (slot|null)[] } with slot = { item, count, damage }.
 */
function makeContainer(kind, size) {
  return { kind, size, items: new Array(size).fill(null) };
}

function rollLoot(rng, table, minRolls, maxRolls, size = 27) {
  const box = makeContainer('chest', size);
  const weights = table.map((e) => e.weight ?? 1);
  const slots = [];
  for (let i = 0; i < size; i++) slots.push(i);
  rng.shuffle(slots);
  const rolls = rng.int(minRolls, maxRolls);
  for (let i = 0; i < rolls; i++) {
    const e = table[rng.weighted(weights)];
    box.items[slots[i]] = { item: e.item, count: rng.int(e.min ?? 1, e.max ?? 1), damage: 0 };
  }
  return box;
}

function placeChest(world, x, y, z, contents) {
  set(world, x, y, z, B.CHEST, 0);
  world.setBlockEntity(x, y, z, contents);
}

function placeFurnace(world, x, y, z, lit, fuel) {
  set(world, x, y, z, lit ? B.FURNACE_LIT : B.FURNACE, 0);
  const be = makeContainer('furnace', 3);
  if (fuel) be.items[1] = { item: fuel.item, count: fuel.count, damage: 0 };
  be.burnTicks = lit ? 600 : 0;
  be.cookTicks = 0;
  world.setBlockEntity(x, y, z, be);
}

const SMITH_LOOT = [
  { item: 'iron_ingot', min: 2, max: 5, weight: 4 },
  { item: 'coal', min: 2, max: 6, weight: 5 },
  { item: 'bread', min: 1, max: 3, weight: 3 },
  { item: 'stick', min: 2, max: 6, weight: 3 },
  { item: 'iron_pickaxe', min: 1, max: 1, weight: 1 },
  { item: 'flint_and_steel', min: 1, max: 1, weight: 1 },
  { item: 'ember_shard', min: 1, max: 2, weight: 2 },
];

const TOWER_LOOT = [
  { item: 'book', min: 1, max: 3, weight: 4 },
  { item: 'paper', min: 2, max: 6, weight: 4 },
  { item: 'golden_apple', min: 1, max: 1, weight: 1 },
  { item: 'iron_ingot', min: 1, max: 3, weight: 3 },
  { item: 'ember_shard', min: 1, max: 3, weight: 3 },
  { item: 'bone', min: 1, max: 4, weight: 3 },
  { item: 'string', min: 1, max: 4, weight: 3 },
];

const DUNGEON_LOOT = [
  { item: 'diamond', min: 1, max: 2, weight: 1 },
  { item: 'gold_ingot', min: 1, max: 4, weight: 3 },
  { item: 'iron_ingot', min: 2, max: 5, weight: 4 },
  { item: 'golden_apple', min: 1, max: 1, weight: 2 },
  { item: 'bone', min: 2, max: 6, weight: 4 },
  { item: 'gunpowder', min: 1, max: 4, weight: 3 },
  { item: 'ember_shard', min: 2, max: 4, weight: 3 },
  { item: 'bread', min: 1, max: 3, weight: 3 },
];

// ---------------------------------------------------------------- buildings

/** Wall plate, corner posts, gable roof — shared by all three house varieties. */
function buildGableRoof(world, x0, z0, x1, z1, roofY) {
  const w = x1 - x0 + 1, d = z1 - z0 + 1;
  // A flat plank ceiling first: the roof cavity must never open into the room.
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) set(world, x, roofY, z, B.OAK_PLANKS, 0);
  }

  const alongX = w >= d;
  const put = (u, y, v, id, meta) => {
    if (alongX) set(world, u, y, v, id, meta);
    else set(world, v, y, u, id, meta);
  };

  const span = alongX ? d : w;              // odd by construction, so the ridge meets
  const half = (span + 1) >> 1;
  const u0 = (alongX ? x0 : z0) - 1;
  const u1 = (alongX ? x1 : z1) + 1;

  for (let k = 0; k <= half; k++) {
    const y = roofY + k;
    const a = (alongX ? z0 : x0) - 1 + k;
    const b = (alongX ? z1 : x1) + 1 - k;
    for (let u = u0; u <= u1; u++) {
      const gableEnd = (u === u0 || u === u1);
      if (a < b) {
        put(u, y, a, B.OAK_STAIRS, alongX ? SOUTH : EAST);
        put(u, y, b, B.OAK_STAIRS, alongX ? NORTH : WEST);
        if (gableEnd) for (let v = a + 1; v < b; v++) put(u, y, v, B.OAK_PLANKS, 0);
      } else if (a === b) {
        put(u, y, a, B.OAK_LOG, 0);         // ridge beam
      }
    }
  }
}

/** Every perimeter tile of a rectangle, in walk order. */
function perimeter(x0, z0, x1, z1) {
  const out = [];
  for (let x = x0; x <= x1; x++) out.push([x, z0]);
  for (let z = z0 + 1; z <= z1; z++) out.push([x1, z]);
  for (let x = x1 - 1; x >= x0; x--) out.push([x, z1]);
  for (let z = z1 - 1; z > z0; z--) out.push([x0, z]);
  return out;
}

/**
 * Builds one house. `plan` carries the footprint, the floor level and which
 * wall the door is cut into; the caller has already sited it.
 */
function buildHouse(world, rng, plan) {
  const { x0, z0, x1, z1, floorY, height, kind, doorSide } = plan;
  const wallTop = floorY + height;
  const roofY = wallTop + 1;

  // 1. Cut the ground flat, one block wider than the walls so the eaves clear.
  flattenArea(world, x0 - 2, z0 - 2, x1 + 2, z1 + 2, floorY, B.GRASS_BLOCK, height + 8);

  // 2. Foundation. Cobble across the footprint, driven down to solid ground
  //    under the walls so the house never hangs over a slope.
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) set(world, x, floorY, z, B.COBBLESTONE, 0);
  }
  for (const [px, pz] of perimeter(x0, z0, x1, z1)) {
    underpin(world, px, floorY - 1, pz, B.COBBLESTONE);
  }
  // Plank floor inside the cobble plinth.
  for (let z = z0 + 1; z <= z1 - 1; z++) {
    for (let x = x0 + 1; x <= x1 - 1; x++) set(world, x, floorY, z, B.OAK_PLANKS, 0);
  }
  // 3. Hollow the room out.
  fillBox(world, x0 + 1, floorY + 1, z0 + 1, x1 - 1, wallTop, z1 - 1, B.AIR, 0);

  // 4. Walls: cobble base course, planks above, log corners and a log plate.
  const ring = perimeter(x0, z0, x1, z1);
  const corners = new Set([`${x0},${z0}`, `${x1},${z0}`, `${x0},${z1}`, `${x1},${z1}`]);
  for (const [px, pz] of ring) {
    const corner = corners.has(`${px},${pz}`);
    for (let y = floorY + 1; y <= wallTop; y++) {
      let id = B.OAK_PLANKS;
      if (corner) id = B.OAK_LOG;
      else if (y === floorY + 1) id = B.COBBLESTONE;
      else if (y === wallTop) id = B.OAK_LOG;
      set(world, px, y, pz, id, 0);
    }
  }

  // 5. Windows: a glass pane every third wall tile, at eye height.
  const winY = floorY + 3;
  for (let i = 0; i < ring.length; i++) {
    const [px, pz] = ring[i];
    if (corners.has(`${px},${pz}`)) continue;
    if (i % 3 !== 1) continue;
    if (px === plan.doorX && pz === plan.doorZ) continue;
    if (winY >= wallTop) continue;
    set(world, px, winY, pz, B.GLASS_PANE, 0);
  }

  // 6. Door. Both halves carry the same facing so the collision shapes agree.
  const dm = doorSide;
  set(world, plan.doorX, floorY + 1, plan.doorZ, B.OAK_DOOR_LOWER, dm);
  set(world, plan.doorX, floorY + 2, plan.doorZ, B.OAK_DOOR_UPPER, dm | DOOR_UPPER);
  if (winY > floorY + 2) set(world, plan.doorX, winY, plan.doorZ, B.OAK_PLANKS, 0);
  // A landing step outside so the doorway is never a one-block drop.
  const [odx, odz] = FACING_STEP[doorSide];
  set(world, plan.doorX + odx, floorY, plan.doorZ + odz, B.VILLAGE_PATH, 0);
  underpin(world, plan.doorX + odx, floorY - 1, plan.doorZ + odz, B.DIRT);
  fillBox(world, plan.doorX + odx, floorY + 1, plan.doorZ + odz,
    plan.doorX + odx, floorY + 3, plan.doorZ + odz, B.AIR, 0);
  // Porch torch, hung on the wall block beside the doorway.
  const [sdx, sdz] = odx !== 0 ? [0, 1] : [1, 0];
  const braceX = plan.doorX + sdx, braceZ = plan.doorZ + sdz;
  const porchFace = odx > 0 ? 0 : odx < 0 ? 1 : odz > 0 ? 4 : 5;
  setSoft(world, braceX + odx, floorY + 3, braceZ + odz, B.WALL_TORCH, porchFace);

  // 7. Roof.
  buildGableRoof(world, x0, z0, x1, z1, roofY);

  // 8. Furnish. Everything is keyed off the corner furthest from the door so
  //    nothing ever lands in the doorway.
  const ix0 = x0 + 1, iz0 = z0 + 1, ix1 = x1 - 1, iz1 = z1 - 1;
  const farX = plan.doorX - x0 < x1 - plan.doorX ? ix1 : ix0;
  const farZ = plan.doorZ - z0 < z1 - plan.doorZ ? iz1 : iz0;
  const midX = (x0 + x1) >> 1, midZ = (z0 + z1) >> 1;

  // Bed, laid along the longer interior axis.
  const bedAlongX = (ix1 - ix0) >= (iz1 - iz0);
  const bedFacing = bedAlongX ? (farX === ix1 ? WEST : EAST) : (farZ === iz1 ? NORTH : SOUTH);
  const [bdx, bdz] = FACING_STEP[bedFacing];
  const bedX = farX, bedZ = farZ;
  set(world, bedX, floorY + 1, bedZ, B.BED_FOOT, bedFacing);
  set(world, bedX + bdx, floorY + 1, bedZ + bdz, B.BED_HEAD, bedFacing);

  // Crafting table in the opposite corner, with a carpet between them.
  const craftX = farX === ix1 ? ix0 : ix1;
  const craftZ = farZ === iz1 ? iz0 : iz1;
  set(world, craftX, floorY + 1, craftZ, B.CRAFTING_TABLE, 0);
  setSoft(world, midX, floorY + 1, midZ, B.RED_CARPET, 0);

  // Interior torch on the wall opposite the door.
  const oppFace = doorSide ^ 1;
  const [tdx, tdz] = FACING_STEP[oppFace];
  const tx = tdx > 0 ? ix1 : tdx < 0 ? ix0 : midX;
  const tz = tdz > 0 ? iz1 : tdz < 0 ? iz0 : midZ;
  const inFace = tdx > 0 ? 1 : tdx < 0 ? 0 : tdz > 0 ? 5 : 4;
  setSoft(world, tx, floorY + 3, tz, B.WALL_TORCH, inFace);

  const info = {
    kind, x0, z0, x1, z1, floorY,
    center: [midX + 0.5, floorY + 1, midZ + 0.5],
    door: [plan.doorX + 0.5, floorY + 1, plan.doorZ + 0.5],
    doorOutside: [plan.doorX + odx + 0.5, floorY + 1, plan.doorZ + odz + 0.5],
    bed: [bedX + 0.5, floorY + 1, bedZ + 0.5],
  };

  if (kind === 'large_house') {
    // A scholar's room: shelves, a second bed and a lantern on the table.
    const shelfZ = farZ === iz1 ? iz0 : iz1;
    for (let x = ix0; x <= ix1; x++) {
      if (x === craftX) continue;
      if (rng.bool(0.55)) set(world, x, floorY + 1, shelfZ, B.BOOKSHELF, 0);
      if (rng.bool(0.3)) set(world, x, floorY + 2, shelfZ, B.BOOKSHELF, 0);
    }
    const bed2Facing = bedFacing ^ 1;
    const [b2x, b2z] = FACING_STEP[bed2Facing];
    const alt = bedAlongX ? [farX === ix1 ? ix0 : ix1, farZ] : [farX, farZ === iz1 ? iz0 : iz1];
    if (world.getBlock(alt[0], floorY + 1, alt[1]) === B.AIR &&
        world.getBlock(alt[0] + b2x, floorY + 1, alt[1] + b2z) === B.AIR) {
      set(world, alt[0], floorY + 1, alt[1], B.BED_FOOT, bed2Facing);
      set(world, alt[0] + b2x, floorY + 1, alt[1] + b2z, B.BED_HEAD, bed2Facing);
    }
  }

  if (kind === 'blacksmith') {
    // Forge wall: two furnaces, an ingot pile and the loot chest.
    const forgeFace = doorSide ^ 1;
    const [fdx, fdz] = FACING_STEP[forgeFace];
    const fx = fdx > 0 ? ix1 : fdx < 0 ? ix0 : midX;
    const fz = fdz > 0 ? iz1 : fdz < 0 ? iz0 : midZ;
    const [px, pz] = fdx !== 0 ? [0, 1] : [1, 0];
    placeFurnace(world, fx, floorY + 1, fz, true, { item: 'coal', count: rng.int(3, 9) });
    placeFurnace(world, fx - px, floorY + 1, fz - pz, false, { item: 'charcoal', count: rng.int(1, 4) });
    set(world, fx + px, floorY + 1, fz + pz, B.IRON_BLOCK, 0);
    set(world, fx + px, floorY + 2, fz + pz, B.STONE_SLAB, SLAB_TOP);

    const chestX = craftX, chestZ = farZ === iz1 ? iz1 : iz0;
    placeChest(world, chestX, floorY + 1, chestZ, rollLoot(rng, SMITH_LOOT, 4, 7));
    info.chest = [chestX, floorY + 1, chestZ];

    // The yard: a sunken lava pit behind a fence, on the far side from the plaza.
    const [ydx, ydz] = FACING_STEP[forgeFace];
    const yx0 = ydx > 0 ? x1 + 2 : ydx < 0 ? x0 - 8 : x0 - 1;
    const yx1 = ydx > 0 ? x1 + 8 : ydx < 0 ? x0 - 2 : x1 + 1;
    const yz0 = ydz > 0 ? z1 + 2 : ydz < 0 ? z0 - 8 : z0 - 1;
    const yz1 = ydz > 0 ? z1 + 8 : ydz < 0 ? z0 - 2 : z1 + 1;
    buildForgeYard(world, rng, yx0, yz0, yx1, yz1, floorY);
    info.yard = [yx0, yz0, yx1, yz1];
  }

  return info;
}

/** Fenced yard with a sunken lava pit — the blacksmith's quench and forge fire. */
function buildForgeYard(world, rng, x0, z0, x1, z1, floorY) {
  flattenArea(world, x0, z0, x1, z1, floorY, B.COARSE_DIRT, 8);
  const cx = (x0 + x1) >> 1, cz = (z0 + z1) >> 1;

  // Lined basin first, so nothing ever sits over open lava. The surface ends up
  // one block below the yard, which is what keeps it a hazard and not a trap.
  fillBox(world, cx - 2, floorY - 3, cz - 2, cx + 2, floorY, cz + 2, B.COBBLESTONE, 0);
  fillBox(world, cx - 1, floorY - 2, cz - 1, cx + 1, floorY, cz + 1, B.AIR, 0);
  fillBox(world, cx - 1, floorY - 2, cz - 1, cx + 1, floorY - 1, cz + 1, B.LAVA, 0);

  // Fence ring with one gap so the yard is enterable.
  const ring = perimeter(x0, z0, x1, z1);
  const gap = rng.below(ring.length);
  for (let i = 0; i < ring.length; i++) {
    if (i === gap || i === (gap + 1) % ring.length) continue;
    const [px, pz] = ring[i];
    set(world, px, floorY + 1, pz, B.OAK_FENCE, 0);
  }
  // Corner posts carry torches so the yard reads at night.
  for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    set(world, px, floorY + 1, pz, B.COBBLESTONE, 0);
    set(world, px, floorY + 2, pz, B.OAK_FENCE, 0);
    set(world, px, floorY + 3, pz, B.TORCH, 0);
  }
  // Working clutter: a quench slab and scattered fuel.
  setSoft(world, Math.min(cx + 3, x1 - 1), floorY + 1, cz, B.STONE_SLAB, SLAB_TOP);
  for (let i = 0; i < 4; i++) {
    const px = rng.int(x0 + 1, x1 - 1), pz = rng.int(z0 + 1, z1 - 1);
    if (Math.abs(px - cx) <= 2 && Math.abs(pz - cz) <= 2) continue;
    setSoft(world, px, floorY + 1, pz, rng.bool(0.5) ? B.COAL_BLOCK : B.COBBLESTONE, 0);
  }
}

/** Wheat field: a flush water channel, wet farmland, a fence and stored hay. */
function buildFarm(world, rng, x0, z0, x1, z1, y) {
  flattenArea(world, x0 - 1, z0 - 1, x1 + 1, z1 + 1, y, B.GRASS_BLOCK, 8);
  const channel = (z0 + z1) >> 1;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      if (z === channel) {
        set(world, x, y, z, B.WATER, 0);
        set(world, x, y - 1, z, B.CLAY, 0);
        continue;
      }
      set(world, x, y, z, B.FARMLAND_WET, 0);
      set(world, x, y - 1, z, B.DIRT, 0);
      // A field is never uniformly ripe.
      if (rng.bool(0.88)) set(world, x, y + 1, z, B.WHEAT, rng.int(4, 7));
      else set(world, x, y + 1, z, B.AIR, 0);
    }
  }

  const ring = perimeter(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
  const gate = ring.length >> 2;
  for (let i = 0; i < ring.length; i++) {
    const [px, pz] = ring[i];
    set(world, px, y, pz, B.DIRT, 0);          // seals the water channel in
    if (i === gate || i === gate + 1) continue;
    set(world, px, y + 1, pz, B.OAK_FENCE, 0);
  }
  set(world, x0 - 1, y + 2, z0 - 1, B.TORCH, 0);
  set(world, x1 + 1, y + 2, z1 + 1, B.TORCH, 0);

  // Stored harvest just outside the gate.
  const hx = x1 + 3, hz = z0 - 1;
  flattenArea(world, hx, hz, hx + 2, hz + 2, y, B.COARSE_DIRT, 6);
  placeStructure(world, hx, y + 1, hz, TEMPLATES.hay_stack, rng.below(4));

  return { x0, z0, x1, z1, y, channel };
}

/**
 * Lays a walkable path between two points, ramping at most one block per tile
 * so it is always climbable, and skipping anything a building already owns.
 */
function layPath(world, ax, az, ay, bx, bz, by, blocked) {
  const tiles = [];
  let cx = ax, cz = az;
  while (cx !== bx || cz !== bz) {
    tiles.push([cx, cz]);
    if (Math.abs(bx - cx) >= Math.abs(bz - cz) && cx !== bx) cx += Math.sign(bx - cx);
    else if (cz !== bz) cz += Math.sign(bz - cz);
    else cx += Math.sign(bx - cx);
    if (tiles.length > 160) break;
  }
  tiles.push([bx, bz]);

  let y = ay;
  for (let i = 0; i < tiles.length; i++) {
    const t = i / Math.max(1, tiles.length - 1);
    const want = Math.round(ay + (by - ay) * t);
    y += Math.sign(want - y) * Math.min(1, Math.abs(want - y));
    const [px, pz] = tiles[i];
    if (blocked && blocked(px, pz)) continue;
    flattenColumn(world, px, pz, y, B.VILLAGE_PATH, 5, B.DIRT);
    // A shoulder either side keeps the route readable and walkable.
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const sx = px + ox, sz = pz + oz;
      if (blocked && blocked(sx, sz)) continue;
      if (GROUND.has(world.getBlock(sx, y, sz)) || SOFT.has(world.getBlock(sx, y, sz))) {
        flattenColumn(world, sx, sz, y, B.GRASS_BLOCK, 4, B.DIRT);
      }
    }
  }
}

// ---------------------------------------------------------------- village

const HOUSE_KINDS = {
  small_house: { long: 7, short: 5, height: 4 },
  large_house: { long: 9, short: 7, height: 5 },
  blacksmith: { long: 9, short: 7, height: 4 },
};

/**
 * Emberhold. A plaza with a well and the beacon dais, six to eight buildings on
 * connecting paths, and two wheat fields on the outskirts.
 * @returns {{center:number[], buildings:object[], npcSpawns:object[]}}
 */
export function generateVillage(world, cx, cz, rng) {
  const ox = cx * 16 + 8, oz = cz * 16 + 8;
  const reach = 40;
  ensureArea(world, ox - reach, oz - reach, ox + reach, oz + reach);

  const layout = rng.fork('emberhold:layout');
  const detail = rng.fork('emberhold:detail');
  const loot = rng.fork('emberhold:loot');

  const baseY = levelOf(world, ox - 8, oz - 8, ox + 8, oz + 8);
  const plazaR = 9;

  // --- plaza -------------------------------------------------------------
  for (let z = oz - plazaR; z <= oz + plazaR; z++) {
    for (let x = ox - plazaR; x <= ox + plazaR; x++) {
      const dx = x - ox, dz = z - oz;
      const d2 = dx * dx + dz * dz;
      if (d2 > plazaR * plazaR) continue;
      const edge = d2 > (plazaR - 2) * (plazaR - 2);
      const surface = edge && detail.bool(0.45) ? B.GRASS_BLOCK : B.VILLAGE_PATH;
      flattenColumn(world, x, z, baseY, surface, 8, B.DIRT);
    }
  }

  // --- beacon dais at the exact centre -----------------------------------
  placeStructure(world, ox - 2, baseY, oz - 2, TEMPLATES.dais, 0);
  const pedestal = [ox, baseY + 2, oz];
  for (const [lx, lz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
    placeStructure(world, ox + lx, baseY, oz + lz, TEMPLATES.lamp_post, 0);
  }
  for (const [lx, lz] of [[-7, 0], [7, 0], [0, -7], [0, 7]]) {
    placeStructure(world, ox + lx, baseY, oz + lz, TEMPLATES.torch_post, 0);
  }

  // --- well, off to one side of the dais ---------------------------------
  const wellX = ox + 6, wellZ = oz - 6;
  flattenArea(world, wellX - 3, wellZ - 3, wellX + 3, wellZ + 3, baseY, B.VILLAGE_PATH, 8);
  placeStructure(world, wellX - 2, baseY - 4, wellZ - 2, TEMPLATES.well, 0);
  const wellPos = [wellX + 0.5, baseY + 1, wellZ + 0.5];

  // --- buildings ---------------------------------------------------------
  const order = ['blacksmith', 'large_house', 'small_house', 'small_house',
    'large_house', 'small_house', 'small_house', 'small_house'];
  const wanted = layout.int(6, 8);
  const rects = [];
  const buildings = [];

  for (let i = 0; i < wanted; i++) {
    const kind = order[i];
    const dims = HOUSE_KINDS[kind];
    let placed = null;

    for (let attempt = 0; attempt < 8 && !placed; attempt++) {
      const angle = (i / wanted) * Math.PI * 2 + layout.float(-0.28, 0.28);
      const radius = layout.int(15, 20) + (kind === 'blacksmith' ? 2 : 0);
      const bxc = ox + Math.round(Math.cos(angle) * radius);
      const bzc = oz + Math.round(Math.sin(angle) * radius);
      const dirX = bxc - ox, dirZ = bzc - oz;

      // The door always faces the plaza, and always sits on a long wall.
      let w, d, doorSide;
      if (Math.abs(dirX) >= Math.abs(dirZ)) {
        w = dims.short; d = dims.long;
        doorSide = dirX > 0 ? WEST : EAST;
      } else {
        w = dims.long; d = dims.short;
        doorSide = dirZ > 0 ? NORTH : SOUTH;
      }
      const x0 = bxc - (w >> 1), z0 = bzc - (d >> 1);
      const x1 = x0 + w - 1, z1 = z0 + d - 1;

      // Keep clear of the plaza and of everything already standing.
      if (Math.hypot(bxc - ox, bzc - oz) < plazaR + 4) continue;
      let clash = false;
      for (const r of rects) {
        if (x0 - 5 <= r.x1 && x1 + 5 >= r.x0 && z0 - 5 <= r.z1 && z1 + 5 >= r.z0) { clash = true; break; }
      }
      if (clash) continue;

      const floorY = levelOf(world, x0 - 1, z0 - 1, x1 + 1, z1 + 1);
      const doorX = doorSide === WEST ? x0 : doorSide === EAST ? x1 : (x0 + x1) >> 1;
      const doorZ = doorSide === NORTH ? z0 : doorSide === SOUTH ? z1 : (z0 + z1) >> 1;

      placed = { kind, x0, z0, x1, z1, floorY, height: dims.height, doorSide, doorX, doorZ };
    }

    if (!placed) continue;
    rects.push({ x0: placed.x0, z0: placed.z0, x1: placed.x1, z1: placed.z1 });
    buildings.push(buildHouse(world, detail, placed));
  }

  // --- paths --------------------------------------------------------------
  const inside = (px, pz) => {
    for (const r of rects) {
      if (px >= r.x0 - 1 && px <= r.x1 + 1 && pz >= r.z0 - 1 && pz <= r.z1 + 1) return true;
    }
    return false;
  };
  for (const b of buildings) {
    const sx = Math.floor(b.doorOutside[0]), sz = Math.floor(b.doorOutside[2]);
    const ang = Math.atan2(sz - oz, sx - ox);
    const tx = ox + Math.round(Math.cos(ang) * (plazaR - 2));
    const tz = oz + Math.round(Math.sin(ang) * (plazaR - 2));
    layPath(world, sx, sz, b.floorY, tx, tz, baseY, inside);
  }

  // --- farm plots ---------------------------------------------------------
  const farms = [];
  for (let f = 0; f < 2; f++) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = layout.float(0, Math.PI * 2);
      const radius = layout.int(22, 27);
      const fx = ox + Math.round(Math.cos(angle) * radius);
      const fz = oz + Math.round(Math.sin(angle) * radius);
      const x0 = fx - 4, z0 = fz - 3, x1 = fx + 4, z1 = fz + 3;
      let clash = false;
      for (const r of rects) {
        if (x0 - 5 <= r.x1 && x1 + 5 >= r.x0 && z0 - 5 <= r.z1 && z1 + 5 >= r.z0) { clash = true; break; }
      }
      if (clash) continue;
      const y = levelOf(world, x0 - 1, z0 - 1, x1 + 1, z1 + 1);
      farms.push(buildFarm(world, detail, x0, z0, x1, z1, y));
      rects.push({ x0: x0 - 2, z0: z0 - 2, x1: x1 + 4, z1: z1 + 4 });
      const ang = Math.atan2(fz - oz, fx - ox);
      layPath(world, fx, z0 - 2, y, ox + Math.round(Math.cos(ang) * (plazaR - 2)),
        oz + Math.round(Math.sin(ang) * (plazaR - 2)), baseY, inside);
      break;
    }
  }

  // A cache by the well: the story's first bread and torches come from here.
  placeChest(world, wellX - 2, baseY + 1, wellZ + 2,
    rollLoot(loot, [
      { item: 'bread', min: 2, max: 4, weight: 4 },
      { item: 'torch', min: 3, max: 8, weight: 4 },
      { item: 'wheat_seeds', min: 2, max: 5, weight: 3 },
      { item: 'apple', min: 1, max: 3, weight: 2 },
    ], 3, 4));

  // --- named NPC posts ----------------------------------------------------
  const smith = buildings.find((b) => b.kind === 'blacksmith');
  const large = buildings.find((b) => b.kind === 'large_house');
  const npcSpawns = [
    {
      role: 'elder', name: 'Elder Sowmi', dialogueId: 'elder_sowmi',
      x: ox + 3.5, y: baseY + 1, z: oz + 0.5, yaw: 90,
    },
    {
      role: 'blacksmith', name: 'Torvin', dialogueId: 'torvin',
      x: smith ? smith.doorOutside[0] : ox + 12.5,
      y: smith ? smith.floorY + 1 : baseY + 1,
      z: smith ? smith.doorOutside[2] : oz + 0.5,
      yaw: 0,
    },
    {
      role: 'scholar', name: 'Mira', dialogueId: 'mira',
      x: large ? large.center[0] : ox - 12.5,
      y: large ? large.floorY + 1 : baseY + 1,
      z: large ? large.center[2] : oz + 0.5,
      yaw: 180,
    },
    {
      role: 'child', name: 'Pim', dialogueId: 'pim',
      x: wellPos[0] + 1.5, y: baseY + 1, z: wellPos[2] + 1.5, yaw: 225,
    },
  ];

  finishArea(world, ox - reach, oz - reach, ox + reach, oz + reach);

  return {
    center: [ox + 0.5, baseY + 1, oz + 0.5],
    pedestal,
    well: wellPos,
    plazaRadius: plazaR,
    bounds: [ox - reach, oz - reach, ox + reach, oz + reach],
    buildings,
    farms,
    npcSpawns,
  };
}

// ---------------------------------------------------------------- ruined tower

/** Weighted masonry mix — the higher the block, the more weathered it looks. */
function ruinBlock(rng, decay) {
  const r = rng.next();
  if (r < 0.18 + decay * 0.3) return B.CRACKED_STONE_BRICKS;
  if (r < 0.34 + decay * 0.4) return B.MOSSY_STONE_BRICKS;
  return B.STONE_BRICKS;
}

/**
 * A broken spire: 7x7 outer wall, a spiral stair hugging the inner face, and a
 * chest on the landing at the top. Quest 5's journal lives in that chest.
 * @returns {{center:number[], lootPos:number[]}}
 */
export function generateRuinedTower(world, x, z, rng) {
  ensureArea(world, x - 12, z - 12, x + 12, z + 12);
  const stone = rng.fork('tower:stone');
  const trash = rng.fork('tower:trash');
  const loot = rng.fork('tower:loot');

  const baseY = levelOf(world, x - 3, z - 3, x + 3, z + 3);
  const height = rng.int(12, 16);
  const breakY = baseY + height - rng.int(2, 5);

  const ox0 = x - 3, oz0 = z - 3, ox1 = x + 3, oz1 = z + 3;
  flattenArea(world, ox0 - 2, oz0 - 2, ox1 + 2, oz1 + 2, baseY, B.COARSE_DIRT, height + 6);

  // Floor and foundation.
  for (let pz = oz0; pz <= oz1; pz++) {
    for (let px = ox0; px <= ox1; px++) {
      set(world, px, baseY, pz, ruinBlock(stone, 0), 0);
      underpin(world, px, baseY - 1, pz, B.COBBLESTONE);
    }
  }
  // Hollow the shaft.
  fillBox(world, ox0 + 1, baseY + 1, oz0 + 1, ox1 - 1, baseY + height + 2, oz1 - 1, B.AIR, 0);

  // Walls, thinning out above the break line.
  const ring = perimeter(ox0, oz0, ox1, oz1);
  for (let y = baseY + 1; y <= baseY + height; y++) {
    const decay = Math.max(0, (y - baseY) / height);
    const survive = y <= breakY ? 1 : Math.max(0.15, 1 - (y - breakY) * 0.28);
    for (const [px, pz] of ring) {
      if (stone.next() > survive) { set(world, px, y, pz, B.AIR, 0); continue; }
      set(world, px, y, pz, ruinBlock(stone, decay), 0);
    }
  }
  // Doorway on the -Z face, two tall.
  fillBox(world, x, baseY + 1, oz0, x, baseY + 2, oz0, B.AIR, 0);
  set(world, x - 1, baseY + 3, z - 3, B.CRACKED_STONE_BRICKS, 0);
  set(world, x + 1, baseY + 3, z - 3, B.CRACKED_STONE_BRICKS, 0);
  // Arrow slits, one per storey on alternating faces.
  for (let y = baseY + 5; y < breakY; y += 4) {
    set(world, ox1, y, z, B.AIR, 0);
    set(world, ox0, y + 2 < breakY ? y + 2 : y, z, B.AIR, 0);
  }

  // Spiral stair on the inner ring: 16 tiles per turn around an open well.
  const inner = perimeter(ox0 + 1, oz0 + 1, ox1 - 1, oz1 - 1);
  const start = inner.findIndex(([px, pz]) => px === x && pz === oz0 + 1);
  const landingY = baseY + height - 3;
  const steps = Math.max(4, landingY - 1 - baseY);
  let last = null, lastFacing = EAST;

  for (let i = 0; i < steps; i++) {
    const a = inner[(start + i) % inner.length];
    const b = inner[(start + i + 1) % inner.length];
    const facing = b[0] > a[0] ? EAST : b[0] < a[0] ? WEST : b[1] > a[1] ? SOUTH : NORTH;
    const y = baseY + 1 + i;
    set(world, a[0], y, a[1], B.STONE_BRICK_STAIRS, facing);
    fillBox(world, a[0], y + 1, a[1], a[0], y + 3, a[1], B.AIR, 0);
    // Landings every second turn keep the open well from being a death drop.
    if (i > 0 && i % 16 === 8) {
      for (let pz = oz0 + 2; pz <= oz1 - 2; pz++) {
        for (let px = ox0 + 2; px <= ox1 - 2; px++) set(world, px, y, pz, B.STONE_BRICKS, 0);
      }
    }
    if (i % 6 === 3) {
      const wallDx = a[0] === ox0 + 1 ? -1 : a[0] === ox1 - 1 ? 1 : 0;
      const wallDz = a[1] === oz0 + 1 ? -1 : a[1] === oz1 - 1 ? 1 : 0;
      if (wallDx !== 0 && wallDz === 0) {
        setSoft(world, a[0], y + 2, a[1], B.WALL_TORCH, wallDx > 0 ? 1 : 0);
      } else if (wallDz !== 0 && wallDx === 0) {
        setSoft(world, a[0], y + 2, a[1], B.WALL_TORCH, wallDz > 0 ? 5 : 4);
      }
    }
    last = a; lastFacing = facing;
  }

  // Top landing: floor the whole inner square, then re-cut the last step so the
  // climb out is smooth rather than a one-block hop.
  const topY = baseY + 1 + steps;
  for (let pz = oz0 + 1; pz <= oz1 - 1; pz++) {
    for (let px = ox0 + 1; px <= ox1 - 1; px++) set(world, px, topY, pz, B.STONE_BRICKS, 0);
  }
  if (last) {
    const nxt = inner[(start + steps) % inner.length];
    set(world, nxt[0], topY, nxt[1], B.STONE_BRICK_STAIRS, lastFacing);
  }
  fillBox(world, ox0 + 1, topY + 1, oz0 + 1, ox1 - 1, topY + 4, oz1 - 1, B.AIR, 0);

  // Broken parapet.
  for (const [px, pz] of ring) {
    if (stone.bool(0.55)) set(world, px, topY + 1, pz, ruinBlock(stone, 1), 0);
    if (stone.bool(0.2)) set(world, px, topY + 2, pz, B.CRACKED_STONE_BRICKS, 0);
  }

  // Cobwebs and litter through the shaft.
  for (let i = 0; i < 26; i++) {
    const px = trash.int(ox0 + 1, ox1 - 1);
    const pz = trash.int(oz0 + 1, oz1 - 1);
    const py = trash.int(baseY + 2, topY);
    setSoft(world, px, py, pz, B.COBWEB, 0);
  }
  for (let i = 0; i < 4; i++) {
    const px = x + trash.int(-9, 9), pz = z + trash.int(-9, 9);
    if (Math.abs(px - x) <= 4 && Math.abs(pz - z) <= 4) continue;
    const py = levelOf(world, px, pz, px + 2, pz + 2);
    placeStructure(world, px, py + 1, pz, TEMPLATES.rubble, trash.below(4));
  }

  // The chest, tucked against the far wall of the landing.
  const lootX = last && last[0] === ox1 - 1 ? ox0 + 1 : ox1 - 1;
  const lootZ = last && last[1] === oz1 - 1 ? oz0 + 1 : oz1 - 1;
  const chest = rollLoot(loot, TOWER_LOOT, 4, 7);
  chest.items[13] = { item: 'miras_journal', count: 1, damage: 0 };
  placeChest(world, lootX, topY + 1, lootZ, chest);
  setSoft(world, x, topY + 1, z, B.TORCH, 0);

  finishArea(world, x - 12, z - 12, x + 12, z + 12);

  return {
    center: [x + 0.5, baseY + 1, z + 0.5],
    lootPos: [lootX, topY + 1, lootZ],
    top: [x + 0.5, topY + 1, z + 0.5],
    height,
  };
}

// ---------------------------------------------------------------- dungeon

function dungeonBlock(rng) {
  const r = rng.next();
  if (r < 0.45) return B.MOSSY_COBBLESTONE;
  if (r < 0.8) return B.COBBLESTONE;
  if (r < 0.93) return B.MOSSY_STONE_BRICKS;
  return B.CRACKED_STONE_BRICKS;
}

/**
 * The Deep Hollow: a sealed 15x7x15 mossy chamber with an arena floor, corner
 * pillars, lava alcoves and a spawner — plus the lit spiral shaft that is the
 * only way in.
 * @returns {{center:number[], spawnerPos:number[], chests:number[][]}}
 */
export function generateDungeon(world, x, y, z, rng) {
  const shaftX = x, shaftZ = z - 16;
  ensureArea(world, x - 14, z - 22, x + 14, z + 14);

  const stone = rng.fork('hollow:stone');
  const trash = rng.fork('hollow:trash');
  const loot = rng.fork('hollow:loot');

  const surfaceY = levelOf(world, shaftX - 3, shaftZ - 3, shaftX + 3, shaftZ + 3);
  // Keep the chamber genuinely deep, and off the bedrock.
  const floorY = Math.max(MIN_Y + 6, Math.min(y | 0, surfaceY - 20));
  const ceilY = floorY + 8;               // 7 blocks of interior headroom

  const x0 = x - 8, x1 = x + 8, z0 = z - 8, z1 = z + 8;

  // --- shell -------------------------------------------------------------
  shellBox(world, x0, floorY, z0, x1, ceilY, z1, () => dungeonBlock(stone));
  fillBox(world, x0 + 1, floorY + 1, z0 + 1, x1 - 1, ceilY - 1, z1 - 1, B.AIR, 0);
  // Arena floor: mossy cobble with a stone-brick fighting ring.
  for (let pz = z0 + 1; pz <= z1 - 1; pz++) {
    for (let px = x0 + 1; px <= x1 - 1; px++) {
      const r2 = (px - x) * (px - x) + (pz - z) * (pz - z);
      const id = r2 <= 25 ? (stone.bool(0.7) ? B.STONE_BRICKS : B.MOSSY_STONE_BRICKS)
        : dungeonBlock(stone);
      set(world, px, floorY, pz, id, 0);
    }
  }

  // --- pillars -----------------------------------------------------------
  for (const [px, pz] of [[x - 5, z - 5], [x + 5, z - 5], [x - 5, z + 5], [x + 5, z + 5]]) {
    for (let py = floorY + 1; py <= ceilY - 1; py++) {
      set(world, px, py, pz, py === floorY + 1 || py === ceilY - 1
        ? B.CHISELED_STONE_BRICKS : (stone.bool(0.35) ? B.MOSSY_STONE_BRICKS : B.STONE_BRICKS), 0);
    }
    // Torches on the two faces that look into the arena.
    const fx = px < x ? 0 : 1;
    const fz = pz < z ? 4 : 5;
    setSoft(world, px + (px < x ? 1 : -1), floorY + 3, pz, B.WALL_TORCH, fx);
    setSoft(world, px, floorY + 3, pz + (pz < z ? 1 : -1), B.WALL_TORCH, fz);
  }

  // --- lava alcoves, one per wall ----------------------------------------
  const alcoves = [
    [x, z0, 0, -1], [x, z1, 0, 1], [x0, z, -1, 0], [x1, z, 1, 0],
  ];
  for (const [ax, az, dx, dz] of alcoves) {
    const px = (lateral, depth) => ax + (dx !== 0 ? dx * depth : lateral);
    const pz = (lateral, depth) => az + (dz !== 0 ? dz * depth : lateral);
    // Shell around the recess first, so nothing leaks into the surrounding rock.
    for (let lat = -2; lat <= 2; lat++) {
      for (let depth = 0; depth <= 3; depth++) {
        for (let py = floorY - 2; py <= floorY + 4; py++) {
          set(world, px(lat, depth), py, pz(lat, depth), dungeonBlock(stone), 0);
        }
      }
    }
    // Recess: a cobble ledge you can stand on, then the lava behind it.
    for (let lat = -1; lat <= 1; lat++) {
      for (let depth = 0; depth <= 2; depth++) {
        fillBox(world, px(lat, depth), floorY + 1, pz(lat, depth),
          px(lat, depth), floorY + 3, pz(lat, depth), B.AIR, 0);
        set(world, px(lat, depth), floorY, pz(lat, depth), B.COBBLESTONE, 0);
      }
      set(world, px(lat, 1), floorY, pz(lat, 1), B.LAVA, 0);
      set(world, px(lat, 2), floorY, pz(lat, 2), B.LAVA, 0);
      // Bars across the mouth so the fight never ends in a lava bath.
      set(world, px(lat, 0), floorY + 1, pz(lat, 0), B.IRON_BARS, 0);
      set(world, px(lat, 0), floorY + 2, pz(lat, 0), B.IRON_BARS, 0);
      set(world, px(lat, 0), floorY + 3, pz(lat, 0), B.IRON_BARS, 0);
    }
  }

  // --- spawner shrine at the back ----------------------------------------
  const spX = x, spZ = z + 5;
  for (let pz = spZ - 1; pz <= spZ + 1; pz++) {
    for (let px = spX - 1; px <= spX + 1; px++) set(world, px, floorY + 1, pz, B.MOSSY_STONE_BRICKS, 0);
  }
  set(world, spX, floorY + 2, spZ, B.MONSTER_SPAWNER, 0);
  world.setBlockEntity(spX, floorY + 2, spZ, {
    kind: 'spawner', mob: 'withered_husk',
    delay: 40, minDelay: 200, maxDelay: 700, count: 3, range: 5, requiredPlayerRange: 14,
  });
  for (const [rx, rz] of [[-2, 0], [2, 0], [0, 2]]) {
    set(world, spX + rx, floorY + 1, spZ + rz, B.RUNE_STONE, 0);
  }

  // --- loot ---------------------------------------------------------------
  const chests = [];
  for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) {
    if (!loot.bool(0.75)) continue;
    const px = x + dx, pz = z + dz;
    placeChest(world, px, floorY + 1, pz, rollLoot(loot, DUNGEON_LOOT, 4, 8));
    chests.push([px, floorY + 1, pz]);
  }
  if (chests.length === 0) {
    placeChest(world, x - 6, floorY + 1, z - 6, rollLoot(loot, DUNGEON_LOOT, 5, 8));
    chests.push([x - 6, floorY + 1, z - 6]);
  }

  // Atmosphere: cobwebs in the corners, bones on the floor.
  for (let i = 0; i < 40; i++) {
    const px = trash.int(x0 + 1, x1 - 1), pz = trash.int(z0 + 1, z1 - 1);
    if (Math.abs(px - x) < 4 && Math.abs(pz - z) < 4) continue;
    setSoft(world, px, trash.int(floorY + 1, ceilY - 1), pz, B.COBWEB, 0);
  }

  // --- the way in ---------------------------------------------------------
  buildEntranceShaft(world, stone, shaftX, shaftZ, surfaceY, floorY);
  buildCorridor(world, stone, x, floorY, shaftZ + 2, z0);

  finishArea(world, x - 14, z - 22, x + 14, z + 14);

  return {
    center: [x + 0.5, floorY + 1, z + 0.5],
    spawnerPos: [spX, floorY + 2, spZ],
    chests,
    entrance: [shaftX + 0.5, surfaceY + 1, shaftZ + 0.5],
    floorY,
    bounds: [x0, floorY, z0, x1, ceilY, z1],
  };
}

/**
 * A 5x5 lined shaft with a solid newel and a torch-lit spiral of stone stairs,
 * dropping from a ruined arch on the surface to the corridor floor.
 */
function buildEntranceShaft(world, rng, sx, sz, surfaceY, floorY) {
  const x0 = sx - 2, x1 = sx + 2, z0 = sz - 2, z1 = sz + 2;
  flattenArea(world, x0 - 2, z0 - 2, x1 + 2, z1 + 2, surfaceY, B.COARSE_DIRT, 8);

  // Lining and newel.
  for (let y = floorY - 1; y <= surfaceY + 2; y++) {
    for (const [px, pz] of perimeter(x0, z0, x1, z1)) {
      set(world, px, y, pz, y > surfaceY ? B.STONE_BRICKS : dungeonBlock(rng), 0);
    }
    set(world, sx, y, sz, B.COBBLESTONE, 0);
  }
  fillBox(world, x0 + 1, floorY, z0 + 1, x1 - 1, surfaceY + 2, z1 - 1, B.AIR, 0);
  set(world, sx, floorY, sz, B.STONE_BRICKS, 0);
  for (let pz = z0 + 1; pz <= z1 - 1; pz++) {
    for (let px = x0 + 1; px <= x1 - 1; px++) set(world, px, floorY, pz, B.STONE_BRICKS, 0);
  }
  for (let y = floorY; y <= surfaceY; y++) set(world, sx, y, sz, B.COBBLESTONE, 0);

  // Descending spiral: eight ring tiles per turn, one block down per tile.
  const ring = perimeter(x0 + 1, z0 + 1, x1 - 1, z1 - 1);
  const start = ring.findIndex(([px, pz]) => px === sx && pz === z0 + 1);
  const drop = Math.max(1, surfaceY - floorY - 1);
  for (let i = 0; i <= drop; i++) {
    const a = ring[(start + i) % ring.length];
    const b = ring[(start + i + 1) % ring.length];
    const travel = b[0] > a[0] ? EAST : b[0] < a[0] ? WEST : b[1] > a[1] ? SOUTH : NORTH;
    const y = surfaceY - i;
    if (y <= floorY) break;
    // Descending, so the tall half faces back the way you came.
    set(world, a[0], y, a[1], B.STONE_BRICK_STAIRS, travel ^ 1);
    if (i % 4 === 2) {
      const wx = a[0] === x0 + 1 ? -1 : a[0] === x1 - 1 ? 1 : 0;
      const wz = a[1] === z0 + 1 ? -1 : a[1] === z1 - 1 ? 1 : 0;
      if (wx !== 0 && wz === 0) setSoft(world, a[0], y + 3, a[1], B.WALL_TORCH, wx > 0 ? 1 : 0);
      else if (wz !== 0 && wx === 0) setSoft(world, a[0], y + 3, a[1], B.WALL_TORCH, wz > 0 ? 5 : 4);
    }
  }

  // Surface arch, opening toward the dungeon.
  placeStructure(world, x0, surfaceY + 1, z0 + 1, TEMPLATES.ruin_arch, 0);
  fillBox(world, sx - 1, surfaceY + 1, z1, sx + 1, surfaceY + 3, z1 + 1, B.AIR, 0);
  set(world, x0 - 1, surfaceY + 2, z1 + 1, B.TORCH, 0);
  set(world, x1 + 1, surfaceY + 2, z1 + 1, B.TORCH, 0);
}

/** Lined 3x3 corridor joining the shaft to the chamber, with a runic doorway. */
function buildCorridor(world, rng, x, floorY, fromZ, toZ) {
  for (let z = fromZ; z <= toZ; z++) {
    for (let py = floorY - 1; py <= floorY + 4; py++) {
      for (let px = x - 2; px <= x + 2; px++) set(world, px, py, z, dungeonBlock(rng), 0);
    }
    fillBox(world, x - 1, floorY + 1, z, x + 1, floorY + 3, z, B.AIR, 0);
    for (let px = x - 1; px <= x + 1; px++) set(world, px, floorY, z, B.STONE_BRICKS, 0);
    if ((z - fromZ) % 5 === 2) {
      setSoft(world, x - 1, floorY + 3, z, B.WALL_TORCH, 0);
      setSoft(world, x + 1, floorY + 3, z, B.WALL_TORCH, 1);
    }
  }
  // Cut through the chamber wall and frame it.
  fillBox(world, x - 1, floorY + 1, toZ, x + 1, floorY + 3, toZ, B.AIR, 0);
  for (let py = floorY + 1; py <= floorY + 3; py++) {
    set(world, x - 2, py, toZ, B.RUNE_STONE, 0);
    set(world, x + 2, py, toZ, B.RUNE_STONE, 0);
  }
  set(world, x - 1, floorY + 4, toZ, B.RUNE_STONE, 0);
  set(world, x + 1, floorY + 4, toZ, B.RUNE_STONE, 0);
  set(world, x, floorY + 4, toZ, B.CHISELED_STONE_BRICKS, 0);
}
