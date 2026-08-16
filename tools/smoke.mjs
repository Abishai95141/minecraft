#!/usr/bin/env node
// Headless functional tests. `tools/check.mjs` proves the code loads; this
// proves it does the right thing. Everything here runs without a GPU, so it is
// the fast loop — the browser is only needed for what actually draws.
//
//   node tools/smoke.mjs            run everything
//   node tools/smoke.mjs physics    run only the sections whose name matches
//
// A section whose module is not written yet is reported as SKIP, and skips are
// failures once the build is complete.

import { installBrowserEnv } from './env.mjs';
installBrowserEnv();

const filter = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';

const results = [];
let current = null;

function section(name, fn) {
  if (filter.length && !filter.some((f) => name.includes(f))) return;
  results.push((current = { name, checks: [], skipped: null, error: null, fn }));
}

function ok(label, cond, detail = '') {
  current.checks.push({ label, pass: !!cond, detail });
}

function near(label, actual, expected, tol) {
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  current.checks.push({
    label, pass,
    detail: pass ? `${round(actual)}` : `got ${round(actual)}, want ${expected} +/- ${tol}`,
  });
}

const round = (v) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : String(v));

/** Imports a module, or marks the whole section skipped when it is not written. */
async function need(spec) {
  try {
    return await import(new URL(spec, import.meta.url).href);
  } catch (e) {
    const missing = e.code === 'ERR_MODULE_NOT_FOUND';
    throw Object.assign(new Error(missing ? `not written yet: ${spec}` : `${spec}: ${e.message}`), { skip: missing });
  }
}

// =========================================================== fixtures

/** A world with a stone floor at y=63 (so y=64 is standing height) and nothing else. */
async function flatWorld(size = 4) {
  const { World } = await need('../src/world/world.js');
  const { B } = await need('../src/world/blocks.js');
  const w = new World(1234);
  for (let cz = -size; cz <= size; cz++) {
    for (let cx = -size; cx <= size; cx++) {
      const c = w.getOrCreateChunk(cx, cz);
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          for (let y = 60; y <= 63; y++) c.setBlockRaw(x, y, z, y === 63 ? B.GRASS_BLOCK : B.STONE);
        }
      }
      c.recomputeHeightMap();
      c.generated = c.populated = true;
    }
  }
  return w;
}

// =========================================================== sections

section('physics: vanilla speeds', async () => {
  const { Entity } = await need('../src/entity/entity.js');
  const { MOVE, groundAccel, groundDrag, PLAYER } = await need('../src/core/constants.js');
  const world = await flatWorld();

  // Vanilla applies acceleration, then moves, then multiplies by drag. So the
  // published speeds describe DISPLACEMENT per tick (v + accel), not the stored
  // velocity, which settles a drag-multiply lower. Getting this backwards is the
  // classic way to end up with a game that feels half as fast as Minecraft.
  const steady = (accel, drag) => {
    let v = 0;
    for (let i = 0; i < 400; i++) v = (v + accel) * drag;
    return v + accel;
  };
  near('walk steady state (blocks/s)', steady(groundAccel(0.6, false) * MOVE.INPUT_DAMP, groundDrag(0.6)) * 20, 4.317, 0.01);
  near('sprint steady state (blocks/s)', steady(groundAccel(0.6, true) * MOVE.INPUT_DAMP, groundDrag(0.6)) * 20, 5.612, 0.01);
  near('sneak steady state (blocks/s)', steady(groundAccel(0.6, false) * MOVE.INPUT_DAMP * MOVE.SNEAK_MULTIPLIER, groundDrag(0.6)) * 20, 1.295, 0.01);

  // Jump apex, integrated exactly as the entity must do it.
  let vy = MOVE.JUMP_VELOCITY, y = 0, apex = 0;
  for (let i = 0; i < 100; i++) {
    y += vy;
    vy = (vy - MOVE.GRAVITY) * MOVE.VERTICAL_DRAG;
    apex = Math.max(apex, y);
    if (y < 0) break;
  }
  near('jump apex (blocks)', apex, 1.2516, 0.001);

  // The entity itself must land on the floor and stay there.
  const e = new Entity(world, 0.5, 80, 0.5);
  e.width = PLAYER.WIDTH; e.height = PLAYER.HEIGHT;
  world.addEntity(e);
  for (let i = 0; i < 200; i++) e.tick();
  near('entity falls to floor level', e.y, 64, 0.06);
  ok('entity reports onGround after landing', e.onGround === true);
  ok('vertical velocity settled', Math.abs(e.vy) < 0.1, `vy=${round(e.vy)}`);

  // Terminal velocity must be reached but not exceeded.
  const f = new Entity(world, 0.5, 127, 0.5);
  f.width = 0.6; f.height = 1.8;
  world.addEntity(f);
  let minVy = 0;
  for (let i = 0; i < 60; i++) { f.tick(); minVy = Math.min(minVy, f.vy); }
  ok('terminal velocity respected', minVy >= MOVE.TERMINAL_VELOCITY - 0.02, `min vy=${round(minVy)}`);
});

