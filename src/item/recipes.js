// Crafting. Shaped recipes are declared with vanilla's patterns and matched at
// any offset inside the grid (and mirrored); shapeless ones match as multisets.
// Every ingredient name is verified against the item registry at load time.

import { ITEMS } from './items.js';
import { ItemStack } from './inventory.js';

// ------------------------------------------------------------------ tags
// Vanilla uses item tags for "any plank", "any wool" and so on. Small arrays
// do the same job here and keep the recipe table readable.

const PLANKS = ['oak_planks', 'birch_planks', 'spruce_planks'];
const LOGS = ['oak_log', 'birch_log', 'spruce_log'];
const WOOL = ['white_wool', 'orange_wool', 'red_wool', 'yellow_wool', 'green_wool',
  'blue_wool', 'purple_wool', 'black_wool', 'brown_wool', 'light_gray_wool'];
const COALS = ['coal', 'charcoal'];
const SANDS = ['sand', 'red_sand'];
const COBBLES = ['cobblestone', 'cobbled_deepslate'];
const STONES = ['stone', 'smooth_stone'];

// ------------------------------------------------------------------ builders

function ingredient(spec, where) {
  const list = Array.isArray(spec) ? spec.slice() : [spec];
  if (list.length === 0) throw new Error(`recipe ${where}: empty ingredient`);
  for (const n of list) {
    if (!ITEMS[n]) throw new Error(`recipe ${where}: unknown ingredient "${n}"`);
  }
  return list;
}

/**
 * Strip blank rows and columns so a padded pattern such as `[' X ', ' # ']`
 * compares equal to the tight bounding box of whatever sits in the grid.
 */
function trimPattern(pattern) {
  const w = pattern.reduce((m, r) => Math.max(m, r.length), 0);
  const rows = pattern.map((r) => r.padEnd(w, ' '));
  while (rows.length && rows[0].trim() === '') rows.shift();
  while (rows.length && rows[rows.length - 1].trim() === '') rows.pop();
  if (rows.length === 0) return [];
  let x0 = 0;
  let x1 = w - 1;
  const colBlank = (c) => rows.every((r) => r[c] === ' ');
  while (x0 <= x1 && colBlank(x0)) x0++;
  while (x1 >= x0 && colBlank(x1)) x1--;
  return rows.map((r) => r.slice(x0, x1 + 1));
}

/** `pattern` rows use single characters; `key` maps each to an item or a list. */
export function shaped(output, count, pattern, key) {
  if (!ITEMS[output]) throw new Error(`recipe output: unknown item "${output}"`);
  const rows = trimPattern(pattern);
  if (rows.length === 0) throw new Error(`recipe ${output}: empty pattern`);
  const resolved = Object.create(null);
  for (const ch of Object.keys(key)) resolved[ch] = ingredient(key[ch], output);
  for (const row of rows) {
    for (const ch of row) {
      if (ch !== ' ' && !resolved[ch]) throw new Error(`recipe ${output}: pattern char "${ch}" has no key`);
    }
  }
  return {
    type: 'shaped', output, count,
    pattern: rows, key: resolved,
    width: rows[0].length, height: rows.length,
    mirror: true, ingredients: null,
  };
}

export function shapeless(output, count, ingredients) {
  if (!ITEMS[output]) throw new Error(`recipe output: unknown item "${output}"`);
  if (!ingredients.length || ingredients.length > 9) throw new Error(`recipe ${output}: bad ingredient count`);
  return {
    type: 'shapeless', output, count,
    ingredients: ingredients.map((g) => ingredient(g, output)),
    pattern: null, key: null, width: 0, height: 0, mirror: false,
  };
}

export const RECIPES = [];
const add = (r) => { RECIPES.push(r); return r; };

// ------------------------------------------------------------------ wood

// PLANKS and LOGS are parallel by wood type, so one log yields its own planks.
for (let i = 0; i < LOGS.length; i++) add(shapeless(PLANKS[i], 4, [LOGS[i]]));
add(shaped('stick', 4, ['X', 'X'], { X: PLANKS }));
add(shaped('torch', 4, ['X', 'Y'], { X: COALS, Y: 'stick' }));
add(shaped('ladder', 3, ['X X', 'XXX', 'X X'], { X: 'stick' }));

// ------------------------------------------------------------------ utility blocks

add(shaped('crafting_table', 1, ['XX', 'XX'], { X: PLANKS }));
add(shaped('chest', 1, ['XXX', 'X X', 'XXX'], { X: PLANKS }));
add(shaped('furnace', 1, ['XXX', 'X X', 'XXX'], { X: COBBLES }));
add(shaped('bookshelf', 1, ['XXX', 'YYY', 'XXX'], { X: PLANKS, Y: 'book' }));
add(shaped('tnt', 1, ['XYX', 'YXY', 'XYX'], { X: 'gunpowder', Y: SANDS }));
add(shaped('jack_o_lantern', 1, ['X', 'Y'], { X: 'pumpkin', Y: 'torch' }));

