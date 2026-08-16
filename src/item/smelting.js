// Furnace tables: what smelts into what and the xp each result grants, plus how
// long every fuel burns. Both tables are checked against the item registry at
// load so a typo fails loudly instead of producing a dead furnace.

import { ITEMS } from './items.js';

/** Ticks one item takes in a furnace (10 s at 20 tps). */
export const SMELT_TICKS = 200;

export const SMELTING = Object.create(null);

/** `smelt('iron_ingot', 0.7, 'iron_ore', 'raw_iron')` — one result, many inputs. */
function smelt(out, xp, ...inputs) {
  for (const input of inputs) SMELTING[input] = { out, xp };
}

// --- ores -----------------------------------------------------------------
smelt('iron_ingot', 0.7, 'iron_ore', 'deepslate_iron_ore', 'raw_iron');
smelt('gold_ingot', 1.0, 'gold_ore', 'deepslate_gold_ore', 'raw_gold');
smelt('copper_ingot', 0.7, 'copper_ore', 'raw_copper');
smelt('coal', 0.1, 'coal_ore', 'deepslate_coal_ore');
smelt('diamond', 1.0, 'diamond_ore', 'deepslate_diamond_ore');
smelt('emerald', 1.0, 'emerald_ore');
smelt('lapis_lazuli', 0.2, 'lapis_ore', 'deepslate_lapis_ore');
smelt('redstone', 0.7, 'redstone_ore', 'deepslate_redstone_ore');

// --- stone, sand, clay ----------------------------------------------------
smelt('stone', 0.1, 'cobblestone');
smelt('smooth_stone', 0.1, 'stone');
smelt('deepslate', 0.1, 'cobbled_deepslate');
smelt('cracked_stone_bricks', 0.1, 'stone_bricks');
smelt('glass', 0.1, 'sand', 'red_sand');
smelt('brick', 0.3, 'clay_ball');

// --- wood -----------------------------------------------------------------
smelt('charcoal', 0.15, 'oak_log', 'birch_log', 'spruce_log');

// --- food -----------------------------------------------------------------
smelt('cooked_porkchop', 0.35, 'porkchop');
smelt('cooked_beef', 0.35, 'beef');
smelt('cooked_chicken', 0.35, 'chicken');
smelt('cooked_mutton', 0.35, 'mutton');
smelt('baked_potato', 0.35, 'potato');

/**
 * Burn time in ticks per fuel item. This table wins over the `fuel` field the
 * item registry derives from flammability, so entries of 0 genuinely mean
 * "not a fuel" (leaves and TNT burn in the world but not in a furnace).
 */
export const FUEL = {
  lava_bucket: 20000,
  coal_block: 16000,
  coal: 1600,
  charcoal: 1600,

  oak_log: 300,
  birch_log: 300,
  spruce_log: 300,
  oak_planks: 300,
  birch_planks: 300,
  spruce_planks: 300,
  oak_stairs: 300,
  oak_fence: 300,
  crafting_table: 300,
  bookshelf: 300,
  chest: 300,
  ladder: 300,
  bow: 300,
  oak_slab: 150,

  oak_door: 200,
  bowl: 200,
  wooden_pickaxe: 200,
  wooden_axe: 200,
  wooden_shovel: 200,
  wooden_sword: 200,
  wooden_hoe: 200,

  stick: 100,
  oak_sapling: 100,
  dead_bush: 100,
  white_wool: 100,
  orange_wool: 100,
  red_wool: 100,
  yellow_wool: 100,
  green_wool: 100,
  blue_wool: 100,
  purple_wool: 100,
  black_wool: 100,
  brown_wool: 100,
  light_gray_wool: 100,

  red_carpet: 67,

  oak_leaves: 0,
  birch_leaves: 0,
  spruce_leaves: 0,
  tnt: 0,
};

// Fail fast on a bad name rather than shipping a recipe nobody can trigger.
for (const input of Object.keys(SMELTING)) {
  if (!ITEMS[input]) throw new Error(`smelting: unknown input "${input}"`);
  if (!ITEMS[SMELTING[input].out]) throw new Error(`smelting: unknown output "${SMELTING[input].out}"`);
}
for (const name of Object.keys(FUEL)) {
  if (!ITEMS[name]) throw new Error(`fuel: unknown item "${name}"`);
}

/** `{out, xp}` for a smeltable item, or null. */
export function smeltResult(itemName) {
  return (itemName && SMELTING[itemName]) || null;
}

/** Burn time in ticks; 0 when the item cannot fuel a furnace. */
export function fuelTicks(itemName) {
  if (!itemName) return 0;
  // hasOwnProperty, not `in`: a plain object literal inherits Object.prototype.
  if (Object.prototype.hasOwnProperty.call(FUEL, itemName)) return FUEL[itemName];
  return ITEMS[itemName]?.fuel || 0;
}