section('physics: collision', async () => {
  const { Entity } = await need('../src/entity/entity.js');
  const { B } = await need('../src/world/blocks.js');
  const { MOVE } = await need('../src/core/constants.js');
  const world = await flatWorld();

  // A wall the entity must not pass through.
  for (let y = 64; y < 68; y++) for (let z = -2; z <= 2; z++) world.setBlockFast(3, y, z, B.STONE);
  world.getChunk(0, 0).recomputeHeightMap();

  const e = new Entity(world, 0.5, 64, 0.5);
  e.width = 0.6; e.height = 1.8;
  world.addEntity(e);
  for (let i = 0; i < 60; i++) { e.vx = 0.4; e.tick(); }
  ok('wall stops horizontal movement', e.x < 3, `x=${round(e.x)}`);

  ok('a full block is not walked through', e.x < 3);

  // STEP_HEIGHT is 0.6, so a half-slab is stepped onto and a full block is not.
  // Getting this backwards makes the world feel either sticky or floaty.
  const world2 = await flatWorld();
  for (let z = -3; z <= 3; z++) for (let x = 3; x <= 5; x++) world2.setBlockFast(x, 64, z, B.STONE_SLAB);
  world2.getChunk(0, 0).recomputeHeightMap();
  const s = new Entity(world2, 0.5, 64, 0.5);
  s.width = 0.6; s.height = 1.8;
  s.stepHeight = MOVE.STEP_HEIGHT;
  world2.addEntity(s);
  // Track the peak: the slab field is only three blocks wide, so the entity
  // steps up, crosses it, and steps back down again before the loop ends.
  let peakY = s.y;
  for (let i = 0; i < 80; i++) { s.vx = 0.2; s.tick(); peakY = Math.max(peakY, s.y); }
  ok('entity steps up onto a slab', peakY >= 64.4, `peak y=${round(peakY)}`);
  ok('entity crosses the slab field', s.x > 6, `x=${round(s.x)}`);
});

section('worldgen: terrain', async () => {
  const { WorldGenerator } = await need('../src/world/worldgen.js');
  const { World } = await need('../src/world/world.js');
  const { B } = await need('../src/world/blocks.js');
  const { MIN_Y } = await need('../src/world/chunk.js');
  const { WORLD } = await need('../src/core/constants.js');

  const world = new World(90210);
  const gen = new WorldGenerator(world, 90210);
  world.generator = gen;

  const t0 = Date.now();
  const chunks = [];
  for (let cz = 0; cz < 3; cz++) {
    for (let cx = 0; cx < 3; cx++) {
      const c = world.getOrCreateChunk(cx, cz);
      gen.generateChunk(c);
      chunks.push(c);
    }
  }
  const genMs = (Date.now() - t0) / chunks.length;
  ok('generateChunk under 60ms/chunk', genMs < 60, `${round(genMs)}ms avg`);

  const c = chunks[0];
  ok('chunk marked generated', c.generated === true);
  ok('bedrock at world floor', c.getBlock(8, MIN_Y, 8) === B.BEDROCK);

  let solidColumns = 0, airAtTop = 0, surfaceOk = 0;
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const h = c.getHeight(x, z);
      if (h > MIN_Y + 1) solidColumns++;
      if (c.getBlock(x, 126, z) === B.AIR) airAtTop++;
      const sh = gen.surfaceHeight(c.x0 + x, c.z0 + z);
      if (Math.abs(sh - h) <= 3) surfaceOk++;
    }
  }
  ok('every column has terrain', solidColumns === 256, `${solidColumns}/256`);
  ok('sky is clear at y=126', airAtTop === 256, `${airAtTop}/256`);
  ok('surfaceHeight agrees with generated terrain', surfaceOk >= 244, `${surfaceOk}/256 within 3 blocks`);

  // Height range should look like a world, not a plateau.
  let lo = 999, hi = -999;
  for (const ch of chunks) {
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const h = ch.getHeight(x, z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
  }
  ok('terrain has relief', hi - lo >= 4, `range ${lo}..${hi}`);
  ok('terrain near sea level', hi > WORLD.SEA_LEVEL - 20 && lo < 140, `range ${lo}..${hi}`);

  // Same seed, same world.
  const world2 = new World(90210);
  const gen2 = new WorldGenerator(world2, 90210);
  world2.generator = gen2;
  const c2 = world2.getOrCreateChunk(0, 0);
  gen2.generateChunk(c2);
  let identical = true;
  for (let y = MIN_Y; y < 128 && identical; y += 3) {
    for (let z = 0; z < 16 && identical; z += 3) {
      for (let x = 0; x < 16; x += 3) {
        if (c.getBlock(x, y, z) !== c2.getBlock(x, y, z)) { identical = false; break; }
      }
    }
  }
  ok('generation is deterministic for a seed', identical);

  // Populate must be safe and must actually place things.
  for (const ch of chunks) gen.populateChunk(ch);
  const before = countNonAir(chunks[4]);
  gen.populateChunk(chunks[4]);
  ok('populateChunk is idempotent', countNonAir(chunks[4]) === before);

  let ores = 0, plants = 0, logs = 0;
  for (const ch of chunks) {
    for (let y = MIN_Y + 1; y < 128; y++) {
      for (let z = 0; z < 16; z += 2) for (let x = 0; x < 16; x += 2) {
        const id = ch.getBlock(x, y, z);
        if (id >= B.COAL_ORE && id <= B.DEEPSLATE_LAPIS_ORE) ores++;
        else if (id === B.GRASS_PLANT || id === B.TALL_GRASS || id === B.POPPY || id === B.DANDELION || id === B.FERN) plants++;
        else if (id === B.OAK_LOG || id === B.BIRCH_LOG || id === B.SPRUCE_LOG) logs++;
      }
    }
  }
  ok('ores were generated', ores > 0, `${ores} sampled`);
  ok('surface decoration was generated', plants + logs > 0, `${plants} plants, ${logs} logs sampled`);

  function countNonAir(ch) {
    let n = 0;
    for (const s of ch.sections) if (s) n += s.nonAir;
    return n;
  }
});

