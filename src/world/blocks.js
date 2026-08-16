// Block registry. Every block in the game is declared here exactly once, and
// every other module reads its behaviour from this table. Numeric ids are
// packed into chunk storage so they must stay stable across a save.
//
// Hardness / tool / drop values follow Minecraft Java Edition as closely as
// possible so that mining times feel identical.

// ------------------------------------------------------------------ enums

export const RenderType = {
  AIR: 0,        // nothing drawn
  CUBE: 1,       // full 16x16x16 cube
  CROSS: 2,      // two intersecting quads (flowers, grass, saplings)
  LIQUID: 3,     // water / lava, top surface lowered, animated
  TORCH: 4,      // small post + flame, may be wall-mounted
  SLAB: 5,       // bottom or top half
  STAIRS: 6,     // stair shape
  PANE: 7,       // thin centred quad (glass pane, iron bars)
  CROP: 8,       // 4 vertical quads, growth stages
  DOOR: 9,       // thin quad on one edge, openable
  FENCE: 10,     // post + connecting arms
  LADDER: 11,    // flat quad against a wall
  CARPET: 12,    // 1px slab
  SNOW_LAYER: 13,// variable-height layer
  BED: 14,       // two-part low box
};

export const ToolType = {
  NONE: 0,
  PICKAXE: 1,
  AXE: 2,
  SHOVEL: 3,
  HOE: 4,
  SHEARS: 5,
  SWORD: 6,
};

/** Harvest tiers. A tool harvests a block when tier >= block.tier. */
export const Tier = {
  HAND: 0,
  WOOD: 1,
  GOLD: 1,   // gold mines fast but harvests at wood level
  STONE: 2,
  IRON: 3,
  DIAMOND: 4,
  NETHERITE: 5,
};

/** Which footstep / break / place sound family a block uses. */
export const SoundGroup = {
  STONE: 'stone', GRASS: 'grass', DIRT: 'dirt', WOOD: 'wood', SAND: 'sand',
  GRAVEL: 'gravel', GLASS: 'glass', WOOL: 'wool', METAL: 'metal',
  PLANT: 'plant', SNOW: 'snow', LADDER: 'ladder', LIQUID: 'liquid',
};

/** Biome-driven colour multipliers applied at mesh time. */
export const Tint = { NONE: 0, GRASS: 1, FOLIAGE: 2, WATER: 3, REDSTONE: 4 };

// ------------------------------------------------------------------ ids

export const B = {
  AIR: 0,
  STONE: 1,
  GRANITE: 2,
  DIORITE: 3,
  ANDESITE: 4,
  DIRT: 5,
  COARSE_DIRT: 6,
  GRASS_BLOCK: 7,
  PODZOL: 8,
  MYCELIUM: 9,
  COBBLESTONE: 10,
  MOSSY_COBBLESTONE: 11,
  BEDROCK: 12,
  SAND: 13,
  RED_SAND: 14,
  SANDSTONE: 15,
  GRAVEL: 16,
  CLAY: 17,
  DEEPSLATE: 18,
  COBBLED_DEEPSLATE: 19,

  OAK_LOG: 20,
  BIRCH_LOG: 21,
  SPRUCE_LOG: 22,
  OAK_PLANKS: 23,
  BIRCH_PLANKS: 24,
  SPRUCE_PLANKS: 25,
  OAK_LEAVES: 26,
  BIRCH_LEAVES: 27,
  SPRUCE_LEAVES: 28,

  COAL_ORE: 30,
  IRON_ORE: 31,
  GOLD_ORE: 32,
  DIAMOND_ORE: 33,
  REDSTONE_ORE: 34,
  LAPIS_ORE: 35,
  EMERALD_ORE: 36,
  COPPER_ORE: 37,
  DEEPSLATE_COAL_ORE: 38,
  DEEPSLATE_IRON_ORE: 39,
  DEEPSLATE_GOLD_ORE: 40,
  DEEPSLATE_DIAMOND_ORE: 41,
  DEEPSLATE_REDSTONE_ORE: 42,
  DEEPSLATE_LAPIS_ORE: 43,

  GLASS: 50,
  OBSIDIAN: 51,
  BRICKS: 52,
  STONE_BRICKS: 53,
  CRACKED_STONE_BRICKS: 54,
  MOSSY_STONE_BRICKS: 55,
  CHISELED_STONE_BRICKS: 56,
  SMOOTH_STONE: 57,
  GLOWSTONE: 58,
  NETHERRACK: 59,
  ICE: 60,
  PACKED_ICE: 61,
  SNOW_BLOCK: 62,
  IRON_BLOCK: 63,
  GOLD_BLOCK: 64,
  DIAMOND_BLOCK: 65,
  EMERALD_BLOCK: 66,
  COAL_BLOCK: 67,
  LAPIS_BLOCK: 68,
  HAY_BLOCK: 69,
  BOOKSHELF: 70,
  CRAFTING_TABLE: 71,
  FURNACE: 72,
  FURNACE_LIT: 73,
  CHEST: 74,
  TNT: 75,
  PUMPKIN: 76,
  JACK_O_LANTERN: 77,
  MELON: 78,
  SPONGE: 79,

  WHITE_WOOL: 80,
  ORANGE_WOOL: 81,
  RED_WOOL: 82,
  YELLOW_WOOL: 83,
  GREEN_WOOL: 84,
  BLUE_WOOL: 85,
  PURPLE_WOOL: 86,
  BLACK_WOOL: 87,
  BROWN_WOOL: 88,
  LIGHT_GRAY_WOOL: 89,

  WATER: 90,
  LAVA: 91,

  TORCH: 100,
  WALL_TORCH: 101,
  LADDER: 102,
  OAK_DOOR_LOWER: 103,
  OAK_DOOR_UPPER: 104,
  OAK_FENCE: 105,
  OAK_SLAB: 106,
  STONE_SLAB: 107,
  COBBLESTONE_STAIRS: 108,
  OAK_STAIRS: 109,
  STONE_BRICK_STAIRS: 110,
  GLASS_PANE: 111,
  IRON_BARS: 112,
  SNOW_LAYER: 113,
  BED_FOOT: 114,
  BED_HEAD: 115,
  RED_CARPET: 116,

  GRASS_PLANT: 120,
  TALL_GRASS: 121,
  FERN: 122,
  DEAD_BUSH: 123,
  DANDELION: 124,
  POPPY: 125,
  BLUE_ORCHID: 126,
  CORNFLOWER: 127,
  RED_MUSHROOM: 128,
  BROWN_MUSHROOM: 129,
  CACTUS: 130,
  SUGAR_CANE: 131,
  WHEAT: 132,
  OAK_SAPLING: 133,
  VINE: 134,
  LILY_PAD: 135,

  FARMLAND: 140,
  FARMLAND_WET: 141,
  COBWEB: 142,
  MONSTER_SPAWNER: 143,

  // Story-mode blocks. Purely cosmetic/scripted, but real blocks so they can
  // be placed by structure generation and mined (or not) like anything else.
  EMBER_LANTERN: 150,
  EMBER_LANTERN_LIT: 151,
  RUNE_STONE: 152,
  RUNE_STONE_LIT: 153,
  WITHERED_STONE: 154,
  WITHERED_GRASS: 155,
  EMBER_CORE_BLOCK: 156,
  VILLAGE_PATH: 157,
  BEACON_PEDESTAL: 158,
};

