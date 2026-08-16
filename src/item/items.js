// Item registry. Every placeable block automatically gets an item form; this
// file adds the loose items (tools, food, materials) and the stats that drive
// mining speed, combat and eating.

import { B, BLOCKS, BLOCK_COUNT, ToolType, Tier, RenderType } from '../world/blocks.js';

export { ToolType, Tier };

/** Tool material stats, matching Java Edition. */
export const MATERIALS = {
  wood:      { tier: Tier.WOOD,      durability: 59,   speed: 2,  damageBonus: 0, enchantability: 15 },
  gold:      { tier: Tier.GOLD,      durability: 32,   speed: 12, damageBonus: 0, enchantability: 22 },
  stone:     { tier: Tier.STONE,     durability: 131,  speed: 4,  damageBonus: 1, enchantability: 5 },
  iron:      { tier: Tier.IRON,      durability: 250,  speed: 6,  damageBonus: 2, enchantability: 14 },
  diamond:   { tier: Tier.DIAMOND,   durability: 1561, speed: 8,  damageBonus: 3, enchantability: 10 },
  netherite: { tier: Tier.NETHERITE, durability: 2031, speed: 9,  damageBonus: 4, enchantability: 15 },
};

/** Base attack damage per tool class, before the material bonus. */
const BASE_DAMAGE = {
  [ToolType.SWORD]: 4,
  [ToolType.AXE]: 6,
  [ToolType.PICKAXE]: 1,
  [ToolType.SHOVEL]: 1.5,
  [ToolType.HOE]: 0,
};

/** Attacks per second — drives the vanilla cooldown swing bar. */
const ATTACK_SPEED = {
  [ToolType.SWORD]: 1.6,
  [ToolType.AXE]: 1.0,
  [ToolType.PICKAXE]: 1.2,
  [ToolType.SHOVEL]: 1.0,
  [ToolType.HOE]: 1.0,
};

/** Armour slot indices. */
export const ArmorSlot = { HELMET: 0, CHESTPLATE: 1, LEGGINGS: 2, BOOTS: 3 };

export const ITEMS = Object.create(null);
/** Ordered list, used by the creative inventory and by save/load id mapping. */
export const ITEM_LIST = [];

const ITEM_DEFAULTS = {
  name: '',
  display: '',
  maxStack: 64,
  tex: null,           // atlas key; defaults to the item name
  block: 0,            // block id placed on use, 0 = not placeable
  tool: ToolType.NONE,
  material: null,      // key into MATERIALS
  durability: 0,       // 0 = indestructible
  speed: 1,            // mining speed multiplier when correct tool
  damage: 1,           // attack damage
  attackSpeed: 4,      // attacks per second
  tier: Tier.HAND,
  food: null,          // { hunger, saturation, eatTime, alwaysEdible, effects }
  armor: null,         // { slot, points, toughness }
  fuel: 0,             // burn time in ticks when used in a furnace
  rarity: 0,           // 0 common, 1 uncommon (blue), 2 rare (aqua), 3 epic (purple)
  quest: false,        // quest items cannot be dropped or destroyed
  desc: null,          // flavour line shown in the tooltip
  onUse: null,         // (game, player, hit) => boolean handled
};

function item(o) {
  const it = Object.assign({}, ITEM_DEFAULTS, o);
  if (!it.display) it.display = titleCase(it.name);
  if (it.tex === null) it.tex = it.name;
  if (it.material) {
    const m = MATERIALS[it.material];
    it.tier = m.tier;
    it.durability = m.durability;
    it.speed = m.speed;
    it.damage = (BASE_DAMAGE[it.tool] ?? 0) + m.damageBonus + 1;
    it.attackSpeed = ATTACK_SPEED[it.tool] ?? 4;
    it.maxStack = 1;
  }
  if (it.durability > 0) it.maxStack = 1;
  if (ITEMS[it.name]) throw new Error(`duplicate item ${it.name}`);
  ITEMS[it.name] = it;
  ITEM_LIST.push(it);
  return it;
}