section('worldgen: caves and ore depth', async () => {
  const { WorldGenerator } = await need('../src/world/worldgen.js');
  const { World } = await need('../src/world/world.js');
  const { B } = await need('../src/world/blocks.js');

  const world = new World(7);
  const gen = new WorldGenerator(world, 7);
  world.generator = gen;
  let air = 0, stone = 0, deepslateOre = 0, stoneOre = 0;
  for (let cz = 0; cz < 3; cz++) for (let cx = 0; cx < 3; cx++) {
    const c = world.getOrCreateChunk(cx, cz);
    gen.generateChunk(c);
    gen.populateChunk(c);
    for (let y = -50; y < 40; y++) {
      for (let z = 0; z < 16; z += 2) for (let x = 0; x < 16; x += 2) {
        const id = c.getBlock(x, y, z);
        if (id === B.AIR) air++;
        else if (id === B.STONE || id === B.DEEPSLATE) stone++;
        if (y < -8 && id >= B.DEEPSLATE_COAL_ORE && id <= B.DEEPSLATE_LAPIS_ORE) deepslateOre++;
        if (y < -8 && id >= B.COAL_ORE && id <= B.COPPER_ORE) stoneOre++;
      }
    }
  }
  ok('caves carve underground air', air > 100, `${air} air samples below y=40`);
  ok('underground is mostly solid', stone > air, `${stone} stone vs ${air} air`);
  ok('deep ore uses deepslate variants', deepslateOre >= stoneOre, `${deepslateOre} deepslate vs ${stoneOre} stone-type below y=-8`);
});

section('lighting', async () => {
  const { LightEngine } = await need('../src/world/lighting.js');
  const { B } = await need('../src/world/blocks.js');
  const world = await flatWorld(1);
  const light = new LightEngine(world);
  world.lighting = light;

  for (const c of world.chunks.values()) light.initialLight(c);
  let guard = 0;
  while (light.pending > 0 && guard++ < 2000) light.process(50);

  ok('sky light is full above the surface', world.getSkyLight(0, 70, 0) === 15, `got ${world.getSkyLight(0, 70, 0)}`);
  ok('sky light is blocked underground', world.getSkyLight(0, 61, 0) === 0, `got ${world.getSkyLight(0, 61, 0)}`);
  ok('no block light on an empty world', world.getBlockLight(0, 70, 0) === 0);

  // A torch must light its neighbourhood and decay by 1 per step.
  world.setBlock(0, 64, 0, B.TORCH);
  guard = 0;
  while (light.pending > 0 && guard++ < 2000) light.process(50);
  const at = world.getBlockLight(0, 64, 0);
  const one = world.getBlockLight(1, 64, 0);
  const four = world.getBlockLight(4, 64, 0);
  ok('torch emits its full level', at === 14, `got ${at}`);
  ok('block light decays by 1 per step', one === 13, `got ${one}`);
  near('block light 4 blocks away', four, 10, 0.001);

  // Removing it must clear the light again, not leave a ghost.
  world.setBlock(0, 64, 0, B.AIR);
  guard = 0;
  while (light.pending > 0 && guard++ < 2000) light.process(50);
  ok('removing a light source clears its light', world.getBlockLight(2, 64, 0) === 0, `got ${world.getBlockLight(2, 64, 0)}`);

  // process() must honour its time budget.
  for (const c of world.chunks.values()) { c.lit = false; light.initialLight(c); }
  const t0 = performance.now();
  light.process(4);
  const spent = performance.now() - t0;
  ok('process respects its millisecond budget', spent < 40, `${round(spent)}ms for a 4ms budget`);
});

section('mesher', async () => {
  const { meshSection, VERTEX_STRIDE_U16, VERTEX_STRIDE_U8 } = await need('../src/render/mesher.js');
  const { atlas } = await need('../src/render/atlas.js');
  const { LightEngine } = await need('../src/world/lighting.js');
  const { B } = await need('../src/world/blocks.js');
  const { MIN_Y } = await need('../src/world/chunk.js');
  if (!atlas.layers) atlas.buildSync();

  ok('u16 stride is 7', VERTEX_STRIDE_U16 === 7, `got ${VERTEX_STRIDE_U16}`);
  ok('u8 stride is 8', VERTEX_STRIDE_U8 === 8, `got ${VERTEX_STRIDE_U8}`);

  const world = await flatWorld(1);
  const light = new LightEngine(world);
  world.lighting = light;
  for (const c of world.chunks.values()) light.initialLight(c);
  let guard = 0;
  while (light.pending > 0 && guard++ < 2000) light.process(50);

  const chunk = world.getChunk(0, 0);
  const si = (63 - MIN_Y) >> 4;
  const mesh = meshSection(world, chunk, si);
  ok('a solid section produces a mesh', mesh && !mesh.empty);
  if (!mesh) return;

  const op = mesh.opaque;
  ok('opaque pass has quads', op.quadCount > 0, `${op.quadCount} quads`);
  ok('u16 buffer length matches quadCount', op.u16.length === op.quadCount * 4 * 7, `${op.u16.length} vs ${op.quadCount * 28}`);
  ok('u8 buffer length matches quadCount', op.u8.length === op.quadCount * 4 * 8, `${op.u8.length} vs ${op.quadCount * 32}`);
  ok('u16 buffer is a Uint16Array', op.u16 instanceof Uint16Array);
  ok('u8 buffer is a Uint8Array', op.u8 instanceof Uint8Array);

  // Only the top faces of a flat field should survive culling: 16*16 = 256 of them,
  // plus the four exposed side walls of the section.
  ok('face culling removes hidden faces', op.quadCount < 16 * 16 * 6, `${op.quadCount} quads for a 16x16 floor`);

  let posOk = true, layerOk = true, litOk = false;
  for (let v = 0; v < op.quadCount * 4; v++) {
    const b = v * 7;
    const x = op.u16[b], y = op.u16[b + 1], z = op.u16[b + 2], layer = op.u16[b + 5];
    if (x > 16 * 32 || z > 16 * 32 || y > 192 * 32) posOk = false;
    if (layer >= atlas.layers) layerOk = false;
    if (op.u8[v * 8] > 200) litOk = true;      // sky light byte on a top face
  }
  ok('vertex positions are inside the chunk', posOk);
  ok('texture layers are valid atlas indices', layerOk);
  ok('top faces carry sky light', litOk);

  // An empty section must not produce geometry.
  const emptySi = (100 - MIN_Y) >> 4;
  const empty = meshSection(world, chunk, emptySi);
  ok('empty section meshes to null or empty', !empty || empty.empty);

  // Water belongs in the translucent pass, plants in cutout. Both have to land
  // inside the section under test — section `si` spans y 48..63, not 64.
  world.setBlockFast(4, 63, 4, B.WATER);
  world.setBlockFast(6, 63, 6, B.POPPY);
  chunk.recomputeHeightMap();
  const m2 = meshSection(world, chunk, si);
  ok('water goes to the translucent pass', m2.translucent.quadCount > 0, `${m2.translucent.quadCount} quads`);
  ok('plants go to the cutout pass', m2.cutout.quadCount > 0, `${m2.cutout.quadCount} quads`);
});

