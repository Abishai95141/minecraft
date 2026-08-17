// Every texture in the game, painted procedurally at 16x16. Nothing is loaded
// from disk, so the whole game is one folder of source with no binary assets.
//
// Colour palettes were matched by eye to Minecraft's vanilla textures; textures
// that vary by biome (grass, foliage) are painted in greyscale and multiplied
// by a biome tint at draw time.

import { Painter, scaleColor } from './painter.js';

/** name -> painter function. Order here becomes the atlas layer order. */
export const TEXTURES = new Map();

const tex = (name, fn) => { TEXTURES.set(name, fn); return name; };

/** Paints a texture by name into a fresh Painter (used for `copyFrom` bases). */
export function paint(name) {
  const fn = TEXTURES.get(name);
  const p = new Painter(name);
  if (fn) fn(p);
  else p.fill(0xff00ff).rect(0, 0, 8, 8, 0x000000).rect(8, 8, 8, 8, 0x000000);
  return p;
}

// ================================================================== palettes

const STONE = [0x7d7d7d, 0x757575, 0x828282, 0x6e6e6e, 0x8a8a8a, 0x6b6b6b];
const DEEPSLATE = [0x4f4f52, 0x585859, 0x48484b, 0x535356, 0x434346];
const DIRT = [0x866043, 0x8f6a4a, 0x79553a, 0x92714f, 0x6f4d33];
const SAND = [0xdbd3a0, 0xe4dcac, 0xd0c894, 0xe8e0b4, 0xc9c08b];
const RED_SAND = [0xa95821, 0xb56227, 0x9d501d, 0xbf6b2e];
const GRAVEL = [0x7f7f7f, 0x8b8b8b, 0x6c6c6c, 0x959595, 0x606060, 0x757575];

// ================================================================== stone family

tex('stone', (p) => { p.noise(STONE); p.speckle(0x616161, 0.10); p.speckle(0x8e8e8e, 0.08); });
tex('granite', (p) => { p.noise([0x9a6255, 0xa66c5f, 0x8e584c, 0xb0796a, 0x94614f]); p.speckle(0xc8a094, 0.06); });
tex('diorite', (p) => { p.noise([0xbfbfbf, 0xcdcdcd, 0xa8a8a8, 0xd8d8d8, 0x999999]); p.speckle(0x8f8f8f, 0.08); });
tex('andesite', (p) => { p.noise([0x888889, 0x929293, 0x7d7d7e, 0x9c9c9d, 0x737374]); p.speckle(0x6a6a6b, 0.07); });
tex('deepslate', (p) => {
  p.noise(DEEPSLATE);
  // Faint vertical striation, which is what distinguishes deepslate from stone.
  for (let x = 0; x < 16; x++) if (p.chance(0.3)) p.shade(x, 0, 1, 16, p.chance(0.5) ? 0.9 : 1.1);
});
tex('deepslate_top', (p) => { p.noise(DEEPSLATE); p.speckle(0x3d3d40, 0.12); });
tex('cobbled_deepslate', (p) => p.pebbles(0x35353a, [0x51515a, 0x5b5b64, 0x46464e, 0x63636c]));
tex('cobblestone', (p) => p.pebbles(0x4f4f4f, [0x7f7f7f, 0x8f8f8f, 0x6a6a6a, 0x999999, 0x737373]));
tex('mossy_cobblestone', (p) => {
  p.pebbles(0x4a5240, [0x7a8a6a, 0x6a7a5a, 0x8a9a76, 0x62725a]);
  p.speckle(0x5c7a3f, 0.22);
});
tex('smooth_stone', (p) => { p.noise([0x9f9f9f, 0xa5a5a5, 0x999999, 0xabaaab]); p.speckle(0x8f8f8f, 0.05); });
tex('smooth_stone_top', (p) => { p.noise([0xa8a8a8, 0xaeaeae, 0xa2a2a2]); p.outline(0, 0, 16, 16, 0x8f8f8f); });
tex('bedrock', (p) => {
  p.noise([0x565656, 0x6a6a6a, 0x3f3f3f, 0x7d7d7d, 0x2e2e2e, 0x494949]);
  for (let i = 0; i < 14; i++) p.rect(p.randInt(0, 13), p.randInt(0, 13), p.randInt(2, 3), p.randInt(2, 3), p.pick([0x333333, 0x828282, 0x4a4a4a]));
});
tex('obsidian', (p) => {
  p.noise([0x14101e, 0x1a1526, 0x100c18, 0x201a2e]);
  p.speckle(0x3a2f52, 0.10);
  p.speckle(0x0a070f, 0.12);
});

// ================================================================== soil

tex('dirt', (p) => { p.noise(DIRT); p.speckle(0x6b4a32, 0.12); });
tex('coarse_dirt', (p) => { p.noise(DIRT); p.speckle(0x5c4029, 0.20); p.speckle(0x9c7a58, 0.10); });
// Greyscale — multiplied by the biome grass tint at draw time.
tex('grass_block_top', (p) => {
  p.noise([0xd2d2d2, 0xdedede, 0xc6c6c6, 0xe8e8e8, 0xbcbcbc]);
  p.speckle(0xf0f0f0, 0.10);
  p.speckle(0xb0b0b0, 0.08);
});
tex('grass_block_side', (p) => p.copyFrom(paint('dirt')));
// Tinted overlay strip drawn on the upper part of grass block sides.
tex('grass_block_side_overlay', (p) => {
  p.clear();
  for (let x = 0; x < 16; x++) {
    const h = 3 + (p.chance(0.45) ? 1 : 0) + (p.chance(0.18) ? 1 : 0);
    for (let y = 0; y < h; y++) {
      const v = p.pick([0xd2d2d2, 0xdedede, 0xc6c6c6, 0xe8e8e8]);
      p.set(x, y, v);
    }
  }
});
tex('podzol_top', (p) => { p.noise([0x6b4a24, 0x7a5730, 0x5c3f1e, 0x8a6338]); p.speckle(0x3f2a12, 0.15); });
tex('podzol_side', (p) => {
  p.copyFrom(paint('dirt'));
  for (let x = 0; x < 16; x++) {
    const h = 3 + (p.chance(0.5) ? 1 : 0);
    for (let y = 0; y < h; y++) p.set(x, y, p.pick([0x6b4a24, 0x7a5730, 0x5c3f1e]));
  }
});
tex('mycelium_top', (p) => { p.noise([0x6f6265, 0x7b6d70, 0x62565a, 0x87787c]); p.speckle(0x9c8c92, 0.12); });
tex('mycelium_side', (p) => {
  p.copyFrom(paint('dirt'));
  for (let x = 0; x < 16; x++) {
    const h = 2 + (p.chance(0.5) ? 1 : 0);
    for (let y = 0; y < h; y++) p.set(x, y, p.pick([0x6f6265, 0x7b6d70, 0x87787c]));
  }
});
tex('sand', (p) => { p.noise(SAND); p.speckle(0xf0e8c0, 0.08); p.speckle(0xbcb280, 0.08); });
tex('red_sand', (p) => { p.noise(RED_SAND); p.speckle(0xc9743a, 0.10); });
tex('sandstone', (p) => {
  p.noise([0xd8cfa1, 0xdfd6a9, 0xd0c797]);
  for (let y = 0; y < 16; y += 4) p.hline(0, y, 16, 0xbfb488);
  p.speckle(0xe8dfb4, 0.08);
});
tex('sandstone_top', (p) => { p.noise([0xdcd3a5, 0xe2d9ad, 0xd4cb9b]); p.speckle(0xc2b78d, 0.10); });
tex('sandstone_bottom', (p) => { p.noise([0xd0c797, 0xd8cfa1, 0xc6bc8d]); p.speckle(0xbcb183, 0.12); });
tex('gravel', (p) => {
  p.noise(GRAVEL);
  for (let i = 0; i < 20; i++) {
    const x = p.randInt(0, 14), y = p.randInt(0, 14);
    p.rect(x, y, p.randInt(1, 2), p.randInt(1, 2), p.pick([0x9a9a9a, 0x585858, 0x6f6f6f, 0xa8a8a8]));
  }
});
tex('clay', (p) => { p.noise([0xa4a8b8, 0xacb0c0, 0x9ca0b0, 0xb4b8c8]); p.speckle(0x9298a8, 0.10); });
tex('farmland', (p) => {
  p.noise([0x6b4a2c, 0x785535, 0x5f4126]);
  for (let y = 2; y < 16; y += 5) p.rect(0, y, 16, 2, 0x4e351f);
});
tex('farmland_moist', (p) => {
  p.noise([0x4a3320, 0x553b26, 0x412c1b]);
  for (let y = 2; y < 16; y += 5) p.rect(0, y, 16, 2, 0x33220f);
});
tex('dirt_path_top', (p) => {
  p.noise([0x977e4c, 0xa08653, 0x8c7345, 0xa98e5b]);
  p.outline(0, 0, 16, 16, 0x7a6339);
  p.speckle(0x7f6a40, 0.10);
});
tex('dirt_path_side', (p) => {
  p.copyFrom(paint('dirt'));
  p.rect(0, 0, 16, 2, 0x8c7345);
  p.hline(0, 0, 16, 0xa08653);
});