function titleCase(s) {
  return s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ---------------------------------------------------------------- block items
// Every block that makes sense in an inventory becomes an item with the same
// name. Non-placeable technical blocks are skipped.

const SKIP_BLOCK_ITEM = new Set([
  B.AIR, B.WATER, B.LAVA, B.FURNACE_LIT, B.WALL_TORCH, B.FARMLAND, B.FARMLAND_WET,
  B.OAK_DOOR_LOWER, B.OAK_DOOR_UPPER, B.BED_FOOT, B.BED_HEAD, B.WHEAT,
  B.RUNE_STONE_LIT, B.EMBER_CORE_BLOCK, B.MONSTER_SPAWNER, B.BEACON_PEDESTAL,
  B.EMBER_LANTERN_LIT,
]);

for (let id = 1; id < BLOCK_COUNT; id++) {
  const b = BLOCKS[id];
  if (!b || b.id !== id || SKIP_BLOCK_ITEM.has(id)) continue;
  item({
    name: b.name,
    display: b.display,
    block: id,
    tex: null,
    fuel: b.flammable && b.render === RenderType.CUBE ? 300 : 0,
  });
}

// Fix up the handful of block items whose fuel value is special.
if (ITEMS.oak_planks) { ITEMS.oak_planks.fuel = ITEMS.birch_planks.fuel = ITEMS.spruce_planks.fuel = 300; }
if (ITEMS.oak_log) { ITEMS.oak_log.fuel = ITEMS.birch_log.fuel = ITEMS.spruce_log.fuel = 300; }
if (ITEMS.crafting_table) ITEMS.crafting_table.fuel = 300;
if (ITEMS.bookshelf) ITEMS.bookshelf.fuel = 300;
if (ITEMS.coal_block) ITEMS.coal_block.fuel = 16000;
if (ITEMS.oak_fence) ITEMS.oak_fence.fuel = 300;
if (ITEMS.oak_slab) ITEMS.oak_slab.fuel = 150;
if (ITEMS.ladder) ITEMS.ladder.fuel = 300;
if (ITEMS.torch) { ITEMS.torch.maxStack = 64; }

// ---------------------------------------------------------------- placeable items with special blocks

item({ name: 'oak_door', display: 'Oak Door', maxStack: 64, block: B.OAK_DOOR_LOWER, fuel: 200 });
item({ name: 'red_bed', display: 'Red Bed', maxStack: 1, block: B.BED_FOOT });

// ---------------------------------------------------------------- materials

item({ name: 'stick', display: 'Stick', fuel: 100 });
item({ name: 'coal', display: 'Coal', fuel: 1600 });
item({ name: 'charcoal', display: 'Charcoal', fuel: 1600 });
item({ name: 'raw_iron', display: 'Raw Iron' });
item({ name: 'raw_gold', display: 'Raw Gold' });
item({ name: 'raw_copper', display: 'Raw Copper' });
item({ name: 'iron_ingot', display: 'Iron Ingot' });
item({ name: 'gold_ingot', display: 'Gold Ingot' });
item({ name: 'copper_ingot', display: 'Copper Ingot' });
item({ name: 'diamond', display: 'Diamond', rarity: 0 });
item({ name: 'emerald', display: 'Emerald' });
item({ name: 'lapis_lazuli', display: 'Lapis Lazuli' });
item({ name: 'redstone', display: 'Redstone Dust' });
item({ name: 'glowstone_dust', display: 'Glowstone Dust' });
item({ name: 'flint', display: 'Flint' });
item({ name: 'clay_ball', display: 'Clay Ball' });
item({ name: 'brick', display: 'Brick' });
item({ name: 'string', display: 'String' });
item({ name: 'feather', display: 'Feather' });
item({ name: 'leather', display: 'Leather' });
item({ name: 'bone', display: 'Bone' });
item({ name: 'bone_meal', display: 'Bone Meal' });
item({ name: 'gunpowder', display: 'Gunpowder' });
item({ name: 'spider_eye', display: 'Spider Eye' });
item({ name: 'rotten_flesh', display: 'Rotten Flesh', food: { hunger: 4, saturation: 0.8, eatTime: 1.6 } });
item({ name: 'ender_pearl', display: 'Ender Pearl', maxStack: 16 });
item({ name: 'slimeball', display: 'Slimeball' });
item({ name: 'paper', display: 'Paper' });
item({ name: 'book', display: 'Book' });
item({ name: 'wheat', display: 'Wheat' });
item({ name: 'wheat_seeds', display: 'Wheat Seeds', block: B.WHEAT });
item({ name: 'snowball', display: 'Snowball', maxStack: 16 });
item({ name: 'bowl', display: 'Bowl', fuel: 200 });
item({ name: 'bucket', display: 'Bucket', maxStack: 16 });
item({ name: 'water_bucket', display: 'Water Bucket', maxStack: 1 });
item({ name: 'lava_bucket', display: 'Lava Bucket', maxStack: 1, fuel: 20000 });
item({ name: 'arrow', display: 'Arrow' });
item({ name: 'melon_slice', display: 'Melon Slice', food: { hunger: 2, saturation: 1.2, eatTime: 1.6 } });

// ---------------------------------------------------------------- food

item({ name: 'apple', display: 'Apple', food: { hunger: 4, saturation: 2.4, eatTime: 1.6 } });
item({ name: 'bread', display: 'Bread', food: { hunger: 5, saturation: 6, eatTime: 1.6 } });
item({ name: 'porkchop', display: 'Raw Porkchop', food: { hunger: 3, saturation: 1.8, eatTime: 1.6 } });
item({ name: 'cooked_porkchop', display: 'Cooked Porkchop', food: { hunger: 8, saturation: 12.8, eatTime: 1.6 } });
item({ name: 'beef', display: 'Raw Beef', food: { hunger: 3, saturation: 1.8, eatTime: 1.6 } });
item({ name: 'cooked_beef', display: 'Steak', food: { hunger: 8, saturation: 12.8, eatTime: 1.6 } });
item({ name: 'chicken', display: 'Raw Chicken', food: { hunger: 2, saturation: 1.2, eatTime: 1.6 } });
item({ name: 'cooked_chicken', display: 'Cooked Chicken', food: { hunger: 6, saturation: 7.2, eatTime: 1.6 } });
item({ name: 'mutton', display: 'Raw Mutton', food: { hunger: 2, saturation: 1.2, eatTime: 1.6 } });
item({ name: 'cooked_mutton', display: 'Cooked Mutton', food: { hunger: 6, saturation: 9.6, eatTime: 1.6 } });
item({ name: 'carrot', display: 'Carrot', food: { hunger: 3, saturation: 3.6, eatTime: 1.6 } });
item({ name: 'potato', display: 'Potato', food: { hunger: 1, saturation: 0.6, eatTime: 1.6 } });
item({ name: 'baked_potato', display: 'Baked Potato', food: { hunger: 5, saturation: 6, eatTime: 1.6 } });
item({ name: 'cookie', display: 'Cookie', food: { hunger: 2, saturation: 0.4, eatTime: 1.6 } });
item({
  name: 'golden_apple', display: 'Golden Apple', rarity: 1,
  food: { hunger: 4, saturation: 9.6, eatTime: 1.6, alwaysEdible: true, effects: [{ id: 'regeneration', duration: 5, amplifier: 1 }, { id: 'absorption', duration: 120, amplifier: 0 }] },
});

// ---------------------------------------------------------------- tools

for (const [mat, texPrefix] of [['wood', 'wooden'], ['stone', 'stone'], ['iron', 'iron'], ['gold', 'golden'], ['diamond', 'diamond']]) {
  item({ name: `${texPrefix}_pickaxe`, display: `${titleCase(texPrefix)} Pickaxe`, tool: ToolType.PICKAXE, material: mat, fuel: mat === 'wood' ? 200 : 0 });
  item({ name: `${texPrefix}_axe`, display: `${titleCase(texPrefix)} Axe`, tool: ToolType.AXE, material: mat, fuel: mat === 'wood' ? 200 : 0 });
  item({ name: `${texPrefix}_shovel`, display: `${titleCase(texPrefix)} Shovel`, tool: ToolType.SHOVEL, material: mat, fuel: mat === 'wood' ? 200 : 0 });
  item({ name: `${texPrefix}_sword`, display: `${titleCase(texPrefix)} Sword`, tool: ToolType.SWORD, material: mat, fuel: mat === 'wood' ? 200 : 0 });
  item({ name: `${texPrefix}_hoe`, display: `${titleCase(texPrefix)} Hoe`, tool: ToolType.HOE, material: mat, fuel: mat === 'wood' ? 200 : 0 });
}

item({ name: 'shears', display: 'Shears', tool: ToolType.SHEARS, durability: 238, speed: 5, damage: 1, attackSpeed: 4, tier: Tier.HAND });
item({ name: 'flint_and_steel', display: 'Flint and Steel', durability: 64 });
item({ name: 'bow', display: 'Bow', durability: 384, damage: 1, attackSpeed: 4 });

// ---------------------------------------------------------------- armour

const ARMOR_SETS = {
  leather: { tex: 'leather', points: [1, 3, 2, 1], toughness: 0, durability: [55, 80, 75, 65] },
  iron:    { tex: 'iron',    points: [2, 6, 5, 2], toughness: 0, durability: [165, 240, 225, 195] },
  golden:  { tex: 'golden',  points: [2, 5, 3, 1], toughness: 0, durability: [77, 112, 105, 91] },
  diamond: { tex: 'diamond', points: [3, 8, 6, 3], toughness: 2, durability: [363, 528, 495, 429] },
};
const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];