section('inventory', async () => {
  const { ItemStack, Inventory, PlayerInventory } = await need('../src/item/inventory.js');

  const a = new ItemStack('oak_planks', 20);
  const b = new ItemStack('oak_planks', 50);
  ok('stacks of the same item stack together', a.canStackWith(b));
  ok('maxStack comes from the registry', a.maxStack === 64, `got ${a.maxStack}`);

  const inv = new Inventory(9);
  const rem = inv.add(new ItemStack('oak_planks', 70));
  ok('overflow spills into a second slot', inv.countOf('oak_planks') === 70, `got ${inv.countOf('oak_planks')}`);
  ok('add returns an empty remainder when it fits', !rem || rem.isEmpty || rem.count === 0);

  const full = new Inventory(1);
  full.add(new ItemStack('stone', 64));
  const over = full.add(new ItemStack('stone', 10));
  ok('add returns the true remainder when full', over && over.count === 10, `got ${over && over.count}`);

  ok('consume removes the right amount', inv.consume('oak_planks', 5) && inv.countOf('oak_planks') === 65, `got ${inv.countOf('oak_planks')}`);
  ok('consume refuses when short', inv.consume('oak_planks', 9999) === false);

  const split = new ItemStack('cobblestone', 10).split(4);
  ok('split returns the requested count', split.count === 4, `got ${split.count}`);

  const tool = new ItemStack('wooden_pickaxe');
  ok('tools do not stack', tool.maxStack === 1);
  let broke = false;
  for (let i = 0; i < 200 && !broke; i++) broke = tool.damageBy(1);
  ok('a tool breaks at its durability limit', broke);

  const pi = new PlayerInventory();
  ok('player inventory is 41 slots', pi.size === 41, `got ${pi.size}`);
  pi.set(36, new ItemStack('iron_helmet'));
  pi.set(37, new ItemStack('iron_chestplate'));
  ok('armour points sum from the armour slots', pi.armorPoints() === 8, `got ${pi.armorPoints()}`);
  pi.selected = 0;
  pi.set(0, new ItemStack('stone', 3));
  ok('held reads the selected hotbar slot', pi.held.item?.name === 'stone');
});

section('recipes and smelting', async () => {
  const { findRecipe, RECIPES, recipesFor } = await need('../src/item/recipes.js');
  const { ItemStack } = await need('../src/item/inventory.js');
  const { smeltResult, fuelTicks, SMELT_TICKS } = await need('../src/item/smelting.js');

  ok('a real recipe set exists', RECIPES.length > 60, `${RECIPES.length} recipes`);

  const s = (n) => (n ? new ItemStack(n, 1) : null);

  const planks = findRecipe([s('oak_log'), null, null, null], 2);
  ok('1 oak log makes 4 oak planks', planks?.output.item?.name === 'oak_planks' && planks.output.count === 4,
    planks ? `${planks.output.item?.name} x${planks.output.count}` : 'no match');

  const table = findRecipe([s('oak_planks'), s('oak_planks'), s('oak_planks'), s('oak_planks')], 2);
  ok('2x2 planks makes a crafting table', table?.output.item?.name === 'crafting_table', table?.output.item?.name ?? 'no match');

  const sticks = findRecipe([s('oak_planks'), null, s('oak_planks'), null], 2);
  ok('2 planks makes 4 sticks', sticks?.output.item?.name === 'stick' && sticks.output.count === 4,
    sticks ? `${sticks.output.item?.name} x${sticks.output.count}` : 'no match');

  // Shaped, at the top-left of a 3x3.
  const pick = findRecipe([
    s('oak_planks'), s('oak_planks'), s('oak_planks'),
    null, s('stick'), null,
    null, s('stick'), null,
  ], 3);
  ok('the pickaxe pattern makes a wooden pickaxe', pick?.output.item?.name === 'wooden_pickaxe', pick?.output.item?.name ?? 'no match');

  // A shape that is not any recipe must match nothing. (Note the hoe pattern
  // shifted one column right IS still a hoe — shaped matching trims to the
  // bounding box — so a near-miss has to be genuinely different, not offset.)
  const nonsense = findRecipe([
    s('oak_planks'), s('oak_planks'), null,
    null, null, null,
    null, s('stick'), null,
  ], 3);
  ok('a pattern that is not a recipe does not match', !nonsense, nonsense ? `matched ${nonsense.output.item?.name}` : '');

  // Shaped at an offset that does fit: a sword in the right two columns.
  const sword = findRecipe([
    null, s('iron_ingot'), null,
    null, s('iron_ingot'), null,
    null, s('stick'), null,
  ], 3);
  ok('the sword pattern matches at a column offset', sword?.output.item?.name === 'iron_sword', sword?.output.item?.name ?? 'no match');

  const torch = findRecipe([s('coal'), null, s('stick'), null], 2);
  ok('coal over a stick makes torches', torch?.output.item?.name === 'torch' && torch.output.count === 4,
    torch ? `${torch.output.item?.name} x${torch.output.count}` : 'no match');

  ok('an empty grid matches nothing', !findRecipe([null, null, null, null], 2));
  ok('recipesFor finds a recipe by output', recipesFor('crafting_table').length > 0);

  ok('iron ore smelts to an ingot', smeltResult('raw_iron')?.out === 'iron_ingot' || smeltResult('iron_ore')?.out === 'iron_ingot');
  ok('coal is a fuel', fuelTicks('coal') === 1600, `got ${fuelTicks('coal')}`);
  ok('planks are a fuel', fuelTicks('oak_planks') === 300, `got ${fuelTicks('oak_planks')}`);
  ok('a smelt takes 200 ticks', SMELT_TICKS === 200, `got ${SMELT_TICKS}`);
  ok('stone is not a fuel', fuelTicks('stone') === 0);
});