// ================================================================== wood

const logSide = (base, dark, light) => (p) => {
  p.grain(base, dark, light, 0.5);
  p.vline(0, 0, 16, dark); p.vline(15, 0, 16, dark);
};
tex('oak_log', logSide(0x6b5030, 0x54402a, 0x7d6038));
tex('oak_log_top', (p) => p.rings(0xc0a068, 0xa88a52, 0x8a6f42, 0x6b5030));
tex('birch_log', (p) => {
  p.grain(0xd7cdc0, 0xc4b8a8, 0xe4dcd2, 0.25);
  for (let i = 0; i < 5; i++) {
    const y = p.randInt(1, 14), x = p.randInt(0, 11);
    p.rect(x, y, p.randInt(2, 4), 1, 0x53534b);
  }
  p.vline(0, 0, 16, 0xc4b8a8); p.vline(15, 0, 16, 0xc4b8a8);
});
tex('birch_log_top', (p) => p.rings(0xdcd2c4, 0xc9bfae, 0xb6ac9a, 0xd7cdc0));
tex('spruce_log', logSide(0x3b2a16, 0x2c1f10, 0x4c371f));
tex('spruce_log_top', (p) => p.rings(0x8a6a3e, 0x6f5430, 0x543f24, 0x3b2a16));
tex('oak_planks', (p) => p.planks(0xb8945f, 0x96754a, 0xc9a672));
tex('birch_planks', (p) => p.planks(0xc8b688, 0xa9986e, 0xd9c99b));
tex('spruce_planks', (p) => p.planks(0x7a5a32, 0x5f4626, 0x8d6b3e));

// Leaves are greyscale + a few alpha holes; tinted by biome foliage colour.
// The gaps have to be sparse and clustered: scattering 10-14% of every tile as
// individual transparent pixels turned a whole forest into a haze of sky specks
// when seen from any distance.
const leaves = (density, holes) => (p) => {
  p.noise([0xb4b4b4, 0xc8c8c8, 0xa0a0a0, 0xd8d8d8, 0x909090]);
  p.speckle(0xe4e4e4, density);
  p.speckle(0x787878, density);
  // A handful of small bites out of the edges, rather than uniform static.
  for (let i = 0; i < holes; i++) {
    const x = p.randInt(0, 15), y = p.randInt(0, 15);
    p.set(x, y, 0, 0);
    if (p.chance(0.5)) p.set((x + 1) & 15, y, 0, 0);
    if (p.chance(0.3)) p.set(x, (y + 1) & 15, 0, 0);
  }
};
tex('oak_leaves', leaves(0.14, 5));
tex('birch_leaves', leaves(0.16, 6));
tex('spruce_leaves', (p) => {
  p.noise([0x8c8c8c, 0x9c9c9c, 0x7c7c7c, 0xacacac]);
  p.speckle(0xbcbcbc, 0.12);
  for (let i = 0; i < 5; i++) {
    const x = p.randInt(0, 15), y = p.randInt(0, 15);
    p.set(x, y, 0, 0);
    if (p.chance(0.4)) p.set((x + 1) & 15, y, 0, 0);
  }
});

// ================================================================== ores

const oreTex = (baseName, colors, count = 4) => (p) => {
  p.copyFrom(paint(baseName));
  p.oreBlobs(colors, count, 1, 2);
};
const COAL = [0x2b2b2b, 0x1a1a1a, 0x101010];
const IRON = [0xd8af93, 0xbc8e72, 0xa87a5e];
const GOLD = [0xfcee4b, 0xecc333, 0xc9a022];
const DIAMOND = [0x9defe8, 0x5decf5, 0x3fc4d4];
const REDSTONE = [0xff3a2a, 0xd41505, 0x9c0f02];
const LAPIS = [0x4a6fd4, 0x2a4fb0, 0x1b3a8c];
const EMERALD = [0x4ff08a, 0x17dd62, 0x0fa84a];
const COPPER = [0xe08a5f, 0xc86e4b, 0xa85838];

tex('coal_ore', oreTex('stone', COAL));
tex('iron_ore', oreTex('stone', IRON));
tex('gold_ore', oreTex('stone', GOLD));
tex('diamond_ore', oreTex('stone', DIAMOND, 3));
tex('redstone_ore', oreTex('stone', REDSTONE));
tex('lapis_ore', oreTex('stone', LAPIS));
tex('emerald_ore', oreTex('stone', EMERALD, 2));
tex('copper_ore', oreTex('stone', COPPER));
tex('deepslate_coal_ore', oreTex('deepslate', COAL));
tex('deepslate_iron_ore', oreTex('deepslate', IRON));
tex('deepslate_gold_ore', oreTex('deepslate', GOLD));
tex('deepslate_diamond_ore', oreTex('deepslate', DIAMOND, 3));
tex('deepslate_redstone_ore', oreTex('deepslate', REDSTONE));
tex('deepslate_lapis_ore', oreTex('deepslate', LAPIS));

// ================================================================== building

// Glass is drawn in the alpha-tested pass, which does not blend: a
// half-transparent wash would either vanish under the cutoff or come out as a
// solid tile. Vanilla's answer is the only one that works here — leave the
// middle genuinely empty and carry the whole read on an opaque frame.
tex('glass', (p) => {
  p.clear();
  p.outline(0, 0, 16, 16, 0xd7ecf5);
  p.outline(1, 1, 14, 14, 0xbcd9e6);
  // A corner glint and one diagonal streak, so a pane catches the eye.
  p.line(3, 12, 7, 8, 0xffffff);
  p.line(4, 12, 8, 8, 0xeaf7ff);
  p.line(10, 6, 12, 4, 0xffffff);
  p.set(12, 3, 0xffffff);
  p.set(13, 3, 0xeaf7ff);
});
tex('bricks', (p) => {
  p.bricks(0xa8a099, [0x9e5e4a, 0x96563f, 0xa76854, 0x8e5040], 4, true);
  p.jitter(0.94, 1.06);
});
tex('stone_bricks', (p) => {
  p.fill(0x606060);
  p.rect(0, 0, 7, 7, 0x7d7d7d); p.rect(8, 0, 8, 7, 0x7a7a7a);
  p.rect(0, 8, 11, 7, 0x808080); p.rect(12, 8, 4, 7, 0x767676);
  p.jitter(0.9, 1.1);
  p.speckle(0x6c6c6c, 0.08);
});
tex('cracked_stone_bricks', (p) => {
  p.copyFrom(paint('stone_bricks'));
  for (let i = 0; i < 4; i++) {
    let x = p.randInt(1, 14), y = p.randInt(1, 14);
    for (let s = 0; s < p.randInt(4, 8); s++) {
      p.set(x, y, 0x4e4e4e);
      x += p.randInt(-1, 1); y += p.randInt(0, 1);
    }
  }
});
tex('mossy_stone_bricks', (p) => { p.copyFrom(paint('stone_bricks')); p.multiply(0xc8d8b8); p.speckle(0x5c7a3f, 0.2); });
tex('chiseled_stone_bricks', (p) => {
  p.fill(0x7a7a7a);
  p.outline(0, 0, 16, 16, 0x5e5e5e);
  p.rect(3, 2, 10, 5, 0x8a8a8a);
  p.rect(3, 9, 10, 5, 0x8a8a8a);
  p.rect(5, 3, 6, 3, 0x6b6b6b);
  p.rect(5, 10, 6, 3, 0x6b6b6b);
  p.jitter(0.94, 1.06);
});
tex('glowstone', (p) => {
  p.noise([0x957036, 0xa47f42, 0x86642e]);
  for (let i = 0; i < 22; i++) {
    const x = p.randInt(0, 14), y = p.randInt(0, 14);
    p.rect(x, y, p.randInt(1, 2), p.randInt(1, 2), p.pick([0xffe9a0, 0xffd97a, 0xf5c95e]));
  }
});
tex('netherrack', (p) => { p.noise([0x6e3434, 0x7a3c3c, 0x5f2c2c, 0x854545]); p.speckle(0x4a2020, 0.14); });
tex('ice', (p) => {
  p.fill(0x7daef5, 200);
  p.noise([0x7daef5, 0x8ebaf7, 0x6fa0ee, 0xa5cbf7]);
  for (let i = 0; i < 6; i++) p.line(p.randInt(0, 15), 0, p.randInt(0, 15), 15, 0xb8d8fa, 200);
  for (let i = 0; i < p.data.length; i += 4) p.data[i + 3] = 200;
});
tex('packed_ice', (p) => { p.noise([0x6fa0ee, 0x7daef5, 0x6495e2, 0x8ebaf7]); p.speckle(0xa5cbf7, 0.1); });
tex('snow', (p) => { p.noise([0xf0f6ff, 0xfafdff, 0xe6eefa, 0xffffff]); p.speckle(0xdde8f5, 0.08); });
tex('snow_block', (p) => { p.noise([0xf0f6ff, 0xfafdff, 0xe6eefa, 0xffffff]); p.speckle(0xdde8f5, 0.08); });