for (const [setName, set] of Object.entries(ARMOR_SETS)) {
  ARMOR_PIECES.forEach((piece, slot) => {
    item({
      name: `${setName}_${piece}`,
      display: `${titleCase(setName)} ${titleCase(piece)}`,
      durability: set.durability[slot],
      armor: { slot, points: set.points[slot], toughness: set.toughness },
    });
  });
}

// ---------------------------------------------------------------- story items

item({
  name: 'ember_shard', display: 'Ember Shard', rarity: 2, maxStack: 16,
  desc: 'Warm to the touch. It remembers the fire.',
});
item({
  name: 'ember_core', display: 'The Ember Core', rarity: 3, maxStack: 1, quest: true,
  desc: 'The heart of the beacon. It hums against your palm.',
});
item({
  name: 'miras_journal', display: "Mira's Journal", rarity: 1, maxStack: 1, quest: true,
  desc: 'Water-stained. Half the pages are torn out.',
});
item({
  name: 'hollow_key', display: 'Hollow Key', rarity: 2, maxStack: 1, quest: true,
  desc: 'Cold iron, cut with a rune you cannot read.',
});
item({
  name: 'torvins_hammer', display: "Torvin's Hammer", rarity: 2, maxStack: 1,
  tool: ToolType.PICKAXE, durability: 500, speed: 9, damage: 6, attackSpeed: 1.1,
  tier: Tier.IRON, desc: 'Forged for the deep. Heavier than it looks.',
});
item({
  name: 'wardens_bane', display: "Warden's Bane", rarity: 3, maxStack: 1,
  tool: ToolType.SWORD, durability: 800, speed: 1, damage: 9, attackSpeed: 1.6,
  tier: Tier.IRON, desc: 'It drinks the dark.',
});
item({ name: 'village_bread', display: 'Honeyed Bread', food: { hunger: 6, saturation: 8, eatTime: 1.6 }, desc: 'Pim insisted you take it.' });