section('mining times', async () => {
  const { breakTimeSeconds, canHarvest } = await need('../src/item/items.js');
  const { byName } = await need('../src/world/blocks.js');

  // Java Edition reference values.
  near('stone with a wooden pickaxe', breakTimeSeconds(byName.stone, 'wooden_pickaxe', { onGround: true }), 1.15, 0.06);
  near('stone by hand', breakTimeSeconds(byName.stone, null, { onGround: true }), 7.5, 0.3);
  near('dirt with a wooden shovel', breakTimeSeconds(byName.dirt, 'wooden_shovel', { onGround: true }), 0.4, 0.06);
  near('oak log with a wooden axe', breakTimeSeconds(byName.oak_log, 'wooden_axe', { onGround: true }), 1.5, 0.1);
  ok('bedrock is unbreakable', breakTimeSeconds(byName.bedrock, 'diamond_pickaxe', { onGround: true }) === Infinity);
  ok('diamond ore needs an iron pickaxe', !canHarvest('stone_pickaxe', byName.diamond_ore) && canHarvest('iron_pickaxe', byName.diamond_ore));
});

section('mobs and ai', async () => {
  const { spawnMob, MOB_TYPES } = await need('../src/entity/mobs.js');
  const world = await flatWorld(2);

  const required = ['zombie', 'skeleton', 'creeper', 'spider', 'pig', 'cow', 'sheep', 'chicken', 'hollow_warden', 'withered_husk'];
  for (const type of required) ok(`${type} is registered`, !!MOB_TYPES[type]);

  let spawned = 0;
  for (const type of required) {
    const m = spawnMob(world, type, 0.5 + spawned * 2, 64, 0.5);
    if (m) { spawned++; ok(`${type} spawns`, m.health > 0, `${m.health}hp`); }
    else ok(`${type} spawns`, false, 'spawnMob returned null');
  }

  ok('the boss has 120hp', MOB_TYPES.hollow_warden && (world.entities.find((e) => e.type === 'hollow_warden')?.maxHealth === 120),
    String(world.entities.find((e) => e.type === 'hollow_warden')?.maxHealth));

  // Everything must survive a few seconds of simulation without throwing.
  let threw = null;
  try { for (let i = 0; i < 120; i++) world.tick(1); } catch (e) { threw = e; }
  ok('mobs tick without throwing', !threw, threw ? `${threw.message}` : `${world.entities.length} entities alive`);

  let onGround = 0;
  for (const e of world.entities) if (e.onGround) onGround++;
  ok('mobs come to rest on the ground', onGround > 0, `${onGround}/${world.entities.length}`);

  // Damage and death must work, and must clean up.
  const victim = world.entities.find((e) => e.type === 'pig');
  if (victim) {
    victim.damage(100, null);
    for (let i = 0; i < 40; i++) world.tick(1);
    ok('a killed mob dies and is removed', victim.dead === true);
  } else ok('a killed mob dies and is removed', false, 'no pig to test');
});

section('items on the ground', async () => {
  const { ItemEntity } = await need('../src/entity/itementity.js');
  const { ItemStack } = await need('../src/item/inventory.js');
  const world = await flatWorld(1);

  const a = new ItemEntity(world, 0.5, 70, 0.5, new ItemStack('cobblestone', 3));
  world.addEntity(a);
  for (let i = 0; i < 60; i++) world.tick(1);
  near('a dropped item lands on the ground', a.y, 64, 0.5);

  const b = new ItemEntity(world, 0.6, 64.2, 0.6, new ItemStack('cobblestone', 5));
  world.addEntity(b);
  for (let i = 0; i < 60; i++) world.tick(1);
  const merged = a.dead || b.dead;
  ok('nearby identical stacks merge', merged, merged ? '' : `${a.stack.count} + ${b.stack.count}`);
});

section('structures', async () => {
  const { generateVillage, villageAt, generateRuinedTower, generateDungeon } = await need('../src/world/structures.js');
  const { WorldGenerator } = await need('../src/world/worldgen.js');
  const { World } = await need('../src/world/world.js');
  const { Random } = await need('../src/core/rng.js');
  const { B } = await need('../src/world/blocks.js');

  const world = new World(4242);
  const gen = new WorldGenerator(world, 4242);
  world.generator = gen;
  for (let cz = -4; cz <= 4; cz++) for (let cx = -4; cx <= 4; cx++) {
    const c = world.getOrCreateChunk(cx, cz);
    gen.generateChunk(c);
  }

  const rng = new Random(1);
  const village = generateVillage(world, 0, 0, rng);
  ok('generateVillage returns a centre', Array.isArray(village?.center) && village.center.length === 3);
  ok('the village has buildings', (village?.buildings?.length ?? 0) >= 5, `${village?.buildings?.length} buildings`);
  ok('the village names its npc spawns', Object.keys(village?.npcSpawns ?? {}).length >= 3, JSON.stringify(Object.keys(village?.npcSpawns ?? {})));

  let planks = 0, path = 0, pedestal = 0, doors = 0, lanterns = 0;
  for (let y = 50; y < 100; y++) {
    for (let z = -40; z < 40; z++) for (let x = -40; x < 40; x++) {
      const id = world.getBlock(x, y, z);
      if (id === B.OAK_PLANKS) planks++;
      else if (id === B.VILLAGE_PATH) path++;
      else if (id === B.BEACON_PEDESTAL) pedestal++;
      else if (id === B.OAK_DOOR_LOWER) doors++;
      else if (id === B.EMBER_LANTERN || id === B.EMBER_LANTERN_LIT) lanterns++;
    }
  }
  ok('village buildings are built from planks', planks > 200, `${planks} planks`);
  ok('paths were laid', path > 20, `${path} path blocks`);
  ok('the beacon pedestal exists', pedestal >= 1, `${pedestal}`);
  ok('buildings have doors', doors >= 4, `${doors} doors`);
  ok('lantern posts were placed', lanterns >= 2, `${lanterns}`);

  const grid = villageAt(0, 0, 4242);
  ok('villageAt is deterministic', JSON.stringify(grid) === JSON.stringify(villageAt(0, 0, 4242)));

  const tower = generateRuinedTower(world, 200, 200, new Random(2));
  ok('the ruined tower reports a loot position', Array.isArray(tower?.lootPos));

  const dungeon = generateDungeon(world, -200, 20, -200, new Random(3));
  ok('the dungeon reports a spawner position', Array.isArray(dungeon?.spawnerPos));
  ok('the dungeon reports chests', Array.isArray(dungeon?.chests));
});