export const BLOCK_COUNT = 256;

// ------------------------------------------------------------------ table

/** @type {Array<BlockDef|undefined>} indexed by block id. */
export const BLOCKS = new Array(BLOCK_COUNT);
/** Lookup by string name, e.g. `byName.grass_block`. */
export const byName = Object.create(null);

const DEFAULTS = {
  name: 'unknown',
  display: 'Unknown',
  render: RenderType.CUBE,
  tex: null,          // string | {top,bottom,side,north,south,east,west}
  hardness: 1,
  resistance: null,   // defaults to hardness * 5
  tool: ToolType.NONE,
  tier: Tier.HAND,
  requiresTool: false, // drops nothing unless a correct tool is used
  drops: null,        // null = drops itself; false = drops nothing; string/array/fn otherwise
  light: 0,           // 0-15 emission
  opacity: 15,        // how much sky light this block subtracts; 15 = fully blocks
  solid: true,        // has a collision box
  opaque: true,       // hides the neighbouring face
  fullCube: true,     // occupies the whole voxel (used for occlusion + AO)
  tint: Tint.NONE,
  sound: SoundGroup.STONE,
  flammable: false,
  gravity: false,     // falls when unsupported
  fluid: false,
  replaceable: false, // can be built over (air, grass, water, snow layer)
  slippery: 0.6,      // ground friction; ice is 0.98
  climbable: false,
  hurt: 0,            // contact damage per half-second (cactus, lava, fire)
  container: null,    // 'crafting' | 'furnace' | 'chest'
  xp: 0,              // [min,max] xp dropped when mined
  waterloggable: false,
  entity: false,      // has per-block state stored in the chunk's block-entity map
  breakParticleTex: null,
};

function def(id, o) {
  if (BLOCKS[id]) throw new Error(`duplicate block id ${id} (${o.name})`);
  const b = Object.assign({ id }, DEFAULTS, o);
  if (b.resistance === null) b.resistance = b.hardness * 5;
  if (b.tex === null) b.tex = b.name;
  // Normalise the texture spec into an explicit 6-face lookup: +X -X +Y -Y +Z -Z.
  const t = b.tex;
  let faces;
  if (typeof t === 'string') {
    faces = [t, t, t, t, t, t];
  } else {
    const side = t.side ?? t.all ?? b.name;
    faces = [
      t.east ?? side, t.west ?? side,
      t.top ?? t.all ?? side, t.bottom ?? t.top ?? t.all ?? side,
      t.south ?? side, t.north ?? side,
    ];
  }
  b.faceTex = faces;
  if (!b.breakParticleTex) b.breakParticleTex = faces[2];
  if (b.render === RenderType.AIR) { b.solid = false; b.opaque = false; b.fullCube = false; }
  if (b.render === RenderType.CROSS || b.render === RenderType.CROP) {
    b.solid = false; b.opaque = false; b.fullCube = false;
    if (b.opacity === 15) b.opacity = 0;
  }
  if (b.render === RenderType.LIQUID) {
    b.solid = false; b.opaque = false; b.fullCube = false;
  }
  BLOCKS[id] = b;
  byName[b.name] = b;
  return b;
}

// --- air ---------------------------------------------------------------
def(B.AIR, {
  name: 'air', display: 'Air', render: RenderType.AIR,
  hardness: 0, opacity: 0, replaceable: true, drops: false,
});