const metalBlock = (base, light, dark) => (p) => {
  p.noise([base, light, dark]);
  p.outline(0, 0, 16, 16, dark);
  p.rect(2, 2, 12, 12, base);
  p.outline(2, 2, 12, 12, light);
  p.jitter(0.96, 1.04);
};
tex('iron_block', metalBlock(0xd8d8d8, 0xe8e8e8, 0xbfbfbf));
tex('gold_block', metalBlock(0xf8d848, 0xfde96f, 0xd9b52c));
tex('diamond_block', metalBlock(0x62e8e1, 0x8df2ee, 0x3fc4bd));
tex('emerald_block', metalBlock(0x43d168, 0x6ee38c, 0x2aa84c));
tex('lapis_block', metalBlock(0x2758ce, 0x3f74e2, 0x1a3f9e));
tex('coal_block', (p) => { p.noise([0x191919, 0x121212, 0x212121, 0x0d0d0d]); p.speckle(0x2c2c2c, 0.08); });

tex('hay_block_top', (p) => {
  p.noise([0xa98d0e, 0xb89a1c, 0x9a7f08]);
  p.outline(0, 0, 16, 16, 0x7d6606);
  p.rect(5, 5, 6, 6, 0xc8aa2a);
  p.outline(5, 5, 6, 6, 0x8a7208);
});
tex('hay_block_side', (p) => {
  p.noise([0xbfa92b, 0xcbb63a, 0xb09c22]);
  for (let y = 0; y < 16; y += 5) p.hline(0, y, 16, 0x8a7208);
  p.speckle(0xd8c650, 0.12);
});
tex('bookshelf', (p) => {
  p.copyFrom(paint('oak_planks'));
  p.rect(0, 1, 16, 6, 0x6b5030);
  p.rect(0, 9, 16, 6, 0x6b5030);
  const spines = [0xa53a3a, 0x3a5aa5, 0x3a8a4a, 0xa58a3a, 0x8a3aa5, 0xa5653a, 0x4a4a8a];
  for (const y0 of [1, 9]) {
    let x = 0;
    while (x < 16) {
      const w = p.randInt(1, 2);
      const c = p.pick(spines);
      p.rect(x, y0, w, 6, c);
      p.hline(x, y0, w, scaleColor(c, 1.25));
      p.hline(x, y0 + 5, w, scaleColor(c, 0.7));
      x += w + (p.chance(0.3) ? 1 : 0);
    }
  }
});
tex('crafting_table_top', (p) => {
  p.copyFrom(paint('oak_planks'));
  p.multiply(0xc8b8a8);
  p.outline(0, 0, 16, 16, 0x5a4326);
  for (let i = 1; i <= 2; i++) { p.hline(1, i * 5, 14, 0x6b5030); p.vline(i * 5, 1, 14, 0x6b5030); }
  p.rect(1, 1, 4, 4, 0x8a6f42);
  p.rect(11, 11, 4, 4, 0x8a6f42);
});
tex('crafting_table_front', (p) => {
  p.copyFrom(paint('oak_planks'));
  p.rect(1, 4, 14, 11, 0x8a6f42);
  p.outline(1, 4, 14, 11, 0x5a4326);
  p.rect(3, 6, 4, 3, 0x6b5030);   // hammer head
  p.line(7, 9, 11, 13, 0x54402a); // handle
  p.rect(9, 5, 5, 2, 0x6b5030);   // saw
  p.hline(2, 12, 12, 0x5a4326);
});
tex('crafting_table_side', (p) => {
  p.copyFrom(paint('oak_planks'));
  p.rect(1, 4, 14, 11, 0x9c7c4e);
  p.outline(1, 4, 14, 11, 0x5a4326);
  for (let y = 6; y < 14; y += 3) p.hline(2, y, 12, 0x7a5f38);
});
tex('furnace_top', (p) => { p.copyFrom(paint('stone')); p.outline(0, 0, 16, 16, 0x5e5e5e); p.rect(4, 4, 8, 8, 0x6b6b6b); p.outline(4, 4, 8, 8, 0x585858); });
tex('furnace_side', (p) => { p.copyFrom(paint('stone')); p.outline(0, 0, 16, 16, 0x5e5e5e); });
tex('furnace_front', (p) => {
  p.copyFrom(paint('stone'));
  p.outline(0, 0, 16, 16, 0x5e5e5e);
  p.rect(3, 4, 10, 8, 0x2b2b2b);
  p.outline(3, 4, 10, 8, 0x4a4a4a);
  for (let x = 4; x < 12; x += 2) p.vline(x, 5, 6, 0x1c1c1c);
  p.hline(3, 3, 10, 0x8a8a8a);
});
tex('furnace_front_on', (p) => {
  p.copyFrom(paint('furnace_front'));
  p.rect(4, 7, 8, 4, 0xd8620f);
  p.rect(5, 8, 6, 3, 0xf59a1e);
  p.rect(6, 9, 4, 2, 0xffd24a);
  p.speckle(0xffe98a, 0.10);
});
tex('chest_top', (p) => {
  p.fill(0x8b6c2c);
  p.noise([0x8b6c2c, 0x9a7935, 0x7c5f26]);
  p.outline(0, 0, 16, 16, 0x5e4419);
  p.rect(6, 0, 4, 4, 0x50504f);
  p.outline(6, 0, 4, 4, 0x2e2e2d);
});
tex('chest_side', (p) => {
  p.noise([0x8b6c2c, 0x9a7935, 0x7c5f26]);
  p.outline(0, 0, 16, 16, 0x5e4419);
  p.hline(0, 5, 16, 0x5e4419);
  p.hline(0, 6, 16, 0x6b4e1e);
});
tex('chest_front', (p) => {
  p.copyFrom(paint('chest_side'));
  p.rect(6, 7, 4, 4, 0x50504f);
  p.outline(6, 7, 4, 4, 0x2e2e2d);
  p.rect(7, 8, 2, 2, 0xffdc5e);
  p.set(7, 9, 0x2e2e2d);
});
tex('tnt_top', (p) => { p.fill(0xdb441a); p.noise([0xdb441a, 0xe64f24, 0xc93a14]); p.outline(0, 0, 16, 16, 0x9e2c0e); p.rect(4, 4, 8, 8, 0xf0f0f0); });
tex('tnt_bottom', (p) => { p.noise([0x8a5a3a, 0x96654a, 0x7c4e30]); });
tex('tnt_side', (p) => {
  p.noise([0xdb441a, 0xe64f24, 0xc93a14]);
  p.rect(0, 5, 16, 6, 0xf2f2f2);
  // "TNT" in a chunky 3x5 face.
  const T = ['###', '.#.', '.#.', '.#.', '.#.'];
  const N = ['#.#', '##.', '#.#', '#.#', '#.#'];
  const put = (art, ox) => art.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') p.set(ox + x, 6 + y, 0x2b2b2b); }));
  put(T, 2); put(N, 6); put(T, 10);
  p.hline(0, 4, 16, 0x9e2c0e); p.hline(0, 11, 16, 0x9e2c0e);
});
tex('pumpkin_top', (p) => { p.noise([0xc07615, 0xcc8020, 0xb26c10]); p.rect(5, 5, 6, 6, 0x8a5a12); p.outline(5, 5, 6, 6, 0x6f4a0e); });
tex('pumpkin_side', (p) => {
  p.noise([0xc07615, 0xcc8020, 0xb26c10]);
  for (let x = 1; x < 16; x += 3) p.vline(x, 0, 16, 0xa5620f);
  p.hline(0, 0, 16, 0x8a5a12);
});
tex('pumpkin_face', (p) => {
  p.copyFrom(paint('pumpkin_side'));
  const dark = 0x2a1a06;
  p.art(['##..##', '.#..#.'], { '#': dark }, 2, 5);
  p.art(['##..##', '.#..#.'], { '#': dark }, 9, 5);
  p.art(['.######.', '#.#..#.#', '.######.'], { '#': dark }, 4, 10);
});
tex('jack_o_lantern', (p) => {
  p.copyFrom(paint('pumpkin_side'));
  const glow = 0xffd24a;
  p.art(['##..##', '.#..#.'], { '#': glow }, 2, 5);
  p.art(['##..##', '.#..#.'], { '#': glow }, 9, 5);
  p.art(['.######.', '#.#..#.#', '.######.'], { '#': glow }, 4, 10);
});
tex('melon_top', (p) => { p.noise([0x6f9226, 0x7ba02e, 0x63841f]); p.speckle(0x8fb03c, 0.12); });
tex('melon_side', (p) => {
  p.noise([0x6f9226, 0x7ba02e, 0x63841f]);
  for (let x = 0; x < 16; x += 4) p.vline(x, 0, 16, 0x4f6b18);
  p.speckle(0x9dc04a, 0.10);
});
tex('sponge', (p) => {
  p.noise([0xc5c142, 0xd2ce4f, 0xb5b136]);
  for (let i = 0; i < 18; i++) p.set(p.randInt(0, 15), p.randInt(0, 15), 0x8a8724);
});
tex('monster_spawner', (p) => {
  p.fill(0x1c1c22);
  for (let i = 0; i < 4; i++) { p.outline(i, i, 16 - i * 2, 16 - i * 2, i % 2 ? 0x2b2b33 : 0x1c1c22); }
  for (let x = 0; x < 16; x += 3) p.vline(x, 0, 16, 0x3a3a44);
  for (let y = 0; y < 16; y += 3) p.hline(0, y, 16, 0x3a3a44);
});
tex('cobweb', (p) => {
  p.clear();
  const c = 0xf2f2f2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.line(8, 8, Math.round(8 + Math.cos(a) * 8), Math.round(8 + Math.sin(a) * 8), c, 220);
  }
  for (const r of [3, 5, 7]) {
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
      p.line(Math.round(8 + Math.cos(a0) * r), Math.round(8 + Math.sin(a0) * r),
             Math.round(8 + Math.cos(a1) * r), Math.round(8 + Math.sin(a1) * r), c, 180);
    }
  }
});