// ------------------------------------------------------------------ carpentry

add(shaped('oak_door', 3, ['XX', 'XX', 'XX'], { X: PLANKS }));
add(shaped('oak_fence', 3, ['XYX', 'XYX'], { X: PLANKS, Y: 'stick' }));
add(shaped('red_bed', 1, ['XXX', 'YYY'], { X: WOOL, Y: PLANKS }));
add(shaped('oak_slab', 6, ['XXX'], { X: PLANKS }));
add(shaped('stone_slab', 6, ['XXX'], { X: STONES }));
add(shaped('oak_stairs', 4, ['X  ', 'XX ', 'XXX'], { X: PLANKS }));
add(shaped('cobblestone_stairs', 4, ['X  ', 'XX ', 'XXX'], { X: 'cobblestone' }));
add(shaped('stone_brick_stairs', 4, ['X  ', 'XX ', 'XXX'], { X: 'stone_bricks' }));
add(shaped('glass_pane', 16, ['XXX', 'XXX'], { X: 'glass' }));
add(shaped('iron_bars', 16, ['XXX', 'XXX'], { X: 'iron_ingot' }));

// ------------------------------------------------------------------ masonry

add(shaped('stone_bricks', 4, ['XX', 'XX'], { X: 'stone' }));
add(shaped('chiseled_stone_bricks', 1, ['X', 'X'], { X: 'stone_slab' }));
add(shapeless('mossy_stone_bricks', 1, ['stone_bricks', 'vine']));
add(shapeless('mossy_cobblestone', 1, ['cobblestone', 'vine']));
add(shaped('sandstone', 1, ['XX', 'XX'], { X: SANDS }));
add(shaped('bricks', 1, ['XX', 'XX'], { X: 'brick' }));
add(shaped('clay', 1, ['XX', 'XX'], { X: 'clay_ball' }));
add(shaped('snow_block', 1, ['XX', 'XX'], { X: 'snowball' }));
add(shaped('glowstone', 1, ['XX', 'XX'], { X: 'glowstone_dust' }));
add(shaped('white_wool', 1, ['XX', 'XX'], { X: 'string' }));
add(shaped('coarse_dirt', 4, ['XY', 'YX'], { X: 'dirt', Y: 'gravel' }));
// Only one bed and one carpet colour exist as blocks, and no dyes exist to
// recolour wool, so both accept any wool rather than becoming dead content.
add(shaped('red_carpet', 3, ['XX'], { X: WOOL }));
add(shaped('packed_ice', 1, ['XXX', 'XXX', 'XXX'], { X: 'ice' }));

// ------------------------------------------------------------------ storage blocks + reversals

for (const [block, unit] of [
  ['coal_block', 'coal'],
  ['iron_block', 'iron_ingot'],
  ['gold_block', 'gold_ingot'],
  ['diamond_block', 'diamond'],
  ['emerald_block', 'emerald'],
  ['lapis_block', 'lapis_lazuli'],
]) {
  add(shaped(block, 1, ['XXX', 'XXX', 'XXX'], { X: unit }));
  add(shapeless(unit, 9, [block]));
}
add(shaped('hay_block', 1, ['XXX', 'XXX', 'XXX'], { X: 'wheat' }));
add(shapeless('wheat', 9, ['hay_block']));
add(shaped('melon', 1, ['XXX', 'XXX', 'XXX'], { X: 'melon_slice' }));

// ------------------------------------------------------------------ tools

const TOOL_MATERIALS = [
  ['wooden', PLANKS],
  ['stone', COBBLES],
  ['iron', 'iron_ingot'],
  ['golden', 'gold_ingot'],
  ['diamond', 'diamond'],
];
for (const [prefix, mat] of TOOL_MATERIALS) {
  add(shaped(`${prefix}_pickaxe`, 1, ['XXX', ' Y ', ' Y '], { X: mat, Y: 'stick' }));
  add(shaped(`${prefix}_axe`, 1, ['XX ', 'XY ', ' Y '], { X: mat, Y: 'stick' }));
  add(shaped(`${prefix}_shovel`, 1, [' X ', ' Y ', ' Y '], { X: mat, Y: 'stick' }));
  add(shaped(`${prefix}_sword`, 1, [' X ', ' X ', ' Y '], { X: mat, Y: 'stick' }));
  add(shaped(`${prefix}_hoe`, 1, ['XX ', ' Y ', ' Y '], { X: mat, Y: 'stick' }));
}