// --- stone family ------------------------------------------------------
def(B.STONE, {
  name: 'stone', display: 'Stone', hardness: 1.5, resistance: 6,
  tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true,
  drops: 'cobblestone', sound: SoundGroup.STONE,
});
def(B.GRANITE, { name: 'granite', display: 'Granite', hardness: 1.5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.DIORITE, { name: 'diorite', display: 'Diorite', hardness: 1.5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.ANDESITE, { name: 'andesite', display: 'Andesite', hardness: 1.5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.DEEPSLATE, {
  name: 'deepslate', display: 'Deepslate', hardness: 3, resistance: 6,
  tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true, drops: 'cobbled_deepslate',
  tex: { top: 'deepslate_top', bottom: 'deepslate_top', side: 'deepslate' },
});
def(B.COBBLED_DEEPSLATE, { name: 'cobbled_deepslate', display: 'Cobbled Deepslate', hardness: 3.5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.COBBLESTONE, {
  name: 'cobblestone', display: 'Cobblestone', hardness: 2, resistance: 6,
  tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true,
});
def(B.MOSSY_COBBLESTONE, { name: 'mossy_cobblestone', display: 'Mossy Cobblestone', hardness: 2, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.SMOOTH_STONE, { name: 'smooth_stone', display: 'Smooth Stone', hardness: 2, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.BEDROCK, {
  name: 'bedrock', display: 'Bedrock', hardness: -1, resistance: 3600000,
  tool: ToolType.PICKAXE, tier: Tier.NETHERITE, requiresTool: true, drops: false,
});
def(B.OBSIDIAN, {
  name: 'obsidian', display: 'Obsidian', hardness: 50, resistance: 1200,
  tool: ToolType.PICKAXE, tier: Tier.DIAMOND, requiresTool: true,
});

// --- soil --------------------------------------------------------------
def(B.DIRT, { name: 'dirt', display: 'Dirt', hardness: 0.5, tool: ToolType.SHOVEL, sound: SoundGroup.DIRT });
def(B.COARSE_DIRT, { name: 'coarse_dirt', display: 'Coarse Dirt', hardness: 0.5, tool: ToolType.SHOVEL, sound: SoundGroup.DIRT });
def(B.GRASS_BLOCK, {
  name: 'grass_block', display: 'Grass Block', hardness: 0.6,
  tool: ToolType.SHOVEL, drops: 'dirt', sound: SoundGroup.GRASS,
  tex: { top: 'grass_block_top', bottom: 'dirt', side: 'grass_block_side' },
  tint: Tint.GRASS, breakParticleTex: 'dirt',
});
def(B.PODZOL, {
  name: 'podzol', display: 'Podzol', hardness: 0.5, tool: ToolType.SHOVEL,
  drops: 'dirt', sound: SoundGroup.DIRT,
  tex: { top: 'podzol_top', bottom: 'dirt', side: 'podzol_side' },
});
def(B.MYCELIUM, {
  name: 'mycelium', display: 'Mycelium', hardness: 0.6, tool: ToolType.SHOVEL,
  drops: 'dirt', sound: SoundGroup.GRASS,
  tex: { top: 'mycelium_top', bottom: 'dirt', side: 'mycelium_side' },
});
def(B.SAND, { name: 'sand', display: 'Sand', hardness: 0.5, tool: ToolType.SHOVEL, sound: SoundGroup.SAND, gravity: true });
def(B.RED_SAND, { name: 'red_sand', display: 'Red Sand', hardness: 0.5, tool: ToolType.SHOVEL, sound: SoundGroup.SAND, gravity: true });
def(B.SANDSTONE, {
  name: 'sandstone', display: 'Sandstone', hardness: 0.8, tool: ToolType.PICKAXE,
  tier: Tier.WOOD, requiresTool: true,
  tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' },
});
def(B.GRAVEL, { name: 'gravel', display: 'Gravel', hardness: 0.6, tool: ToolType.SHOVEL, sound: SoundGroup.GRAVEL, gravity: true });
def(B.CLAY, { name: 'clay', display: 'Clay', hardness: 0.6, tool: ToolType.SHOVEL, sound: SoundGroup.DIRT, drops: { item: 'clay_ball', count: 4 } });
def(B.FARMLAND, {
  name: 'farmland', display: 'Farmland', hardness: 0.6, tool: ToolType.SHOVEL,
  drops: 'dirt', sound: SoundGroup.DIRT, fullCube: false, opaque: false,
  tex: { top: 'farmland', bottom: 'dirt', side: 'dirt' },
});
def(B.FARMLAND_WET, {
  name: 'farmland_wet', display: 'Farmland', hardness: 0.6, tool: ToolType.SHOVEL,
  drops: 'dirt', sound: SoundGroup.DIRT, fullCube: false, opaque: false,
  tex: { top: 'farmland_moist', bottom: 'dirt', side: 'dirt' },
});

// --- wood --------------------------------------------------------------
const logTex = (n) => ({ top: `${n}_log_top`, bottom: `${n}_log_top`, side: `${n}_log` });
def(B.OAK_LOG, { name: 'oak_log', display: 'Oak Log', hardness: 2, tool: ToolType.AXE, sound: SoundGroup.WOOD, flammable: true, tex: logTex('oak') });
def(B.BIRCH_LOG, { name: 'birch_log', display: 'Birch Log', hardness: 2, tool: ToolType.AXE, sound: SoundGroup.WOOD, flammable: true, tex: logTex('birch') });
def(B.SPRUCE_LOG, { name: 'spruce_log', display: 'Spruce Log', hardness: 2, tool: ToolType.AXE, sound: SoundGroup.WOOD, flammable: true, tex: logTex('spruce') });
def(B.OAK_PLANKS, { name: 'oak_planks', display: 'Oak Planks', hardness: 2, resistance: 3, tool: ToolType.AXE, sound: SoundGroup.WOOD, flammable: true });
def(B.BIRCH_PLANKS, { name: 'birch_planks', display: 'Birch Planks', hardness: 2, resistance: 3, tool: ToolType.AXE, sound: SoundGroup.WOOD, flammable: true });
def(B.SPRUCE_PLANKS, { name: 'spruce_planks', display: 'Spruce Planks', hardness: 2, resistance: 3, tool: ToolType.AXE, sound: SoundGroup.WOOD, flammable: true });

const leafDrops = (rand) => (rand() < 0.05 ? [{ item: 'oak_sapling', count: 1 }] : []);
def(B.OAK_LEAVES, {
  name: 'oak_leaves', display: 'Oak Leaves', hardness: 0.2, tool: ToolType.SHEARS,
  sound: SoundGroup.PLANT, flammable: true, opaque: false, opacity: 1,
  tint: Tint.FOLIAGE, drops: leafDrops,
});
def(B.BIRCH_LEAVES, {
  name: 'birch_leaves', display: 'Birch Leaves', hardness: 0.2, tool: ToolType.SHEARS,
  sound: SoundGroup.PLANT, flammable: true, opaque: false, opacity: 1,
  tint: Tint.FOLIAGE, drops: leafDrops,
});
def(B.SPRUCE_LEAVES, {
  name: 'spruce_leaves', display: 'Spruce Leaves', hardness: 0.2, tool: ToolType.SHEARS,
  sound: SoundGroup.PLANT, flammable: true, opaque: false, opacity: 1,
  tint: Tint.FOLIAGE, drops: leafDrops,
});

// --- ores --------------------------------------------------------------
const ore = (id, name, display, drop, xp, deepslate = false) => def(id, {
  name, display, hardness: deepslate ? 4.5 : 3, resistance: 3,
  tool: ToolType.PICKAXE, requiresTool: true, drops: drop, xp,
  tier: /diamond|emerald/.test(name) ? Tier.IRON
      : /gold|redstone|lapis/.test(name) ? Tier.IRON
      : /iron|copper/.test(name) ? Tier.STONE : Tier.WOOD,
});
ore(B.COAL_ORE, 'coal_ore', 'Coal Ore', 'coal', [0, 2]);
ore(B.IRON_ORE, 'iron_ore', 'Iron Ore', 'raw_iron', 0);
ore(B.GOLD_ORE, 'gold_ore', 'Gold Ore', 'raw_gold', 0);
ore(B.DIAMOND_ORE, 'diamond_ore', 'Diamond Ore', 'diamond', [3, 7]);
ore(B.REDSTONE_ORE, 'redstone_ore', 'Redstone Ore', { item: 'redstone', count: [4, 5] }, [1, 5]);
ore(B.LAPIS_ORE, 'lapis_ore', 'Lapis Lazuli Ore', { item: 'lapis_lazuli', count: [4, 9] }, [2, 5]);
ore(B.EMERALD_ORE, 'emerald_ore', 'Emerald Ore', 'emerald', [3, 7]);
ore(B.COPPER_ORE, 'copper_ore', 'Copper Ore', { item: 'raw_copper', count: [2, 5] }, 0);
ore(B.DEEPSLATE_COAL_ORE, 'deepslate_coal_ore', 'Deepslate Coal Ore', 'coal', [0, 2], true);
ore(B.DEEPSLATE_IRON_ORE, 'deepslate_iron_ore', 'Deepslate Iron Ore', 'raw_iron', 0, true);
ore(B.DEEPSLATE_GOLD_ORE, 'deepslate_gold_ore', 'Deepslate Gold Ore', 'raw_gold', 0, true);
ore(B.DEEPSLATE_DIAMOND_ORE, 'deepslate_diamond_ore', 'Deepslate Diamond Ore', 'diamond', [3, 7], true);
ore(B.DEEPSLATE_REDSTONE_ORE, 'deepslate_redstone_ore', 'Deepslate Redstone Ore', { item: 'redstone', count: [4, 5] }, [1, 5], true);
ore(B.DEEPSLATE_LAPIS_ORE, 'deepslate_lapis_ore', 'Deepslate Lapis Ore', { item: 'lapis_lazuli', count: [4, 9] }, [2, 5], true);

// --- building ----------------------------------------------------------
def(B.GLASS, {
  name: 'glass', display: 'Glass', hardness: 0.3, sound: SoundGroup.GLASS,
  opaque: false, opacity: 0, drops: false,
});
def(B.BRICKS, { name: 'bricks', display: 'Bricks', hardness: 2, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.STONE_BRICKS, { name: 'stone_bricks', display: 'Stone Bricks', hardness: 1.5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.CRACKED_STONE_BRICKS, { name: 'cracked_stone_bricks', display: 'Cracked Stone Bricks', hardness: 1.5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.MOSSY_STONE_BRICKS, { name: 'mossy_stone_bricks', display: 'Mossy Stone Bricks', hardness: 1.5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.CHISELED_STONE_BRICKS, { name: 'chiseled_stone_bricks', display: 'Chiseled Stone Bricks', hardness: 1.5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.GLOWSTONE, { name: 'glowstone', display: 'Glowstone', hardness: 0.3, sound: SoundGroup.GLASS, light: 15, drops: { item: 'glowstone_dust', count: [2, 4] } });
def(B.NETHERRACK, { name: 'netherrack', display: 'Netherrack', hardness: 0.4, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.ICE, {
  name: 'ice', display: 'Ice', hardness: 0.5, tool: ToolType.PICKAXE,
  sound: SoundGroup.GLASS, opaque: false, opacity: 3, drops: false, slippery: 0.98,
});
def(B.PACKED_ICE, { name: 'packed_ice', display: 'Packed Ice', hardness: 0.5, tool: ToolType.PICKAXE, sound: SoundGroup.GLASS, drops: false, slippery: 0.98 });
def(B.SNOW_BLOCK, { name: 'snow_block', display: 'Snow Block', hardness: 0.2, tool: ToolType.SHOVEL, requiresTool: true, sound: SoundGroup.SNOW, drops: { item: 'snowball', count: 4 } });
def(B.IRON_BLOCK, { name: 'iron_block', display: 'Block of Iron', hardness: 5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.STONE, requiresTool: true, sound: SoundGroup.METAL });
def(B.GOLD_BLOCK, { name: 'gold_block', display: 'Block of Gold', hardness: 3, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.IRON, requiresTool: true, sound: SoundGroup.METAL });
def(B.DIAMOND_BLOCK, { name: 'diamond_block', display: 'Block of Diamond', hardness: 5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.IRON, requiresTool: true, sound: SoundGroup.METAL });
def(B.EMERALD_BLOCK, { name: 'emerald_block', display: 'Block of Emerald', hardness: 5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.IRON, requiresTool: true, sound: SoundGroup.METAL });
def(B.COAL_BLOCK, { name: 'coal_block', display: 'Block of Coal', hardness: 5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true });
def(B.LAPIS_BLOCK, { name: 'lapis_block', display: 'Block of Lapis Lazuli', hardness: 3, resistance: 3, tool: ToolType.PICKAXE, tier: Tier.STONE, requiresTool: true });
def(B.HAY_BLOCK, {
  name: 'hay_block', display: 'Hay Bale', hardness: 0.5, sound: SoundGroup.PLANT,
  tex: { top: 'hay_block_top', bottom: 'hay_block_top', side: 'hay_block_side' },
});
def(B.BOOKSHELF, {
  name: 'bookshelf', display: 'Bookshelf', hardness: 1.5, resistance: 1.5,
  tool: ToolType.AXE, sound: SoundGroup.WOOD, flammable: true, drops: { item: 'book', count: 3 },
  tex: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' },
});
def(B.CRAFTING_TABLE, {
  name: 'crafting_table', display: 'Crafting Table', hardness: 2.5,
  tool: ToolType.AXE, sound: SoundGroup.WOOD, flammable: true, container: 'crafting',
  tex: { top: 'crafting_table_top', bottom: 'oak_planks', north: 'crafting_table_front', south: 'crafting_table_front', east: 'crafting_table_side', west: 'crafting_table_side' },
});
def(B.FURNACE, {
  name: 'furnace', display: 'Furnace', hardness: 3.5, resistance: 3.5,
  tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true, container: 'furnace', entity: true,
  tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', north: 'furnace_front' },
});
def(B.FURNACE_LIT, {
  name: 'furnace_lit', display: 'Furnace', hardness: 3.5, resistance: 3.5,
  tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true, container: 'furnace',
  entity: true, light: 13, drops: 'furnace',
  tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', north: 'furnace_front_on' },
});
def(B.CHEST, {
  name: 'chest', display: 'Chest', hardness: 2.5, tool: ToolType.AXE,
  sound: SoundGroup.WOOD, flammable: true, container: 'chest', entity: true,
  fullCube: false, opaque: false,
  tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', north: 'chest_front' },
});
def(B.TNT, {
  name: 'tnt', display: 'TNT', hardness: 0, sound: SoundGroup.GRASS, flammable: true,
  tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' },
});
def(B.PUMPKIN, {
  name: 'pumpkin', display: 'Pumpkin', hardness: 1, tool: ToolType.AXE, sound: SoundGroup.WOOD,
  tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', north: 'pumpkin_face' },
});
def(B.JACK_O_LANTERN, {
  name: 'jack_o_lantern', display: "Jack o'Lantern", hardness: 1, tool: ToolType.AXE,
  sound: SoundGroup.WOOD, light: 15,
  tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', north: 'jack_o_lantern' },
});
def(B.MELON, { name: 'melon', display: 'Melon', hardness: 1, tool: ToolType.AXE, sound: SoundGroup.WOOD, drops: { item: 'melon_slice', count: [3, 7] }, tex: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' } });
def(B.SPONGE, { name: 'sponge', display: 'Sponge', hardness: 0.6, tool: ToolType.HOE, sound: SoundGroup.GRASS });
def(B.MONSTER_SPAWNER, {
  name: 'monster_spawner', display: 'Monster Spawner', hardness: 5, resistance: 5,
  tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true, drops: false,
  opaque: false, opacity: 1, xp: [15, 43], sound: SoundGroup.METAL, entity: true,
});

// --- wool --------------------------------------------------------------
const wool = (id, name, display) => def(id, {
  name, display, hardness: 0.8, tool: ToolType.SHEARS, sound: SoundGroup.WOOL, flammable: true,
});
wool(B.WHITE_WOOL, 'white_wool', 'White Wool');
wool(B.ORANGE_WOOL, 'orange_wool', 'Orange Wool');
wool(B.RED_WOOL, 'red_wool', 'Red Wool');
wool(B.YELLOW_WOOL, 'yellow_wool', 'Yellow Wool');
wool(B.GREEN_WOOL, 'green_wool', 'Green Wool');
wool(B.BLUE_WOOL, 'blue_wool', 'Blue Wool');
wool(B.PURPLE_WOOL, 'purple_wool', 'Purple Wool');
wool(B.BLACK_WOOL, 'black_wool', 'Black Wool');
wool(B.BROWN_WOOL, 'brown_wool', 'Brown Wool');
wool(B.LIGHT_GRAY_WOOL, 'light_gray_wool', 'Light Gray Wool');

// --- fluids ------------------------------------------------------------
def(B.WATER, {
  name: 'water', display: 'Water', render: RenderType.LIQUID,
  hardness: 100, drops: false, fluid: true, replaceable: true,
  opacity: 1, tint: Tint.WATER, sound: SoundGroup.LIQUID,
});
def(B.LAVA, {
  name: 'lava', display: 'Lava', render: RenderType.LIQUID,
  hardness: 100, drops: false, fluid: true, replaceable: true,
  opacity: 0, light: 15, hurt: 4, sound: SoundGroup.LIQUID,
});

// --- small / non-cube --------------------------------------------------
def(B.TORCH, {
  name: 'torch', display: 'Torch', render: RenderType.TORCH, hardness: 0,
  light: 14, solid: false, opaque: false, fullCube: false, opacity: 0,
  sound: SoundGroup.WOOD, tex: 'torch',
});
def(B.WALL_TORCH, {
  name: 'wall_torch', display: 'Torch', render: RenderType.TORCH, hardness: 0,
  light: 14, solid: false, opaque: false, fullCube: false, opacity: 0,
  sound: SoundGroup.WOOD, tex: 'torch', drops: 'torch',
});
def(B.LADDER, {
  name: 'ladder', display: 'Ladder', render: RenderType.LADDER, hardness: 0.4,
  tool: ToolType.AXE, solid: false, opaque: false, fullCube: false, opacity: 0,
  climbable: true, sound: SoundGroup.LADDER, flammable: true,
});
def(B.OAK_DOOR_LOWER, {
  name: 'oak_door_lower', display: 'Oak Door', render: RenderType.DOOR, hardness: 3,
  tool: ToolType.AXE, opaque: false, fullCube: false, opacity: 0, sound: SoundGroup.WOOD,
  flammable: true, drops: 'oak_door', tex: 'oak_door_bottom',
});
def(B.OAK_DOOR_UPPER, {
  name: 'oak_door_upper', display: 'Oak Door', render: RenderType.DOOR, hardness: 3,
  tool: ToolType.AXE, opaque: false, fullCube: false, opacity: 0, sound: SoundGroup.WOOD,
  flammable: true, drops: false, tex: 'oak_door_top',
});
def(B.OAK_FENCE, {
  name: 'oak_fence', display: 'Oak Fence', render: RenderType.FENCE, hardness: 2,
  resistance: 3, tool: ToolType.AXE, opaque: false, fullCube: false, opacity: 0,
  sound: SoundGroup.WOOD, flammable: true, tex: 'oak_planks',
});
def(B.OAK_SLAB, {
  name: 'oak_slab', display: 'Oak Slab', render: RenderType.SLAB, hardness: 2,
  resistance: 3, tool: ToolType.AXE, opaque: false, fullCube: false, opacity: 0,
  sound: SoundGroup.WOOD, flammable: true, tex: 'oak_planks',
});
def(B.STONE_SLAB, {
  name: 'stone_slab', display: 'Stone Slab', render: RenderType.SLAB, hardness: 2,
  resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true,
  opaque: false, fullCube: false, opacity: 0,
  tex: { top: 'smooth_stone_top', bottom: 'smooth_stone_top', side: 'smooth_stone' },
});
def(B.COBBLESTONE_STAIRS, {
  name: 'cobblestone_stairs', display: 'Cobblestone Stairs', render: RenderType.STAIRS,
  hardness: 2, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true,
  opaque: false, fullCube: false, opacity: 0, tex: 'cobblestone',
});
def(B.OAK_STAIRS, {
  name: 'oak_stairs', display: 'Oak Stairs', render: RenderType.STAIRS, hardness: 2,
  resistance: 3, tool: ToolType.AXE, opaque: false, fullCube: false, opacity: 0,
  sound: SoundGroup.WOOD, flammable: true, tex: 'oak_planks',
});
def(B.STONE_BRICK_STAIRS, {
  name: 'stone_brick_stairs', display: 'Stone Brick Stairs', render: RenderType.STAIRS,
  hardness: 1.5, resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true,
  opaque: false, fullCube: false, opacity: 0, tex: 'stone_bricks',
});
def(B.GLASS_PANE, {
  name: 'glass_pane', display: 'Glass Pane', render: RenderType.PANE, hardness: 0.3,
  sound: SoundGroup.GLASS, opaque: false, fullCube: false, opacity: 0, drops: false,
  tex: 'glass',
});
def(B.IRON_BARS, {
  name: 'iron_bars', display: 'Iron Bars', render: RenderType.PANE, hardness: 5,
  resistance: 6, tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true,
  sound: SoundGroup.METAL, opaque: false, fullCube: false, opacity: 0,
});
def(B.SNOW_LAYER, {
  name: 'snow_layer', display: 'Snow', render: RenderType.SNOW_LAYER, hardness: 0.1,
  tool: ToolType.SHOVEL, requiresTool: true, sound: SoundGroup.SNOW,
  opaque: false, fullCube: false, opacity: 0, solid: false, replaceable: true,
  drops: { item: 'snowball', count: 1 }, tex: 'snow',
});
def(B.BED_FOOT, {
  name: 'bed_foot', display: 'Bed', render: RenderType.BED, hardness: 0.2,
  sound: SoundGroup.WOOL, opaque: false, fullCube: false, opacity: 0,
  drops: 'red_bed', tex: { top: 'bed_foot_top', side: 'bed_foot_side', bottom: 'oak_planks' },
});
def(B.BED_HEAD, {
  name: 'bed_head', display: 'Bed', render: RenderType.BED, hardness: 0.2,
  sound: SoundGroup.WOOL, opaque: false, fullCube: false, opacity: 0,
  drops: false, tex: { top: 'bed_head_top', side: 'bed_head_side', bottom: 'oak_planks' },
});
def(B.RED_CARPET, {
  name: 'red_carpet', display: 'Red Carpet', render: RenderType.CARPET, hardness: 0.1,
  sound: SoundGroup.WOOL, opaque: false, fullCube: false, opacity: 0, solid: false,
  flammable: true, tex: 'red_wool',
});
def(B.COBWEB, {
  name: 'cobweb', display: 'Cobweb', render: RenderType.CROSS, hardness: 4,
  tool: ToolType.SHEARS, requiresTool: true, drops: 'string', sound: SoundGroup.WOOL,
});

// --- plants ------------------------------------------------------------
const plant = (id, name, display, o = {}) => def(id, Object.assign({
  name, display, render: RenderType.CROSS, hardness: 0, sound: SoundGroup.PLANT,
  flammable: true, replaceable: false,
}, o));
plant(B.GRASS_PLANT, 'short_grass', 'Grass', { tint: Tint.GRASS, replaceable: true, drops: (r) => (r() < 0.125 ? [{ item: 'wheat_seeds', count: 1 }] : []) });
plant(B.TALL_GRASS, 'tall_grass', 'Tall Grass', { tint: Tint.GRASS, replaceable: true, drops: (r) => (r() < 0.125 ? [{ item: 'wheat_seeds', count: 1 }] : []) });
plant(B.FERN, 'fern', 'Fern', { tint: Tint.GRASS, replaceable: true, drops: (r) => (r() < 0.125 ? [{ item: 'wheat_seeds', count: 1 }] : []) });
plant(B.DEAD_BUSH, 'dead_bush', 'Dead Bush', { replaceable: true, drops: (r) => (r() < 0.3 ? [{ item: 'stick', count: 1 }] : []) });
plant(B.DANDELION, 'dandelion', 'Dandelion', {});
plant(B.POPPY, 'poppy', 'Poppy', {});
plant(B.BLUE_ORCHID, 'blue_orchid', 'Blue Orchid', {});
plant(B.CORNFLOWER, 'cornflower', 'Cornflower', {});
plant(B.RED_MUSHROOM, 'red_mushroom', 'Red Mushroom', {});
plant(B.BROWN_MUSHROOM, 'brown_mushroom', 'Brown Mushroom', { light: 1 });
plant(B.OAK_SAPLING, 'oak_sapling', 'Oak Sapling', {});
plant(B.SUGAR_CANE, 'sugar_cane', 'Sugar Cane', { tint: Tint.FOLIAGE });
plant(B.VINE, 'vine', 'Vine', { tint: Tint.FOLIAGE, climbable: true });
plant(B.LILY_PAD, 'lily_pad', 'Lily Pad', { render: RenderType.CARPET, tint: Tint.FOLIAGE });
def(B.CACTUS, {
  name: 'cactus', display: 'Cactus', hardness: 0.4, sound: SoundGroup.WOOL,
  opaque: false, fullCube: false, hurt: 1,
  tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' },
});
def(B.WHEAT, {
  name: 'wheat', display: 'Wheat', render: RenderType.CROP, hardness: 0,
  sound: SoundGroup.PLANT, drops: 'wheat', tex: 'wheat_stage7',
});

// --- story blocks ------------------------------------------------------
def(B.EMBER_LANTERN, {
  name: 'ember_lantern', display: 'Dormant Lantern', hardness: 3.5,
  tool: ToolType.PICKAXE, tier: Tier.STONE, requiresTool: true, sound: SoundGroup.METAL,
  opaque: false, fullCube: false,
  tex: { top: 'ember_lantern_top', bottom: 'ember_lantern_top', side: 'ember_lantern' },
});
def(B.EMBER_LANTERN_LIT, {
  name: 'ember_lantern_lit', display: 'Ember Lantern', hardness: 3.5,
  tool: ToolType.PICKAXE, tier: Tier.STONE, requiresTool: true, sound: SoundGroup.METAL,
  light: 15, opaque: false, fullCube: false, drops: 'ember_lantern',
  tex: { top: 'ember_lantern_lit_top', bottom: 'ember_lantern_lit_top', side: 'ember_lantern_lit' },
});
def(B.RUNE_STONE, {
  name: 'rune_stone', display: 'Rune Stone', hardness: 8, resistance: 20,
  tool: ToolType.PICKAXE, tier: Tier.IRON, requiresTool: true, drops: false,
});
def(B.RUNE_STONE_LIT, {
  name: 'rune_stone_lit', display: 'Awakened Rune', hardness: 8, resistance: 20,
  tool: ToolType.PICKAXE, tier: Tier.IRON, requiresTool: true, drops: false, light: 10,
});
def(B.WITHERED_STONE, {
  name: 'withered_stone', display: 'Withered Stone', hardness: 2.2,
  tool: ToolType.PICKAXE, tier: Tier.WOOD, requiresTool: true, drops: 'cobblestone',
});
def(B.WITHERED_GRASS, {
  name: 'withered_grass', display: 'Withered Ground', hardness: 0.6,
  tool: ToolType.SHOVEL, drops: 'dirt', sound: SoundGroup.DIRT,
  tex: { top: 'withered_grass_top', bottom: 'dirt', side: 'withered_grass_side' },
});
def(B.EMBER_CORE_BLOCK, {
  name: 'ember_core_block', display: 'Ember Core', hardness: -1, resistance: 3600000,
  drops: false, light: 15, opaque: false, fullCube: false, sound: SoundGroup.GLASS,
});
def(B.VILLAGE_PATH, {
  name: 'village_path', display: 'Dirt Path', hardness: 0.65, tool: ToolType.SHOVEL,
  drops: 'dirt', sound: SoundGroup.DIRT, fullCube: false, opaque: false,
  tex: { top: 'dirt_path_top', bottom: 'dirt', side: 'dirt_path_side' },
});
def(B.BEACON_PEDESTAL, {
  name: 'beacon_pedestal', display: 'Ember Pedestal', hardness: -1, resistance: 3600000,
  drops: false, light: 4, sound: SoundGroup.STONE,
  tex: { top: 'beacon_pedestal_top', bottom: 'stone_bricks', side: 'beacon_pedestal_side' },
});

// Fill the gaps so BLOCKS[id] is never undefined for a legal id.
for (let i = 0; i < BLOCK_COUNT; i++) if (!BLOCKS[i]) BLOCKS[i] = BLOCKS[B.AIR];

// ------------------------------------------------------------------ fast lookup tables
// Hot paths (meshing, lighting, physics) read these typed arrays instead of
// chasing object properties.

export const IS_OPAQUE = new Uint8Array(BLOCK_COUNT);
export const IS_SOLID = new Uint8Array(BLOCK_COUNT);
export const IS_FULL_CUBE = new Uint8Array(BLOCK_COUNT);
export const LIGHT_EMIT = new Uint8Array(BLOCK_COUNT);
export const LIGHT_OPACITY = new Uint8Array(BLOCK_COUNT);
export const IS_FLUID = new Uint8Array(BLOCK_COUNT);
export const IS_REPLACEABLE = new Uint8Array(BLOCK_COUNT);
export const RENDER_TYPE = new Uint8Array(BLOCK_COUNT);
export const TINT_TYPE = new Uint8Array(BLOCK_COUNT);
export const SLIPPERINESS = new Float32Array(BLOCK_COUNT);
export const IS_CLIMBABLE = new Uint8Array(BLOCK_COUNT);
export const CONTACT_DAMAGE = new Float32Array(BLOCK_COUNT);

for (let i = 0; i < BLOCK_COUNT; i++) {
  const b = BLOCKS[i];
  IS_OPAQUE[i] = b.opaque ? 1 : 0;
  IS_SOLID[i] = b.solid ? 1 : 0;
  IS_FULL_CUBE[i] = b.fullCube ? 1 : 0;
  LIGHT_EMIT[i] = b.light;
  LIGHT_OPACITY[i] = b.opaque ? Math.max(1, b.opacity) : b.opacity;
  IS_FLUID[i] = b.fluid ? 1 : 0;
  IS_REPLACEABLE[i] = b.replaceable ? 1 : 0;
  RENDER_TYPE[i] = b.render;
  TINT_TYPE[i] = b.tint;
  SLIPPERINESS[i] = b.slippery;
  IS_CLIMBABLE[i] = b.climbable ? 1 : 0;
  CONTACT_DAMAGE[i] = b.hurt;
}
// Air must never occlude, even though id 0 shares the AIR definition.
IS_OPAQUE[B.AIR] = 0;

export const getBlock = (id) => BLOCKS[id] || BLOCKS[B.AIR];
export const blockId = (name) => (byName[name] ? byName[name].id : B.AIR);

/** True when `id` should hide the face of a neighbour of type `neighbourId`. */
export function occludes(id, neighbourId) {
  if (id === B.AIR) return false;
  if (IS_OPAQUE[id] && IS_FULL_CUBE[id]) return true;
  // Matching transparent blocks hide their shared faces (glass-to-glass, water-to-water).
  return id === neighbourId && (id === B.GLASS || id === B.WATER || id === B.ICE || id === B.LAVA);
}

/** Blocks that a placed block needs beneath it to survive. */
export function needsSupport(id) {
  return RENDER_TYPE[id] === RenderType.CROSS ||
         RENDER_TYPE[id] === RenderType.CROP ||
         RENDER_TYPE[id] === RenderType.TORCH ||
         RENDER_TYPE[id] === RenderType.SNOW_LAYER ||
         RENDER_TYPE[id] === RenderType.CARPET ||
         id === B.CACTUS || id === B.SUGAR_CANE;
}

// ------------------------------------------------------------------ face geometry

/** Face indices used everywhere: +X, -X, +Y, -Y, +Z, -Z. */
export const FACE = { EAST: 0, WEST: 1, UP: 2, DOWN: 3, SOUTH: 4, NORTH: 5 };

export const FACE_NORMALS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Vanilla's directional face shading, applied before light. */
export const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];

/**
 * Corner positions per face, wound counter-clockwise when viewed from outside.
 * Each entry is [x, y, z] in the 0..1 unit cube.
 */
export const FACE_VERTS = [
  // +X
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  // -X
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  // +Y
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  // -Y
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  // +Z
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  // -Z
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];

/** UVs matching FACE_VERTS winding, with V flipped so textures are upright. */
export const FACE_UVS = [
  [[0, 1], [1, 1], [1, 0], [0, 0]],
  [[0, 1], [1, 1], [1, 0], [0, 0]],
  [[0, 1], [1, 1], [1, 0], [0, 0]],
  [[0, 0], [1, 0], [1, 1], [0, 1]],
  [[0, 1], [1, 1], [1, 0], [0, 0]],
  [[0, 1], [1, 1], [1, 0], [0, 0]],
];

/**
 * For smooth lighting: the two edge neighbours and the corner neighbour of each
 * vertex of each face, as offsets from the block in front of the face.
 * Layout: AO_OFFSETS[face][vertex] = [side1, side2, corner], each [dx,dy,dz].
 */
export const AO_OFFSETS = buildAOOffsets();

function buildAOOffsets() {
  const out = [];
  for (let f = 0; f < 6; f++) {
    const n = FACE_NORMALS[f];
    // Two axes tangent to this face.
    const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
    const uAxis = (axis + 1) % 3;
    const vAxis = (axis + 2) % 3;
    const perFace = [];
    for (let v = 0; v < 4; v++) {
      const p = FACE_VERTS[f][v];
      // -1 or +1 depending on which side of the block centre this corner sits.
      const du = p[uAxis] === 1 ? 1 : -1;
      const dv = p[vAxis] === 1 ? 1 : -1;
      const s1 = [0, 0, 0]; s1[uAxis] = du;
      const s2 = [0, 0, 0]; s2[vAxis] = dv;
      const c = [0, 0, 0]; c[uAxis] = du; c[vAxis] = dv;
      perFace.push([s1, s2, c]);
    }
    out.push(perFace);
  }
  return out;
}