// wool -------------------------------------------------------------------
const WOOLS = {
  white_wool: 0xe9ecec, orange_wool: 0xf07613, red_wool: 0xb02e26, yellow_wool: 0xf9c628,
  green_wool: 0x5e7c16, blue_wool: 0x3c44aa, purple_wool: 0x8932b8, black_wool: 0x1d1d21,
  brown_wool: 0x835432, light_gray_wool: 0x9d9d97,
};
for (const [name, col] of Object.entries(WOOLS)) {
  tex(name, (p) => {
    p.noise([col, scaleColor(col, 1.08), scaleColor(col, 0.92)]);
    // Sparse tufts give wool its felted look.
    for (let i = 0; i < 14; i++) p.rect(p.randInt(0, 14), p.randInt(0, 14), 2, 1, scaleColor(col, p.chance(0.5) ? 1.15 : 0.85));
  });
}

// fluids -----------------------------------------------------------------
tex('water', (p) => {
  p.noise([0x3f76e4, 0x4a80e8, 0x3a6cd8, 0x5288ec]);
  for (let i = 0; i < 5; i++) {
    const y = p.randInt(0, 15);
    p.hline(0, y, 16, 0x5c92f0);
  }
  for (let i = 0; i < p.data.length; i += 4) p.data[i + 3] = 200;
});
tex('lava', (p) => {
  p.noise([0xd45a12, 0xc44e0c, 0xe0691a]);
  for (let i = 0; i < 14; i++) {
    const x = p.randInt(0, 13), y = p.randInt(0, 13);
    p.rect(x, y, p.randInt(1, 3), p.randInt(1, 2), p.pick([0xe8b117, 0xf5c93a, 0xffe066]));
  }
  p.speckle(0x8f3208, 0.10);
});

// small blocks -----------------------------------------------------------
tex('torch', (p) => {
  p.clear();
  p.rect(7, 8, 2, 8, 0x6b5030);
  p.vline(7, 8, 8, 0x7d6038);
  p.rect(6, 6, 4, 3, 0x2b2b2b);
  p.rect(7, 5, 2, 3, 0xffd800);
  p.set(7, 4, 0xfff4a0); p.set(8, 4, 0xffe14a);
  p.set(6, 6, 0xff9a1e); p.set(9, 6, 0xff9a1e);
});
tex('ladder', (p) => {
  p.clear();
  p.rect(2, 0, 2, 16, 0x9c7a4d);
  p.rect(12, 0, 2, 16, 0x9c7a4d);
  for (let y = 2; y < 16; y += 5) p.rect(4, y, 8, 2, 0xb08a58);
  p.vline(2, 0, 16, 0x7f6239); p.vline(13, 0, 16, 0x7f6239);
});
tex('oak_door_bottom', (p) => {
  p.copyFrom(paint('oak_planks'));
  p.outline(0, 0, 16, 16, 0x5a4326);
  p.rect(2, 2, 5, 12, 0xa88a52); p.outline(2, 2, 5, 12, 0x6b5030);
  p.rect(9, 2, 5, 12, 0xa88a52); p.outline(9, 2, 5, 12, 0x6b5030);
  p.rect(12, 7, 2, 2, 0x4a4a4a);
});
tex('oak_door_top', (p) => {
  p.copyFrom(paint('oak_planks'));
  p.outline(0, 0, 16, 16, 0x5a4326);
  p.rect(2, 2, 5, 7, 0xa88a52); p.outline(2, 2, 5, 7, 0x6b5030);
  p.rect(9, 2, 5, 7, 0xa88a52); p.outline(9, 2, 5, 7, 0x6b5030);
  p.rect(2, 11, 12, 3, 0x8a6f42);
});
tex('iron_bars', (p) => {
  p.clear();
  p.rect(6, 0, 4, 16, 0xa8a8a8);
  p.vline(6, 0, 16, 0x8a8a8a); p.vline(9, 0, 16, 0xc4c4c4);
});
tex('bed_foot_top', (p) => { p.fill(0xa02b21); p.noise([0xa02b21, 0xb0342a, 0x8e241b]); p.outline(0, 0, 16, 16, 0x6e1a14); });
tex('bed_foot_side', (p) => { p.rect(0, 0, 16, 11, 0xa02b21); p.rect(0, 11, 16, 5, 0xb8945f); p.outline(0, 0, 16, 11, 0x6e1a14); });
tex('bed_head_top', (p) => {
  p.fill(0xa02b21); p.noise([0xa02b21, 0xb0342a, 0x8e241b]);
  p.rect(2, 1, 12, 7, 0xf0f0f0); p.outline(2, 1, 12, 7, 0xd0d0d0);
  p.outline(0, 0, 16, 16, 0x6e1a14);
});
tex('bed_head_side', (p) => { p.rect(0, 0, 16, 11, 0xa02b21); p.rect(0, 2, 16, 5, 0xf0f0f0); p.rect(0, 11, 16, 5, 0xb8945f); });