add(shaped('shears', 1, [' X', 'X '], { X: 'iron_ingot' }));
add(shaped('bucket', 1, ['X X', ' X '], { X: 'iron_ingot' }));
add(shaped('bowl', 4, ['X X', ' X '], { X: PLANKS }));
add(shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']));
add(shaped('bow', 1, [' XY', 'X Y', ' XY'], { X: 'stick', Y: 'string' }));
add(shaped('arrow', 4, ['X', 'Y', 'Z'], { X: 'flint', Y: 'stick', Z: 'feather' }));

// ------------------------------------------------------------------ armour

const ARMOR_MATERIALS = [
  ['leather', 'leather'],
  ['iron', 'iron_ingot'],
  ['golden', 'gold_ingot'],
  ['diamond', 'diamond'],
];
for (const [prefix, mat] of ARMOR_MATERIALS) {
  add(shaped(`${prefix}_helmet`, 1, ['XXX', 'X X'], { X: mat }));
  add(shaped(`${prefix}_chestplate`, 1, ['X X', 'XXX', 'XXX'], { X: mat }));
  add(shaped(`${prefix}_leggings`, 1, ['XXX', 'X X', 'X X'], { X: mat }));
  add(shaped(`${prefix}_boots`, 1, ['X X', 'X X'], { X: mat }));
}

// ------------------------------------------------------------------ paper, food, sundries

add(shaped('paper', 3, ['XXX'], { X: 'sugar_cane' }));
add(shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']));
add(shapeless('bone_meal', 3, ['bone']));
add(shaped('bread', 1, ['XXX'], { X: 'wheat' }));
// Vanilla sweetens cookies with cocoa beans; sugar cane is the sweetener this
// world actually grows, so it stands in for them.
add(shaped('cookie', 8, ['XYX'], { X: 'wheat', Y: 'sugar_cane' }));
add(shaped('golden_apple', 1, ['XXX', 'XYX', 'XXX'], { X: 'gold_ingot', Y: 'apple' }));

// ------------------------------------------------------------------ matching

function cellName(stack) {
  return stack && !stack.isEmpty ? stack.name : null;
}

function fits(recipe, names, gw, ox, oy, mirror) {
  const { pattern, key, width, height } = recipe;
  for (let y = 0; y < height; y++) {
    const row = pattern[y];
    for (let x = 0; x < width; x++) {
      const ch = row[mirror ? width - 1 - x : x];
      const name = names[(oy + y) * gw + ox + x];
      if (ch === ' ') {
        if (name !== null) return false;
      } else if (name === null || !key[ch].includes(name)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * A shaped recipe matches when the filled cells' bounding box is exactly the
 * recipe's size and every cell agrees — which is what lets a pickaxe crafted
 * in the left columns of a 3x3 grid work just as well as a centred one.
 */
function matchShaped(recipe, names, gw, gh) {
  let x0 = gw;
  let y0 = gh;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (names[y * gw + x] === null) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return false;
  if (x1 - x0 + 1 !== recipe.width || y1 - y0 + 1 !== recipe.height) return false;
  return fits(recipe, names, gw, x0, y0, false) ||
         (recipe.mirror && fits(recipe, names, gw, x0, y0, true));
}

/** Multiset match. Backtracks because ingredients may accept alternatives. */
function matchShapeless(recipe, names) {
  const pool = [];
  for (const n of names) if (n !== null) pool.push(n);
  const want = recipe.ingredients;
  if (pool.length !== want.length) return false;

  const used = new Array(pool.length).fill(false);
  const place = (i) => {
    if (i === want.length) return true;
    for (let j = 0; j < pool.length; j++) {
      if (used[j] || !want[i].includes(pool[j])) continue;
      used[j] = true;
      if (place(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return place(0);
}

function consumeGrid(grid, n) {
  const limit = Math.min(n, grid.length);
  for (let i = 0; i < limit; i++) {
    const s = grid[i];
    if (!s || s.isEmpty) continue;
    s.shrink(1);
    if (s.isEmpty) grid[i] = ItemStack.EMPTY;
  }
}

/**
 * Resolve a crafting grid. `gridStacks` is row-major and may hold null or
 * ItemStack.EMPTY. Returns the output plus a `consume` that takes one of every
 * ingredient back out of the grid it is handed.
 */
export function findRecipe(gridStacks, gridW) {
  if (!gridStacks || !gridW || gridW < 1) return null;
  const gw = gridW | 0;
  const gh = Math.floor(gridStacks.length / gw);
  if (gh < 1) return null;

  const cells = gw * gh;
  const names = new Array(cells);
  let filled = 0;
  for (let i = 0; i < cells; i++) {
    const n = cellName(gridStacks[i]);
    names[i] = n;
    if (n !== null) filled++;
  }
  if (filled === 0) return null;

  for (const recipe of RECIPES) {
    const ok = recipe.type === 'shaped'
      ? matchShaped(recipe, names, gw, gh)
      : matchShapeless(recipe, names);
    if (!ok) continue;
    return {
      recipe,
      output: new ItemStack(recipe.output, recipe.count),
      consume: (grid) => consumeGrid(grid || gridStacks, cells),
    };
  }
  return null;
}

/** Every way to make `itemName`, for the recipe book. */
export function recipesFor(itemName) {
  return RECIPES.filter((r) => r.output === itemName);
}