section('story', async () => {
  const { QUESTS } = await need('../src/story/quests.js');
  const { DIALOGUE } = await need('../src/story/dialogue.js');

  ok('there are 7 quests', QUESTS.length === 7, `${QUESTS.length}`);
  for (const q of QUESTS) {
    ok(`quest "${q.id}" has a title and objectives`, !!q.title && Array.isArray(q.objectives) && q.objectives.length > 0);
  }
  for (const npc of ['elder_sowmi', 'torvin', 'mira', 'pim']) {
    ok(`${npc} has dialogue`, !!DIALOGUE[npc]);
  }
  const branching = Object.values(DIALOGUE).filter((d) => JSON.stringify(d).includes('choices')).length;
  ok('major NPCs have branching choices', branching >= 3, `${branching} npcs with choices`);
});

section('audio', async () => {
  const { audio } = await need('../src/audio/audio.js');
  audio.init();
  ok('the engine reports ready after init', audio.ready === true);
  let threw = null;
  try {
    for (const name of ['dig.stone', 'step.grass', 'break.wood', 'click', 'pop', 'hurt', 'explode', 'zombie_idle', 'level_up']) {
      audio.play(name, { x: 0, y: 64, z: 0 });
    }
    audio.playUI('click');
    audio.setListener([0, 64, 0], [0, 0, 1]);
    audio.startMusic('menu');
    audio.stopMusic(0.5);
  } catch (e) { threw = e; }
  ok('playing sounds does not throw', !threw, threw?.message ?? '');
  let threw2 = null;
  try { audio.play('definitely_not_a_real_sound'); } catch (e) { threw2 = e; }
  ok('an unknown sound name is survivable', !threw2, threw2?.message ?? '');
});

section('ui screens render', async () => {
  const { installBrowserEnv: _ } = await import('./env.mjs');
  const { atlas } = await need('../src/render/atlas.js');
  if (!atlas.layers) atlas.buildSync();

  const screens = [
    ['loading', '../src/ui/screens/loading.js'],
    ['mainmenu', '../src/ui/screens/mainmenu.js'],
    ['options', '../src/ui/screens/options.js'],
    ['controls', '../src/ui/screens/controls.js'],
    ['worldselect', '../src/ui/screens/worldselect.js'],
    ['pause', '../src/ui/screens/pause.js'],
    ['death', '../src/ui/screens/death.js'],
    ['credits', '../src/ui/screens/credits.js'],
  ];

  const canvas = document.createElement('canvas');
  canvas.width = 960; canvas.height = 540;
  const ctx = canvas.getContext('2d');
  const game = {
    ctx, canvas, uiCanvas: canvas, width: 480, height: 270, guiScale: 2,
    settings: (await need('../src/core/settings.js')).settings,
    atlas, audio: null, world: null, player: null, story: null, inGame: false,
    screen: null, openScreen() {}, closeScreen() {}, toast() {}, chat() {},
    playSound() {}, startWorld() {}, quitToTitle() {}, saveWorld() {},
    fps: 60, partialTicks: 0, paused: false,
  };

  for (const [name, spec] of screens) {
    let threw = null;
    try {
      const mod = await need(spec);
      const Cls = Object.values(mod).find((v) => typeof v === 'function' && /^[A-Z]/.test(v.name));
      const s = new Cls(game);
      s.init?.(game.width, game.height);
      s.layout?.(game.width, game.height);
      s.render(ctx, 100, 100, 0.016);
      s.tick?.();
    } catch (e) { threw = e; }
    ok(`${name} screen constructs and renders`, !threw, threw ? `${threw.message}` : '');
  }
});