// plants -----------------------------------------------------------------
const crossPlant = (fn) => (p) => { p.clear(); fn(p); };
tex('short_grass', crossPlant((p) => {
  for (let x = 2; x < 14; x++) {
    const h = p.randInt(4, 9);
    for (let y = 16 - h; y < 16; y++) if (p.chance(0.85)) p.set(x, y, p.pick([0xc8c8c8, 0xdcdcdc, 0xb0b0b0]));
  }
}));
tex('tall_grass', crossPlant((p) => {
  for (let x = 1; x < 15; x++) {
    const h = p.randInt(9, 16);
    for (let y = 16 - h; y < 16; y++) if (p.chance(0.85)) p.set(x, y, p.pick([0xc8c8c8, 0xdcdcdc, 0xb0b0b0]));
  }
}));
tex('fern', crossPlant((p) => {
  p.vline(8, 3, 13, 0xb4b4b4);
  for (let y = 4; y < 15; y += 2) {
    const w = Math.max(1, 6 - Math.floor((y - 4) / 3));
    p.rect(8 - w, y, w, 1, 0xc8c8c8);
    p.rect(9, y, w, 1, 0xc8c8c8);
  }
}));
tex('dead_bush', crossPlant((p) => {
  p.line(8, 15, 8, 6, 0x6b5030);
  p.line(8, 10, 4, 6, 0x6b5030); p.line(8, 11, 12, 7, 0x6b5030);
  p.line(4, 6, 3, 3, 0x7d6038); p.line(12, 7, 13, 4, 0x7d6038);
  p.line(8, 6, 8, 3, 0x7d6038);
}));
const flower = (petal, center, stem = 0x4a7a2a) => crossPlant((p) => {
  p.vline(8, 8, 8, stem);
  p.set(7, 11, stem); p.set(9, 13, stem);
  p.rect(6, 4, 5, 4, petal);
  p.set(5, 5, petal); p.set(11, 5, petal); p.set(5, 6, petal); p.set(11, 6, petal);
  p.rect(7, 5, 3, 2, center);
});
tex('dandelion', flower(0xf9e547, 0xffffff));
tex('poppy', flower(0xd52b2b, 0x2b2b2b));
tex('blue_orchid', flower(0x2aa8e0, 0xf9e547));
tex('cornflower', flower(0x4a6fd4, 0x2b3a6b));
tex('oak_sapling', crossPlant((p) => {
  p.vline(8, 10, 6, 0x6b5030);
  p.rect(5, 4, 7, 6, 0x4a7a2a);
  p.set(4, 6, 0x4a7a2a); p.set(12, 6, 0x4a7a2a);
  p.speckle(0x5e9436, 0.25);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) p.set(x, y, 0, 0);
}));
tex('red_mushroom', crossPlant((p) => {
  p.rect(6, 10, 4, 5, 0xd8d8d0);
  p.rect(4, 5, 8, 5, 0xd52b2b);
  p.set(3, 7, 0xd52b2b); p.set(12, 7, 0xd52b2b);
  p.set(6, 6, 0xf0f0f0); p.set(9, 7, 0xf0f0f0); p.set(7, 8, 0xf0f0f0);
}));
tex('brown_mushroom', crossPlant((p) => {
  p.rect(6, 10, 4, 5, 0xd8d0c0);
  p.rect(4, 6, 8, 4, 0x9c7a52);
  p.set(3, 8, 0x9c7a52); p.set(12, 8, 0x9c7a52);
  p.set(6, 7, 0xb08f63);
}));
tex('sugar_cane', crossPlant((p) => {
  p.rect(6, 0, 4, 16, 0xa0c8a0);
  p.vline(6, 0, 16, 0x8ab48a); p.vline(9, 0, 16, 0xb4dcb4);
  for (let y = 3; y < 16; y += 5) p.hline(6, y, 4, 0x86a886);
}));
tex('vine', crossPlant((p) => {
  for (let x = 0; x < 16; x++) {
    if (!p.chance(0.5)) continue;
    const h = p.randInt(4, 16);
    for (let y = 0; y < h; y++) if (p.chance(0.8)) p.set(x, y, p.pick([0xc0c0c0, 0xd4d4d4, 0xa8a8a8]));
  }
}));
tex('lily_pad', (p) => {
  p.clear();
  p.circle(8, 8, 7, 0xc8c8c8);
  p.circle(8, 8, 6, 0xdcdcdc);
  // The notch that makes a lily pad read as a lily pad.
  for (let y = 8; y < 16; y++) for (let x = 7; x <= 9; x++) if (y > 9) p.set(x, y, 0, 0);
});
tex('cactus_top', (p) => { p.noise([0x587f35, 0x60893a, 0x4e7230]); p.outline(0, 0, 16, 16, 0x3f5c26); p.rect(6, 6, 4, 4, 0x6b9a42); });
tex('cactus_bottom', (p) => { p.noise([0x9c7a52, 0x8a6b47, 0xa8865c]); });
tex('cactus_side', (p) => {
  p.noise([0x587f35, 0x60893a, 0x4e7230]);
  p.vline(0, 0, 16, 0x3f5c26); p.vline(15, 0, 16, 0x3f5c26);
  p.vline(1, 0, 16, 0x46662a); p.vline(14, 0, 16, 0x46662a);
  for (let y = 1; y < 16; y += 4) { p.set(4, y, 0xd8d8c0); p.set(11, y + 2, 0xd8d8c0); }
});
tex('wheat_stage7', (p) => {
  p.clear();
  for (const x of [2, 6, 10, 14]) {
    p.vline(x, 4, 12, 0xb8a03a);
    p.set(x - 1, 5, 0xd8c04a); p.set(x + 1, 6, 0xd8c04a);
    p.rect(x - 1, 2, 3, 3, 0xd8c04a);
    p.set(x, 1, 0xe8d05a);
  }
});

// story blocks -----------------------------------------------------------
tex('ember_lantern', (p) => {
  p.noise([0x4a4a52, 0x55555e, 0x40404a]);
  p.outline(0, 0, 16, 16, 0x2b2b33);
  p.rect(3, 3, 10, 10, 0x2b2b33);
  p.rect(4, 4, 8, 8, 0x3a2a1a);
  p.outline(4, 4, 8, 8, 0x1c1c22);
  for (let x = 3; x < 14; x += 3) p.vline(x, 3, 10, 0x55555e);
});
tex('ember_lantern_top', (p) => { p.noise([0x4a4a52, 0x55555e]); p.outline(0, 0, 16, 16, 0x2b2b33); p.rect(6, 6, 4, 4, 0x2b2b33); });
tex('ember_lantern_lit', (p) => {
  p.copyFrom(paint('ember_lantern'));
  p.rect(4, 4, 8, 8, 0xff8a1e);
  p.rect(5, 5, 6, 6, 0xffb84a);
  p.rect(6, 6, 4, 4, 0xffe08a);
  p.speckle(0xfff4c0, 0.12);
  for (let x = 3; x < 14; x += 3) p.vline(x, 3, 10, 0x55555e);
});
tex('ember_lantern_lit_top', (p) => { p.copyFrom(paint('ember_lantern_top')); p.rect(6, 6, 4, 4, 0xffb84a); });
tex('rune_stone', (p) => {
  p.copyFrom(paint('stone_bricks'));
  p.multiply(0xb0b4c8);
  const r = 0x3a3f52;
  p.art(['..#..', '.###.', '#.#.#', '..#..', '..#..'], { '#': r }, 6, 3);
  p.art(['#...#', '.#.#.', '..#..'], { '#': r }, 6, 10);
});
tex('rune_stone_lit', (p) => {
  p.copyFrom(paint('stone_bricks'));
  p.multiply(0xc8c0d8);
  const r = 0x6ae0ff;
  p.art(['..#..', '.###.', '#.#.#', '..#..', '..#..'], { '#': r }, 6, 3);
  p.art(['#...#', '.#.#.', '..#..'], { '#': r }, 6, 10);
  p.speckle(0x9df0ff, 0.05);
});
tex('withered_stone', (p) => { p.noise([0x5a5450, 0x625b56, 0x514b47, 0x6b635e]); p.speckle(0x3e3936, 0.14); p.speckle(0x2a2725, 0.06); });
tex('withered_grass_top', (p) => { p.noise([0x6b6055, 0x75695d, 0x5f564c, 0x807366]); p.speckle(0x4a423a, 0.16); });
tex('withered_grass_side', (p) => {
  p.copyFrom(paint('dirt'));
  p.multiply(0xa89c90);
  for (let x = 0; x < 16; x++) {
    const h = 2 + (p.chance(0.5) ? 1 : 0);
    for (let y = 0; y < h; y++) p.set(x, y, p.pick([0x6b6055, 0x75695d, 0x5f564c]));
  }
});
tex('ember_core_block', (p) => {
  p.fill(0xff8a1e);
  p.circle(8, 8, 7, 0xffb84a);
  p.circle(8, 8, 5, 0xffe08a);
  p.circle(8, 8, 3, 0xfff8d8);
  p.speckle(0xffffff, 0.06);
});
tex('beacon_pedestal_top', (p) => {
  p.copyFrom(paint('stone_bricks'));
  p.rect(4, 4, 8, 8, 0x2b2b33);
  p.outline(4, 4, 8, 8, 0x8a8a8a);
  p.rect(6, 6, 4, 4, 0x4a3a2a);
});
tex('beacon_pedestal_side', (p) => {
  p.copyFrom(paint('stone_bricks'));
  p.rect(2, 6, 12, 6, 0x6b6b6b);
  p.outline(2, 6, 12, 6, 0x4a4a4a);
  p.art(['#.#.#'], { '#': 0xffb84a }, 6, 8);
});

// ================================================================== items

const I = {
  // shared item palette slots
  h: 0xb8945f,   // handle light
  H: 0x8a6f42,   // handle dark
  k: 0x2b2b2b,   // outline
};