// ---------------------------------------------------------------- lookups

/** Item name -> numeric id, stable across a run. Used by the save format. */
export const ITEM_ID = Object.create(null);
ITEM_LIST.forEach((it, i) => { it.id = i; ITEM_ID[it.name] = i; });

export const getItem = (name) => ITEMS[name] || null;
export const itemById = (id) => ITEM_LIST[id] || null;

/** The item that places a given block. */
export function itemForBlock(blockId) {
  const b = BLOCKS[blockId];
  return b ? ITEMS[b.name] || null : null;
}

/** True when this item can be swung to mine `block` at full speed. */
export function isCorrectTool(itemName, block) {
  if (!block || block.tool === ToolType.NONE) return true;
  const it = ITEMS[itemName];
  if (!it) return false;
  if (it.tool !== block.tool) return false;
  return it.tier >= block.tier;
}

/** True when mining `block` with `itemName` yields a drop at all. */
export function canHarvest(itemName, block) {
  if (!block.requiresTool) return true;
  const it = itemName ? ITEMS[itemName] : null;
  if (!it) return false;
  if (block.tool !== ToolType.NONE && it.tool !== block.tool) return false;
  return it.tier >= block.tier;
}

/**
 * Vanilla block-breaking time, in seconds.
 * speedMultiplier = tool speed (1 by hand), then /5 if not the correct tool
 * for a tool-requiring block, then /5 again if the tool can't harvest it.
 */
export function breakTimeSeconds(block, itemName, opts = {}) {
  const hardness = block.hardness;
  if (hardness < 0) return Infinity;
  if (hardness === 0) return 0;

  const it = itemName ? ITEMS[itemName] : null;
  let speed = 1;
  if (it && it.tool !== ToolType.NONE && it.tool === block.tool) speed = it.speed;
  else if (it && it.tool === ToolType.SHEARS && (block.name.endsWith('_leaves') || block.name === 'cobweb')) speed = 15;

  const harvest = canHarvest(itemName, block);

  if (opts.haste) speed *= 1 + 0.2 * opts.haste;
  if (opts.miningFatigue) speed *= Math.pow(0.3, Math.min(opts.miningFatigue, 4));
  if (opts.inWater && !opts.aquaAffinity) speed /= 5;
  if (!opts.onGround) speed /= 5;

  const damagePerTick = speed / hardness / (harvest ? 30 : 100);
  if (damagePerTick >= 1) return 0;
  return Math.ceil(1 / damagePerTick) / 20;
}

/** Damage a hand-held item deals, including the bare-hand case. */
export function attackDamage(itemName) {
  const it = itemName ? ITEMS[itemName] : null;
  return it ? it.damage : 1;
}

export function attackSpeedOf(itemName) {
  const it = itemName ? ITEMS[itemName] : null;
  return it ? it.attackSpeed : 4;
}

/** Rarity name colours, matching vanilla. */
export const RARITY_COLOR = [0xffffff, 0xffff55, 0x55ffff, 0xff55ff];