section('gameplay: mine, collect, place', async () => {
  const { Player } = await need('../src/entity/player.js');
  const { WorldGenerator } = await need('../src/world/worldgen.js');
  const { LightEngine } = await need('../src/world/lighting.js');
  const { World } = await need('../src/world/world.js');
  const { ItemStack } = await need('../src/item/inventory.js');
  const { B, BLOCKS } = await need('../src/world/blocks.js');

  // A real generated world, lit, exactly as game.js sets one up.
  const world = new World(2024);
  const gen = new WorldGenerator(world, 2024);
  const light = new LightEngine(world);
  world.generator = gen;
  world.lighting = light;
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) {
    const c = world.getOrCreateChunk(cx, cz);
    gen.generateChunk(c);
    c.generated = true;
  }
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const c = world.getChunk(cx, cz);
    gen.populateChunk(c);
    c.populated = true;
    c.recomputeHeightMap();
  }
  for (const c of world.chunks.values()) if (c.populated) { light.initialLight(c); c.lit = true; }
  let guard = 0;
  while (light.pending > 0 && guard++ < 3000) light.process(50);

  const stubGame = {
    playSound() {}, chat() {}, toast() {}, openContainer() {},
    particles: null, story: null, audio: null,
    onPlayerHurt() {}, onPlayerDeath() {}, onHeldItemChanged() {},
  };

  const spawnY = world.findSpawnY(0, 0, 120);
  const player = new Player(world, 0.5, spawnY, 0.5, stubGame);
  world.addEntity(player);
  ok('the player spawns above ground', spawnY > 0 && spawnY < 128, `y=${spawnY}`);

  // Settle, then confirm we are standing on something solid rather than falling.
  for (let i = 0; i < 60; i++) world.tick(1);
  ok('the player settles on the ground', player.onGround, `y=${round(player.y)}`);
  ok('the player did not fall out of the world', player.y > 0, `y=${round(player.y)}`);
  ok('the player took no spawn damage', player.health === 20, `${player.health}hp`);

  // Mine the block the player is standing on top of, by looking straight down.
  player.pitch = Math.PI / 2 - 0.01;
  player.updateTargets();
  ok('looking down targets a block', !!player.lookingAt,
    player.lookingAt ? `${BLOCKS[player.lookingAt.blockId].name}` : 'nothing targeted');

  if (player.lookingAt) {
    const target = { ...player.lookingAt };
    const beforeCount = player.inventory.contents().length;
    let ticks = 0;
    while (world.getBlock(target.x, target.y, target.z) === target.blockId && ticks++ < 400) {
      player.updateTargets();
      player.tickMining(true);
    }
    ok('mining eventually breaks the block', world.getBlock(target.x, target.y, target.z) !== target.blockId,
      `${ticks} ticks on ${BLOCKS[target.blockId].name}`);
    ok('breaking took a believable amount of time', ticks > 1 && ticks < 400, `${ticks} ticks`);

    // The drop should be on the ground; let the pickup logic run.
    for (let i = 0; i < 60; i++) world.tick(1);
    const afterCount = player.inventory.contents().length;
    ok('the drop is picked up into the inventory', afterCount > beforeCount,
      `${beforeCount} -> ${afterCount} stacks`);
  }

  // Place a block, aiming down and forward so the target lands beside the player
  // rather than inside them — placing into your own hitbox is correctly refused.
  player.inventory.set(0, new ItemStack('cobblestone', 8));
  player.selectSlot(0);
  player.pitch = 0.8;
  player.updateTargets();
  const held = player.inventory.held.count;
  const placed = player.use();
  ok('placing a block from the hotbar works', placed === true,
    player.lookingAt ? `aimed at ${player.lookingAt.x},${player.lookingAt.y},${player.lookingAt.z}` : 'no target');
  ok('placing consumes one item', player.inventory.held.count === held - 1,
    `${held} -> ${player.inventory.held.count}`);

  // Placing a block into your own hitbox must be refused, not allowed.
  player.placeCooldown = 0;
  player.useCooldown = 0;
  player.pitch = Math.PI / 2 - 0.01;
  player.updateTargets();
  const beforeSelf = player.inventory.held.count;
  player.use();
  ok('placing inside yourself is refused', player.inventory.held.count === beforeSelf,
    `${beforeSelf} -> ${player.inventory.held.count}`);
});

section('gameplay: survival rules', async () => {
  const { Player } = await need('../src/entity/player.js');
  const { ItemStack } = await need('../src/item/inventory.js');
  const world = await flatWorld(3);

  const stubGame = {
    playSound() {}, chat() {}, toast() {}, openContainer() {},
    particles: null, story: null, audio: null,
    onPlayerHurt() {}, onPlayerDeath() {}, onHeldItemChanged() {},
  };
  const player = new Player(world, 0.5, 64, 0.5, stubGame);
  world.addEntity(player);
  for (let i = 0; i < 20; i++) world.tick(1);

  // Walking from a standstill covers 4.06 blocks in 20 ticks: the 4.317 b/s
  // steady state minus the acceleration transient.
  const x0 = player.x, z0 = player.z;
  player.moveForward = 1;
  for (let i = 0; i < 20; i++) player.tick();
  near('walk distance in 20 ticks', Math.hypot(player.x - x0, player.z - z0), 4.06, 0.1);
  player.moveForward = 0;
  for (let i = 0; i < 30; i++) player.tick();

  // Sprinting is faster, and only while moving forward with food in the bar.
  const x1 = player.x, z1 = player.z;
  player.sprinting = true;
  player.moveForward = 1;
  for (let i = 0; i < 40; i++) player.tick();
  const sprintPerTick = Math.hypot(player.x - x1, player.z - z1) / 40;
  ok('sprinting is faster than walking', sprintPerTick > 0.24, `${round(sprintPerTick * 20)} blocks/s`);
  player.sprinting = false;
  player.moveForward = 0;
  for (let i = 0; i < 30; i++) player.tick();

  // A jump reaches the vanilla apex.
  const groundY = player.y;
  player.jumping = true;
  let apex = groundY;
  for (let i = 0; i < 30; i++) { player.tick(); apex = Math.max(apex, player.y); }
  near('jump apex above the ground', apex - groundY, 1.2516, 0.02);
  player.jumping = false;
  for (let i = 0; i < 30; i++) player.tick();

  // Sprinting burns hunger; standing still does not.
  player.exhaustion = 0;
  player.saturation = 0;
  player.food = 20;
  player.sprinting = true;
  player.moveForward = 1;
  for (let i = 0; i < 400; i++) player.tick();
  ok('sprinting drains hunger', player.food < 20, `food=${player.food}`);
  player.sprinting = false;
  player.moveForward = 0;

  // Fall damage gets fresh players: 400 ticks of sprinting carried the first one
  // off the edge of the platform and into the void, which kills it.
  const dropTest = (height) => {
    const p = new Player(world, 4.5, 64 + height, 4.5, stubGame);
    world.addEntity(p);
    for (let i = 0; i < 300 && !p.onGround; i++) p.tick();
    return p;
  };

  const longFall = dropTest(30);
  ok('a dropped player lands on the platform', longFall.onGround, `y=${round(longFall.y)}`);
  ok('a 30-block fall is lethal', longFall.health <= 0, `${longFall.health}hp`);

  const shortFall = dropTest(2);
  ok('a 2-block fall is harmless', shortFall.health === 20, `${shortFall.health}hp`);

  const midFall = dropTest(8);
  ok('an 8-block fall hurts but does not kill', midFall.health < 20 && midFall.health > 0,
    `${midFall.health}hp`);

  const p2 = new Player(world, 8.5, 64, 8.5, stubGame);
  world.addEntity(p2);
  for (let i = 0; i < 20; i++) p2.tick();

  // Eating restores hunger.
  p2.food = 10;
  p2.saturation = 0;
  p2.inventory.set(0, new ItemStack('bread', 2));
  p2.selectSlot(0);
  ok('eating starts', p2.startEating(0) === true);
  for (let i = 0; i < 60 && p2.eatingTicks > 0; i++) p2.tick();
  ok('eating restores hunger', p2.food > 10, `food=${p2.food}`);
  ok('eating consumes the item', p2.inventory.countOf('bread') === 1, `${p2.inventory.countOf('bread')} left`);

  // Save and reload must round-trip.
  p2.inventory.set(1, new ItemStack('cobblestone', 12));
  const json = p2.toJSON();
  const restored = new Player(world, 0, 100, 0, stubGame);
  restored.fromJSON(json);
  ok('player state round-trips through JSON',
    Math.abs(restored.x - p2.x) < 1e-6 && restored.food === p2.food &&
    restored.inventory.countOf('cobblestone') === 12,
    `x=${round(restored.x)} food=${restored.food} cobble=${restored.inventory.countOf('cobblestone')}`);
});