const TOOL_ART = {
  pickaxe: [
    '................',
    '..mmm......mmm..',
    '.mMMMm....mMMMm.',
    '.mMMMMm..mMMMMm.',
    '..mMMMMmmMMMMm..',
    '...ddMMhHMMdd...',
    '.....ddhHdd.....',
    '.......hH.......',
    '......hH........',
    '......hH........',
    '.....hH.........',
    '.....hH.........',
    '....hH..........',
    '....hH..........',
    '...hH...........',
    '................',
  ],
  axe: [
    '................',
    '....mmmm........',
    '...mMMMMm.......',
    '..mMMMMMMm......',
    '..mMMMMMMm......',
    '..mMMMMMhH......',
    '..mMMMMhH.......',
    '...dddhH........',
    '.....hH.........',
    '.....hH.........',
    '....hH..........',
    '....hH..........',
    '...hH...........',
    '...hH...........',
    '..hH............',
    '................',
  ],
  shovel: [
    '................',
    '......mmmm......',
    '.....mMMMMm.....',
    '.....mMMMMm.....',
    '.....mMMMMm.....',
    '.....ddMMdd.....',
    '.......hH.......',
    '.......hH.......',
    '......hH........',
    '......hH........',
    '.....hH.........',
    '.....hH.........',
    '....hH..........',
    '....hH..........',
    '...hH...........',
    '................',
  ],
  sword: [
    '.............mmm',
    '............mMMm',
    '...........mMMm.',
    '..........mMMm..',
    '.........mMMm...',
    '........mMMm....',
    '.......mMMm.....',
    '......mMMm......',
    '.d...mMMm.......',
    '.dd.mMMm........',
    '..ddmMm.........',
    '...ddd..........',
    '..hHdd..........',
    '.hH.............',
    'hH..............',
    '................',
  ],
  hoe: [
    '................',
    '.....mmmmmm.....',
    '.....mMMMMm.....',
    '.....dddmhH.....',
    '.........hH.....',
    '........hH......',
    '........hH......',
    '.......hH.......',
    '.......hH.......',
    '......hH........',
    '......hH........',
    '.....hH.........',
    '.....hH.........',
    '....hH..........',
    '....hH..........',
    '................',
  ],
};

const TOOL_MATERIALS = {
  wooden: { m: 0x9c7a4d, M: 0xb8945f, d: 0x7a5f38 },
  stone:  { m: 0x7d7d7d, M: 0x9a9a9a, d: 0x5e5e5e },
  iron:   { m: 0xd8d8d8, M: 0xf0f0f0, d: 0xa8a8a8 },
  golden: { m: 0xf8d848, M: 0xfdea78, d: 0xcaa72a },
  diamond:{ m: 0x62e8e1, M: 0x9df3ee, d: 0x3aada7 },
};

for (const [matName, mat] of Object.entries(TOOL_MATERIALS)) {
  for (const [toolName, art] of Object.entries(TOOL_ART)) {
    tex(`${matName}_${toolName}`, (p) => {
      p.clear();
      p.art(art, { ...mat, h: I.h, H: I.H });
    });
  }
}

const ARMOR_ART = {
  helmet: [
    '................',
    '................',
    '...mmmmmmmmmm...',
    '..mMMMMMMMMMMm..',
    '..mMMMMMMMMMMm..',
    '..mMMMMMMMMMMm..',
    '..mMM.dddd.MMm..',
    '..mM..dddd..Mm..',
    '..mM........Mm..',
    '..mm........mm..',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  chestplate: [
    '................',
    '................',
    '..mmm....mmm....',
    '.mMMMmmmmMMMm...',
    '.mMMMMMMMMMMm...',
    '.mMMMMMMMMMMm...',
    '..mMMMMMMMMm....',
    '..mMMddddMMm....',
    '..mMMddddMMm....',
    '..mMMMMMMMMm....',
    '..mMMMMMMMMm....',
    '...mmmmmmmm.....',
    '................',
    '................',
    '................',
    '................',
  ],
  leggings: [
    '................',
    '................',
    '..mmmmmmmmmm....',
    '..mMMMMMMMMm....',
    '..mMMMMMMMMm....',
    '..mMMMMMMMMm....',
    '..mMMM..MMMm....',
    '..mMM....MMm....',
    '..mMM....MMm....',
    '..mMM....MMm....',
    '..mMM....MMm....',
    '..mm......mm....',
    '................',
    '................',
    '................',
    '................',
  ],
  boots: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..mm......mm....',
    '..mMm....mMm....',
    '..mMm....mMm....',
    '..mMm....mMm....',
    '.mMMMm..mMMMm...',
    '.mMMMMmmMMMMm...',
    '.mMMMMmmMMMMm...',
    '..mmmm..mmmm....',
    '................',
    '................',
    '................',
  ],
};

const ARMOR_MATERIALS = {
  leather: { m: 0x7a5232, M: 0xa06f45, d: 0x5c3d24 },
  iron:    { m: 0xc8c8c8, M: 0xe8e8e8, d: 0x9a9a9a },
  golden:  { m: 0xdfba38, M: 0xf8d848, d: 0xb08f26 },
  diamond: { m: 0x62e8e1, M: 0x9df3ee, d: 0x3aada7 },
};

for (const [matName, mat] of Object.entries(ARMOR_MATERIALS)) {
  for (const [piece, art] of Object.entries(ARMOR_ART)) {
    tex(`${matName}_${piece}`, (p) => { p.clear(); p.art(art, mat); });
  }
}

// --- simple item icons ---------------------------------------------------

/** A small rounded lump, used for ores/food/materials. */
const lump = (colors, w = 10, h = 9) => (p) => {
  p.clear();
  const ox = Math.floor((16 - w) / 2), oy = Math.floor((16 - h) / 2) + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - (w - 1) / 2) / (w / 2), ny = (y - (h - 1) / 2) / (h / 2);
      if (nx * nx + ny * ny > 1.05 + p.rng.float(-0.12, 0.12)) continue;
      const shade = y < h / 3 ? 0 : y > (h * 2) / 3 ? 2 : 1;
      p.set(ox + x, oy + y, colors[Math.min(colors.length - 1, shade)]);
    }
  }
  p.outlineAlpha(0x000000, 190);
};

const ingot = (base, light, dark) => (p) => {
  p.clear();
  p.art([
    '................',
    '................',
    '................',
    '................',
    '.....MMMMMM.....',
    '....MmmmmmmM....',
    '...MmmmmmmmmM...',
    '..MmmmmmmmmmmM..',
    '..dmmmmmmmmmmd..',
    '..ddddddddddd...',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { m: base, M: light, d: dark });
  p.outlineAlpha(0x000000, 190);
};

const gem = (base, light, dark) => (p) => {
  p.clear();
  p.art([
    '................',
    '................',
    '....MMMMMM......',
    '...MmmmmmmM.....',
    '..MmmmmmmmmM....',
    '..mmmmmmmmmm....',
    '..mmmMMmmmmm....',
    '..dmmMMmmmmd....',
    '...dmmmmmmd.....',
    '....dmmmmd......',
    '.....dmmd.......',
    '......dd........',
    '................',
    '................',
    '................',
    '................',
  ], { m: base, M: light, d: dark });
  p.outlineAlpha(0x000000, 200);
};

tex('stick', (p) => {
  p.clear();
  p.art([
    '................',
    '............hH..',
    '...........hH...',
    '..........hH....',
    '.........hH.....',
    '........hH......',
    '.......hH.......',
    '......hH........',
    '.....hH.........',
    '....hH..........',
    '...hH...........',
    '..hH............',
    '.hH.............',
    '................',
    '................',
    '................',
  ], { h: 0xb8945f, H: 0x8a6f42 });
});
tex('coal', lump([0x3a3a3a, 0x1f1f1f, 0x121212]));
tex('charcoal', lump([0x4a423a, 0x2e2a24, 0x1c1a16]));
tex('raw_iron', lump([0xe0b498, 0xc89478, 0xa87a5e]));
tex('raw_gold', lump([0xfce97a, 0xecc333, 0xc9a022]));
tex('raw_copper', lump([0xe89a72, 0xc86e4b, 0xa85838]));
tex('iron_ingot', ingot(0xd8d8d8, 0xf2f2f2, 0xa8a8a8));
tex('gold_ingot', ingot(0xf8d848, 0xfdea78, 0xcaa72a));
tex('copper_ingot', ingot(0xc86e4b, 0xe08a5f, 0xa05236));
tex('diamond', gem(0x62e8e1, 0xa8f5f0, 0x3aada7));
tex('emerald', gem(0x43d168, 0x86e8a0, 0x2aa84c));
tex('lapis_lazuli', lump([0x4a6fd4, 0x2a4fb0, 0x1b3a8c]));
tex('redstone', (p) => {
  p.clear();
  for (let i = 0; i < 22; i++) p.set(p.randInt(3, 12), p.randInt(4, 12), p.pick([0xff3a2a, 0xd41505, 0x9c0f02]));
});
tex('glowstone_dust', (p) => {
  p.clear();
  for (let i = 0; i < 24; i++) p.set(p.randInt(3, 12), p.randInt(4, 12), p.pick([0xffe9a0, 0xf5c95e, 0xd8a63a]));
});
tex('flint', (p) => {
  p.clear();
  p.art([
    '................',
    '................',
    '................',
    '.......dd.......',
    '......dmmd......',
    '.....dmmmmd.....',
    '....dmmmmmmd....',
    '...dmmmmmmmmd...',
    '..dmmmmmmmmmmd..',
    '..ddddddddddd...',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { m: 0x4a4a52, d: 0x2b2b33 });
});
tex('clay_ball', lump([0xb8bcd0, 0xa4a8b8, 0x8e92a0], 8, 8));
tex('brick', (p) => { p.clear(); p.rect(3, 5, 10, 6, 0x9e5e4a); p.hline(3, 5, 10, 0xb8735c); p.hline(3, 10, 10, 0x7c4636); p.outlineAlpha(0x000000, 190); });
tex('string', (p) => {
  p.clear();
  p.line(3, 3, 12, 6, 0xe8e8e8); p.line(12, 6, 4, 10, 0xe8e8e8); p.line(4, 10, 11, 13, 0xe8e8e8);
});
tex('feather', (p) => {
  p.clear();
  p.line(11, 3, 5, 13, 0xd8d8d8);
  for (let i = 0; i < 6; i++) { p.set(10 - i, 4 + i, 0xf0f0f0); p.set(12 - i, 4 + i, 0xf0f0f0); p.set(9 - i, 5 + i, 0xe4e4e4); }
});
tex('leather', (p) => { p.clear(); p.rect(3, 4, 10, 8, 0x9c6b3f); p.outline(3, 4, 10, 8, 0x7a5230); p.speckle(0xb07f52, 0.2); });
tex('bone', (p) => {
  p.clear();
  p.line(4, 12, 11, 4, 0xe8e8dc);
  p.rect(3, 11, 2, 2, 0xf2f2e8); p.rect(4, 13, 2, 2, 0xf2f2e8);
  p.rect(11, 3, 2, 2, 0xf2f2e8); p.rect(10, 2, 2, 2, 0xf2f2e8);
  p.outlineAlpha(0x000000, 160);
});
tex('bone_meal', (p) => { p.clear(); for (let i = 0; i < 24; i++) p.set(p.randInt(3, 12), p.randInt(4, 12), p.pick([0xf2f2e8, 0xdcdcd0, 0xc8c8bc])); });
tex('gunpowder', (p) => { p.clear(); for (let i = 0; i < 26; i++) p.set(p.randInt(3, 12), p.randInt(4, 12), p.pick([0x6b6b6b, 0x4a4a4a, 0x2e2e2e])); });
tex('spider_eye', (p) => { p.clear(); p.circle(8, 8, 4, 0x8a2020); p.circle(8, 8, 2, 0xd83a3a); p.set(7, 7, 0xffffff); p.outlineAlpha(0x000000, 190); });
tex('rotten_flesh', (p) => { p.clear(); p.circle(8, 8, 5, 0x8a5a3a); p.speckle(0x6b4028, 0.3); p.speckle(0xa87050, 0.2); p.outlineAlpha(0x000000, 190); });
tex('ender_pearl', (p) => { p.clear(); p.circle(8, 8, 5, 0x1a4a44); p.circle(8, 8, 3, 0x2e7a6e); p.circle(7, 7, 1, 0x8ae0d0); p.outlineAlpha(0x000000, 190); });
tex('slimeball', (p) => { p.clear(); p.circle(8, 8, 5, 0x7ac26a); p.circle(7, 7, 2, 0x9fd894); p.outlineAlpha(0x000000, 160); });
tex('paper', (p) => { p.clear(); p.rect(3, 3, 10, 11, 0xf2f2ea); p.outline(3, 3, 10, 11, 0xd0d0c4); for (let y = 5; y < 12; y += 2) p.hline(5, y, 6, 0xc4c4b8); });
tex('book', (p) => {
  p.clear();
  p.rect(3, 3, 10, 11, 0x8a4a2a);
  p.rect(5, 4, 8, 9, 0xf2f2ea);
  p.vline(4, 3, 11, 0xa05a34);
  p.rect(11, 5, 2, 2, 0xf8d848);
  p.outlineAlpha(0x000000, 190);
});
tex('wheat', (p) => {
  p.clear();
  for (const x of [4, 8, 12]) {
    p.vline(x, 6, 9, 0xb8a03a);
    p.rect(x - 1, 3, 3, 4, 0xd8c04a);
    p.set(x, 2, 0xe8d05a);
  }
});
tex('wheat_seeds', (p) => { p.clear(); for (let i = 0; i < 12; i++) { const x = p.randInt(4, 11), y = p.randInt(5, 11); p.set(x, y, 0x8aa83a); p.set(x, y + 1, 0x6e8a2a); } });
tex('snowball', (p) => { p.clear(); p.circle(8, 8, 5, 0xf6fbff); p.circle(7, 7, 2, 0xffffff); p.outlineAlpha(0x9ab4cc, 200); });
tex('bowl', (p) => {
  p.clear();
  p.art(['..dddddddddd..', '.dmmmmmmmmmmd.', '..dmmmmmmmmd..', '...dmmmmmmd...', '....dddddd....'],
        { m: 0x9c7a4d, d: 0x7a5f38 }, 1, 7);
});
tex('bucket', (p) => {
  p.clear();
  p.art([
    '..dd......dd..',
    '...d......d...',
    '...dddddddd...',
    '..dmmmmmmmmd..',
    '..dmmmmmmmmd..',
    '..dmmmmmmmmd..',
    '...dmmmmmmd...',
    '...dddddddd...',
  ], { m: 0xc8c8c8, d: 0x8a8a8a }, 1, 4);
});
tex('water_bucket', (p) => { p.copyFrom(paint('bucket')); p.rect(4, 8, 8, 5, 0x3f76e4); p.hline(4, 8, 8, 0x5c92f0); });
tex('lava_bucket', (p) => { p.copyFrom(paint('bucket')); p.rect(4, 8, 8, 5, 0xd45a12); p.hline(4, 8, 8, 0xe8b117); });
tex('arrow', (p) => {
  p.clear();
  p.line(3, 12, 11, 4, 0xb8945f);
  p.art(['.mm', 'mmm', '.mm'], { m: 0xe8e8e8 }, 10, 2);
  p.set(3, 12, 0xf0f0f0); p.set(2, 11, 0xf0f0f0); p.set(4, 13, 0xf0f0f0);
  p.set(2, 13, 0xd8d8d8); p.set(4, 11, 0xd8d8d8);
});
tex('melon_slice', (p) => {
  p.clear();
  p.art([
    '..mmmmmmmmmm..',
    '.mrrrrrrrrrrm.',
    '.mrrrkrrkrrrm.',
    '..mrrrrrrrrm..',
    '...mrrkrrrm...',
    '....mrrrrm....',
    '.....mmmm.....',
  ], { m: 0x4f8a2a, r: 0xd83a4a, k: 0x2b2b2b }, 1, 4);
});
tex('golden_apple', (p) => {
  p.clear();
  p.circle(8, 9, 5, 0xf8d848);
  p.circle(6, 7, 2, 0xfdea9a);
  p.rect(8, 3, 1, 3, 0x6b5030);
  p.rect(9, 4, 3, 2, 0x4a7a2a);
  p.outlineAlpha(0x000000, 190);
});
tex('apple', (p) => {
  p.clear();
  p.circle(8, 9, 5, 0xd83a3a);
  p.circle(6, 7, 2, 0xf06a6a);
  p.rect(8, 3, 1, 3, 0x6b5030);
  p.rect(9, 4, 3, 2, 0x4a7a2a);
  p.outlineAlpha(0x000000, 190);
});
tex('bread', (p) => {
  p.clear();
  p.art([
    '..mmmmmmmmmm..',
    '.mMMMMMMMMMMm.',
    'mMMdMMdMMdMMMm',
    'mMMMMMMMMMMMMm',
    'mMMdMMdMMdMMMm',
    '.mMMMMMMMMMMm.',
    '..mmmmmmmmmm..',
  ], { m: 0x8a5a2a, M: 0xc08a44, d: 0x6f4520 }, 1, 5);
  p.outlineAlpha(0x000000, 170);
});
tex('village_bread', (p) => { p.copyFrom(paint('bread')); p.multiply(0xfff0c0); p.speckle(0xffd24a, 0.10); });
tex('cookie', (p) => { p.clear(); p.circle(8, 8, 5, 0xc08a54); for (let i = 0; i < 6; i++) p.set(p.randInt(5, 11), p.randInt(5, 11), 0x4a2e18); p.outlineAlpha(0x000000, 170); });

const meat = (raw, cooked) => [
  (p) => { p.clear(); p.circle(8, 8, 5, raw[0]); p.circle(7, 7, 3, raw[1]); p.rect(3, 9, 3, 2, 0xf0e8d8); p.outlineAlpha(0x000000, 190); },
  (p) => { p.clear(); p.circle(8, 8, 5, cooked[0]); p.circle(7, 7, 3, cooked[1]); p.rect(3, 9, 3, 2, 0xf0e8d8); p.speckle(cooked[2], 0.12); p.outlineAlpha(0x000000, 190); },
];
const [rawPork, cookedPork] = meat([0xf0a0a0, 0xf8c0c0], [0xd08a4a, 0xe8a866, 0x8a5a2a]);
tex('porkchop', rawPork); tex('cooked_porkchop', cookedPork);
const [rawBeef, cookedBeef] = meat([0xd85a5a, 0xf07070], [0x8a4a2a, 0xa8683a, 0x5c2e14]);
tex('beef', rawBeef); tex('cooked_beef', cookedBeef);
const [rawChicken, cookedChicken] = meat([0xf0c0b0, 0xf8d8cc], [0xd8a05a, 0xe8bc7a, 0x9a6a2a]);
tex('chicken', rawChicken); tex('cooked_chicken', cookedChicken);
const [rawMutton, cookedMutton] = meat([0xe07878, 0xf09090], [0xa05a30, 0xbc7a48, 0x6f3c1c]);
tex('mutton', rawMutton); tex('cooked_mutton', cookedMutton);

tex('carrot', (p) => {
  p.clear();
  p.line(6, 13, 10, 5, 0xe8802a); p.line(7, 13, 11, 5, 0xf09a4a); p.line(5, 12, 9, 5, 0xd06a1a);
  p.rect(9, 2, 2, 3, 0x4a8a2a); p.rect(11, 3, 2, 2, 0x4a8a2a);
  p.outlineAlpha(0x000000, 170);
});
tex('potato', lump([0xd8b070, 0xbc9050, 0x9a7038]));
tex('baked_potato', (p) => { p.copyFrom(paint('potato')); p.multiply(0xd8b090); p.speckle(0x6f4520, 0.14); });

tex('shears', (p) => {
  p.clear();
  p.art([
    '.....d....d.....',
    '....dmd..dmd....',
    '....dmd..dmd....',
    '.....dmd dmd....',
    '......dmddm.....',
    '.......dmm......',
    '.......dkm......',
    '......dmddm.....',
    '.....dmd..dm....',
    '....dmd....dm...',
    '...dmd......dm..',
    '...dd........d..',
    '................',
    '................',
    '................',
    '................',
  ], { m: 0xd8d8d8, d: 0x8a8a8a, k: 0x4a4a4a });
});
tex('flint_and_steel', (p) => {
  p.clear();
  p.art(['..dd..', '.dmmd.', '.dmmd.', '..dd..'], { m: 0xc8c8c8, d: 0x8a8a8a }, 2, 3);
  p.art(['.dd.', 'dmmd', 'dmmd', '.dd.'], { m: 0x4a4a52, d: 0x2b2b33 }, 9, 8);
});
tex('bow', (p) => {
  p.clear();
  p.line(4, 2, 11, 5, 0x8a6f42); p.line(11, 5, 11, 10, 0x8a6f42); p.line(11, 10, 4, 13, 0x8a6f42);
  p.line(4, 2, 4, 13, 0xf0f0f0);
  p.line(4, 7, 13, 7, 0xb8945f);
});
tex('oak_door', (p) => {
  p.clear();
  p.rect(4, 1, 8, 14, 0xa88a52);
  p.outline(4, 1, 8, 14, 0x6b5030);
  p.rect(5, 2, 6, 5, 0xb8945f); p.outline(5, 2, 6, 5, 0x8a6f42);
  p.rect(5, 9, 6, 5, 0xb8945f); p.outline(5, 9, 6, 5, 0x8a6f42);
  p.set(10, 8, 0x4a4a4a);
});
tex('red_bed', (p) => {
  p.clear();
  p.rect(2, 6, 12, 6, 0xa02b21);
  p.rect(3, 4, 4, 3, 0xf0f0f0);
  p.rect(2, 12, 12, 2, 0xb8945f);
  p.outlineAlpha(0x000000, 170);
});

// story items -------------------------------------------------------------
tex('ember_shard', (p) => {
  p.clear();
  p.art([
    '................',
    '.......M........',
    '......MmM.......',
    '.....MmmmM......',
    '....MmmmmmM.....',
    '....dmmmmmd.....',
    '.....dmmmd......',
    '.....dmmmd......',
    '......dmd.......',
    '......dmd.......',
    '.......d........',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { m: 0xff8a1e, M: 0xffe08a, d: 0xc4550c });
  p.outlineAlpha(0x2b1400, 220);
});
tex('ember_core', (p) => {
  p.clear();
  p.circle(8, 8, 6, 0xc4550c);
  p.circle(8, 8, 5, 0xff8a1e);
  p.circle(8, 8, 3, 0xffb84a);
  p.circle(8, 8, 2, 0xfff8d8);
  p.set(6, 6, 0xffffff);
  p.outlineAlpha(0x2b1400, 230);
});
tex('miras_journal', (p) => {
  p.clear();
  p.rect(3, 2, 10, 12, 0x3a5a8a);
  p.rect(5, 3, 8, 10, 0xe8e0c8);
  p.vline(4, 2, 12, 0x4a6b9c);
  p.rect(11, 6, 2, 2, 0xc8a04a);
  for (let y = 5; y < 12; y += 2) p.hline(6, y, 5, 0xc4bca0);
  p.outlineAlpha(0x000000, 200);
});
tex('hollow_key', (p) => {
  p.clear();
  p.circle(5, 5, 3, 0x6b6b7a);
  p.circle(5, 5, 1, 0x000000, 0);
  p.line(6, 7, 12, 13, 0x8a8a9a);
  p.rect(10, 12, 3, 1, 0x8a8a9a);
  p.rect(8, 10, 2, 1, 0x8a8a9a);
  p.outlineAlpha(0x1c1c22, 220);
});
tex('torvins_hammer', (p) => {
  p.clear();
  p.art([
    '................',
    '..MMMMMMMM......',
    '.MmmmmmmmmM.....',
    '.MmmdddddmM.....',
    '.MmmmmmmmhH.....',
    '.MmmmmmmhH......',
    '..MMMMMhH.......',
    '.......hH.......',
    '......hH........',
    '......hH........',
    '.....hH.........',
    '.....hH.........',
    '....hH..........',
    '....hH..........',
    '...hH...........',
    '................',
  ], { m: 0x8a8a96, M: 0xb4b4c0, d: 0x5e5e6a, h: 0xb8945f, H: 0x8a6f42 });
});
tex('wardens_bane', (p) => {
  p.clear();
  p.art([
    '.............MMM',
    '............MmMm',
    '...........MmMm.',
    '..........MmMm..',
    '.........MmMm...',
    '........MmMm....',
    '.......MmMm.....',
    '......MmMm......',
    '.g...MmMm.......',
    '.gg.MmMm........',
    '..ggMmM.........',
    '...ggg..........',
    '..hHgg..........',
    '.hH.............',
    'hH..............',
    '................',
  ], { m: 0x2a3a6b, M: 0x6a8ae0, g: 0xc8a04a, h: 0x3a3a4a, H: 0x22222e });
  p.outlineAlpha(0x0a0a14, 200);
});

// ================================================================== particles / misc

// Ten crack overlays, drawn black-on-transparent and composited over the block
// being mined. Stage 0 is a single hairline; stage 9 is nearly shattered.
for (let s = 0; s < 10; s++) {
  tex(`destroy_stage_${s}`, (p) => {
    p.clear();
    const cracks = 1 + s;
    for (let i = 0; i < cracks; i++) {
      let x = p.randInt(1, 14), y = p.randInt(1, 14);
      const len = 3 + s;
      const dx = p.chance(0.5) ? 1 : -1;
      for (let k = 0; k < len; k++) {
        p.set(x, y, 0x000000, 200);
        p.set(x + 1, y, 0x000000, 90);
        x += p.chance(0.6) ? dx : 0;
        y += p.chance(0.6) ? 1 : 0;
        if (x < 0 || x > 15 || y > 15) break;
      }
    }
  });
}

tex('sun', (p) => {
  p.fill(0xfff8d8);
  p.outline(0, 0, 16, 16, 0xffe89a);
  p.speckle(0xffffff, 0.2);
});
tex('moon', (p) => {
  p.fill(0xf0f4ff);
  p.circle(11, 5, 2, 0xd8dcea);
  p.circle(5, 10, 3, 0xdde1ee);
  p.circle(9, 12, 1, 0xd0d4e2);
});

export const TEXTURE_NAMES = () => [...TEXTURES.keys()];