section('hud renders', async () => {
  const { Hud } = await need('../src/ui/hud.js');
  const { icons } = await need('../src/ui/icons.js');
  const { PlayerInventory, ItemStack } = await need('../src/item/inventory.js');
  const { atlas } = await need('../src/render/atlas.js');
  if (!atlas.layers) atlas.buildSync();
  icons.buildSync(atlas);

  const world = await flatWorld(1);
  const canvas = document.createElement('canvas');
  canvas.width = 960; canvas.height = 540;
  const ctx = canvas.getContext('2d');

  const inv = new PlayerInventory();
  inv.set(0, new ItemStack('stone', 42));
  inv.set(1, new ItemStack('wooden_pickaxe'));

  const player = {
    x: 0.5, y: 64, z: 0.5, yaw: 0, pitch: 0, health: 14, maxHealth: 20,
    food: 15, saturation: 4, air: 300, xp: 12, xpLevel: 3, xpProgress: 0.4,
    inventory: inv, armorPoints: () => 4, onGround: true, inWater: false,
    hurtTime: 0, selectedSlot: 0, dead: false,
  };
  const game = {
    ctx, canvas, width: 480, height: 270, guiScale: 2, world, player, atlas, icons,
    settings: (await need('../src/core/settings.js')).settings,
    fps: 60, partialTicks: 0, story: null, audio: null, inGame: true,
    camera: { pos: [0, 64, 0], yaw: 0, pitch: 0 },
    renderer: { stats: { chunks: 4, quads: 100, drawCalls: 3, meshTimeMs: 1 } },
    debugOverlay: true, screen: null,
  };

  const hud = new Hud(game);
  let threw = null;
  try {
    hud.render(ctx, game, game.width, game.height, 0.016);
    game.debugOverlay = false;
    hud.render(ctx, game, game.width, game.height, 0.016);
  } catch (e) { threw = e; }
  ok('the HUD renders without throwing', !threw, threw ? `${threw.message}\n${(threw.stack || '').split('\n')[1] || ''}` : '');

  let iconThrew = null;
  try {
    icons.draw(ctx, 'stone', 0, 0, 16);
    icons.draw(ctx, 'wooden_pickaxe', 0, 0, 16);
    icons.drawStack(ctx, new ItemStack('stone', 42), 0, 0);
  } catch (e) { iconThrew = e; }
  ok('item icons draw without throwing', !iconThrew, iconThrew?.message ?? '');
});

// =========================================================== runner

let pass = 0, failCount = 0, skipCount = 0;

for (const s of results) {
  current = s;
  try {
    await s.fn();
  } catch (e) {
    if (e.skip) s.skipped = e.message;
    else s.error = e;
  }
}

console.log('');
for (const s of results) {
  if (s.skipped) {
    skipCount++;
    console.log(`${YELLOW}SKIP${OFF} ${s.name} ${DIM}(${s.skipped})${OFF}`);
    continue;
  }
  const bad = s.checks.filter((c) => !c.pass);
  if (s.error) {
    failCount++;
    console.log(`${RED}FAIL${OFF} ${BOLD}${s.name}${OFF} ${DIM}threw${OFF}`);
    console.log(`     ${RED}${(s.error.stack || s.error.message).split('\n').slice(0, 4).join('\n     ')}${OFF}`);
    continue;
  }
  if (bad.length === 0) {
    pass++;
    console.log(`${GREEN}PASS${OFF} ${s.name} ${DIM}(${s.checks.length} checks)${OFF}`);
  } else {
    failCount++;
    console.log(`${RED}FAIL${OFF} ${BOLD}${s.name}${OFF} ${DIM}(${bad.length}/${s.checks.length} failed)${OFF}`);
    for (const c of bad) console.log(`     ${RED}x${OFF} ${c.label}${c.detail ? ` ${DIM}- ${c.detail}${OFF}` : ''}`);
  }
}

const total = pass + failCount + skipCount;
console.log('');
console.log(`${pass}/${total} sections passed` +
  (failCount ? `, ${RED}${failCount} failed${OFF}` : '') +
  (skipCount ? `, ${YELLOW}${skipCount} not written yet${OFF}` : ''));

process.exit(failCount ? 1 : 0);
